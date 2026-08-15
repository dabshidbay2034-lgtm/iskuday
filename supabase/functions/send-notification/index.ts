// Staff-facing email notifications, sent by Postgres triggers via pg_net.
//
// Five events, one function, chosen by `payload.type`:
//   booking_requested — a guest asked to book a room  → the hotel's inbox
//   service_inquiry   — someone asked about a service → the platform's inbox
//   hotel_invite      — a hotel admin invited someone → the invitee's inbox
//   property_listed   — an owner registered a unit    → the platform's inbox
//   property_available— a unit came back on the market→ the platform's inbox
//
// The last two are ADMIN-FACING supply signals, not customer mail. The owner
// already knows what they just did; the platform is the party that wants to know
// that inventory changed, so it can moderate the listing and push it to whoever
// is looking. Both go to ADMIN_NOTIFY_EMAIL and nowhere else.
//
// Follows the structure of supabase/functions/clerk-webhook/index.ts: CORS
// headers, OPTIONS handling, secret verification BEFORE the payload is trusted,
// a service-role client for every read, and "ACK anything we don't handle so
// the sender stops retrying".
//
// ── THE ONE RULE THIS FILE IS BUILT AROUND ─────────────────────────────────
// The database write that triggered us HAS ALREADY COMMITTED. A booking exists.
// An invite exists. Nothing we do here can un-happen it, and pg_net will happily
// retry a failure into a storm that helps nobody. So: this function returns 200
// for essentially every outcome except a bad secret. Misconfiguration, an
// unresolvable recipient, a Resend outage — all of them log loudly and return
// 200. The trigger side does the same thing (see 20260814000001), for the same
// reason. Silence in the inbox plus a line in the logs beats a rolled-back
// booking every single time.
//
// ── WHY EMAIL IS STAFF-FACING ONLY ─────────────────────────────────────────
// This market runs on WhatsApp. A guest in Mogadishu will not check email for a
// booking confirmation, and the hotel will phone them back rather than reply.
// So nothing here emails a guest — the guest's PHONE is what we put in front of
// the hotel. Guest-facing confirmations belong on WhatsApp; see
// docs/NOTIFICATIONS.md.
//
// Required env (Supabase → Edge Functions → Secrets):
//   NOTIFY_WEBHOOK_SECRET     — shared secret; must match the `x-notify-secret`
//                               header the trigger sends. Without it this URL is
//                               a public "email anyone" endpoint.
//   SUPABASE_URL              — project URL (injected by the platform)
//   SUPABASE_SERVICE_ROLE_KEY — service role key (server only, never in the bundle)
//   RESEND_API_KEY            — OPTIONAL. Absent = every send is a no-op.
//   FROM_EMAIL                — OPTIONAL. Verified Resend sender. Defaults loud.
//   ADMIN_NOTIFY_EMAIL        — OPTIONAL. Platform desk; required for
//                               service_inquiry, property_listed and
//                               property_available. Unset = logged no-op.
//   SITE_URL                  — OPTIONAL. Defaults to https://mogadishurents.com
//
// Deploy: npx supabase functions deploy send-notification
// Runbook: docs/NOTIFICATIONS.md

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-notify-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Types ────────────────────────────────────────────────────────────────────

type NotificationType =
  | "booking_requested"
  | "service_inquiry"
  | "hotel_invite"
  | "property_listed"
  | "property_available";

/**
 * What the trigger is allowed to say.
 *
 * IDS ONLY, DELIBERATELY. Every fact that ends up in an email — the recipient
 * address above all — is re-read from Postgres with the service-role key. An
 * attacker who somehow learned the shared secret still cannot make this function
 * mail arbitrary text to an arbitrary address, because there is no field here
 * for them to put either one in.
 */
interface NotifyPayload {
  type?: string;
  booking_id?: string;
  inquiry_id?: string;
  invite_id?: string;
  property_id?: string;
}

/**
 * The columns each handler reads, spelled out.
 *
 * There is no generated `Database` type in this repo, so a bare client infers
 * every row as `never` and nothing type-checks. Declaring the shapes here is the
 * cheaper half of the fix and doubles as documentation of exactly which columns
 * leave the database — worth having on a path that emails what it reads.
 */
interface BookingRow {
  id: string;
  room_id: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  check_in: string;
  check_out: string;
  adults: number | null;
  children: number | null;
  rate_per_night: number | null;
  total_amount: number | null;
  notes: string | null;
  status: string;
  source: string | null;
}

interface PropertyRow {
  id: string;
  title: string | null;
  owner_id: string | null;
}

/**
 * The wider read used by the two admin supply notices.
 *
 * Deliberately separate from `PropertyRow` above: the booking handler wants
 * three columns and should keep reading three. Note `toilets` — there is no
 * `bathrooms` column in this schema (see the original properties DDL in
 * 20260306213635); `toilets` is what the AddProperty form fills in for the
 * bathroom count, and it is what the emails label "Bathrooms".
 */
interface PropertyDetailRow {
  id: string;
  title: string | null;
  description: string | null;
  type: string | null;
  price: number | string | null;
  is_daily_rate: boolean | null;
  location: string | null;
  bedrooms: number | null;
  toilets: number | null;
  occupancy_status: string | null;
  is_listed: boolean | null;
  is_available: boolean | null;
  owner_id: string | null;
  created_at: string | null;
}

interface HotelRoomRow {
  hotel_id: string;
  created_at: string;
}

interface HotelRow {
  id?: string;
  name: string | null;
  contact_email?: string | null;
}

interface ServiceInquiryRow {
  id: string;
  service_id: string | null;
  property_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  message: string | null;
  created_at: string;
}

interface ServiceRow {
  title: string | null;
}

interface HotelInviteRow {
  id: string;
  hotel_id: string;
  email: string | null;
  role: string;
  permissions: string[] | null;
  /** ⚠ The credential. Never logged, never in a subject line. See STEP 13. */
  token: string;
  expires_at: string;
  accepted_at: string | null;
}

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What a handler decided to do. `null` = nothing to send; the reason is logged. */
type HandlerResult = EmailMessage | null;

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * An obviously-broken default. If FROM_EMAIL is unset, Resend rejects this
 * address and the failure lands in the logs with the placeholder visible in it —
 * which is exactly what we want. A plausible-looking default (noreply@…) would
 * fail domain verification and look like a Resend problem instead of a
 * configuration problem.
 */
const FROM_EMAIL_FALLBACK = "UNCONFIGURED Mogadishu Rents <set-FROM_EMAIL@example.invalid>";

const SITE_URL = (Deno.env.get("SITE_URL") || "https://mogadishurents.com")
  .replace(/\/+$/, "");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison.
 *
 * `a === b` on a secret leaks its contents: JS string equality short-circuits at
 * the first differing byte, so an attacker who can time the response can peel
 * the secret off one character at a time. Hashing both sides first gives two
 * fixed-length (32-byte) digests, which also removes the length leak — a plain
 * byte loop over the raw strings would still tell you how long the secret is.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Escape for HTML text content and attribute values.
 *
 * NON-NEGOTIABLE on every interpolated value. `bookings.guest_name`,
 * `service_inquiries.message` and `sender_name` are free text typed by anonymous
 * members of the public — `create_booking_request()` and the public INSERT policy
 * on `service_inquiries` both accept unauthenticated writes. The HTML body below
 * is a straight injection sink: an inquiry whose message is `<img src=x
 * onerror=...>` would otherwise execute in whichever staff inbox renders it.
 * Nothing goes into the HTML template except through this function.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "12 Aug 2026" — unambiguous for a reader who may not share our date order. */
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Whole nights between two ISO dates. check_out is the release morning. */
function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Prices across this app are plain USD (properties has no currency column). */
function formatMoney(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  if (Number.isNaN(n)) return "$0";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/**
 * One shared HTML shell so all three emails look like the same product.
 * Inline styles only — every mail client strips <style> blocks somewhere.
 *
 * `title` and `rows` MUST already be escaped by the caller. This function does
 * not escape, because `rows` is markup by the time it gets here.
 */
function renderHtml(opts: {
  heading: string;
  intro: string;
  rows: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const cta = opts.ctaUrl && opts.ctaLabel
    ? `<p style="margin:24px 0 0;">
         <a href="${opts.ctaUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;
            text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
           ${opts.ctaLabel}
         </a>
       </p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f8;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;
    padding:28px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;">${opts.heading}</h1>
    <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.5;">${opts.intro}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
      ${opts.rows}
    </table>
    ${cta}
    <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;
      color:#6b7280;font-size:12px;line-height:1.5;">
      ${opts.footer ?? "Sent automatically by Mogadishu Rents. Please do not reply to this address."}
    </p>
  </div>
</body></html>`;
}

/** One escaped label/value row of the table above. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-weight:600;vertical-align:top;">${escapeHtml(value)}</td>
  </tr>`;
}

/**
 * Send through Resend's REST API directly.
 *
 * No npm/esm import of the `resend` SDK on purpose: it would be a third
 * dependency downloaded at cold start for one POST we can write in ten lines,
 * and edge cold starts are already the slowest thing about this path.
 *
 * Returns a boolean rather than throwing — see the "one rule" note at the top.
 */
async function sendEmail(apiKey: string, from: string, msg: EmailMessage): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });

    if (!res.ok) {
      // Status + body, because Resend's failures are only diagnosable from the
      // body ("domain not verified", "from address not allowed", …). The body is
      // Resend's own text, never the token or the recipient's data.
      const body = await res.text().catch(() => "<unreadable>");
      console.error(`[send-notification] Resend rejected the send: ${res.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[send-notification] Resend request failed:", String(err));
    return false;
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, "public", "public", any, any>;

/**
 * booking_requested — the guest asked, nobody has said yes yet.
 *
 * Recipient chain: the hotel page that lists this room (hotels.contact_email),
 * then the platform desk. See the comment on the fallback for why "the property
 * owner" cannot be resolved to an address in this schema.
 */
async function handleBookingRequested(
  admin: Admin,
  bookingId: string,
): Promise<HandlerResult> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, room_id, guest_name, guest_phone, guest_email, check_in, check_out, adults, children, rate_per_night, total_amount, notes, status, source",
    )
    .eq("id", bookingId)
    .maybeSingle();

  const booking = data as BookingRow | null;
  if (error || !booking) {
    console.warn(`[send-notification] booking ${bookingId} not found; nothing to send.`);
    return null;
  }

  const { data: propertyData } = await admin
    .from("properties")
    .select("id, title, owner_id")
    .eq("id", booking.room_id)
    .maybeSingle();
  const property = propertyData as PropertyRow | null;

  // A room can appear on more than one hotel page (a user may run several).
  // Oldest listing wins — it is the page the room actually belongs to; the
  // others are re-listings.
  const { data: hotelRoomsData } = await admin
    .from("hotel_rooms")
    .select("hotel_id, created_at")
    .eq("property_id", booking.room_id)
    .order("created_at", { ascending: true })
    .limit(1);
  const hotelRooms = hotelRoomsData as HotelRoomRow[] | null;

  let hotelName: string | null = null;
  let recipient: string | null = null;

  const hotelId = hotelRooms?.[0]?.hotel_id;
  if (hotelId) {
    const { data: hotelData } = await admin
      .from("hotels")
      .select("id, name, contact_email")
      .eq("id", hotelId)
      .maybeSingle();
    const hotel = hotelData as HotelRow | null;
    hotelName = hotel?.name ?? null;
    recipient = hotel?.contact_email?.trim() || null;
  }

  if (!recipient) {
    // ── THE OWNER FALLBACK, AND WHY IT LANDS HERE ──────────────────────────
    // The intent is "fall back to the property owner". This schema cannot do
    // that: properties.owner_id is a Clerk id, and NO table in this database
    // stores an email for a user — profiles has no email column (that is stated
    // outright in 20260813000001 STEP 7, and is the whole reason hotel invites
    // are addressed to an email STRING), and profile_contacts holds phones only.
    // Emails live in Clerk, which this function does not talk to.
    //
    // So the owner fallback resolves to the platform desk: a human who can
    // phone the owner. That is a real fallback, not a silent drop. Fixing it
    // properly means either mirroring the Clerk email into profiles from
    // clerk-webhook, or asking owners for a notification address on their
    // hotel page.
    recipient = Deno.env.get("ADMIN_NOTIFY_EMAIL")?.trim() || null;
    if (recipient) {
      console.warn(
        `[send-notification] booking ${bookingId}: no hotel contact_email; falling back to ADMIN_NOTIFY_EMAIL. Owner ${property?.owner_id ?? "unknown"} has no address in this database.`,
      );
    }
  }

  if (!recipient) {
    // The booking is already committed and visible in /manage/hotel. Losing the
    // email is a degraded experience, not a failure worth a non-200.
    console.warn(
      `[send-notification] booking ${bookingId}: no recipient could be resolved (no hotel contact_email, no ADMIN_NOTIFY_EMAIL). Nothing sent.`,
    );
    return null;
  }

  const nights = nightsBetween(booking.check_in, booking.check_out);
  const roomTitle = property?.title || "a room";
  const guestName = booking.guest_name || "A guest";
  // The hotel will CALL, not email. The phone number is the point of this mail.
  const guestPhone = booking.guest_phone || "not provided";
  const guestEmail = booking.guest_email || "not provided";
  const guests = `${booking.adults ?? 1} adult(s)${
    Number(booking.children ?? 0) > 0 ? `, ${booking.children} child(ren)` : ""
  }`;
  const manageUrl = `${SITE_URL}/manage/hotel`;

  const subject = `New booking request — ${roomTitle}, ${formatDate(booking.check_in)}`;

  const text = [
    `New booking request${hotelName ? ` for ${hotelName}` : ""}.`,
    ``,
    `Room:      ${roomTitle}`,
    `Guest:     ${guestName}`,
    `Phone:     ${guestPhone}`,
    `Email:     ${guestEmail}`,
    `Check-in:  ${formatDate(booking.check_in)}`,
    `Check-out: ${formatDate(booking.check_out)}`,
    `Nights:    ${nights}`,
    `Guests:    ${guests}`,
    `Total:     ${formatMoney(booking.total_amount)} (${formatMoney(booking.rate_per_night)}/night)`,
    booking.notes ? `Notes:     ${booking.notes}` : ``,
    ``,
    `This request is NOT confirmed yet. Call the guest, then confirm or decline it here:`,
    manageUrl,
  ]
    .filter((line) => line !== ``)
    .join("\n");

  const html = renderHtml({
    heading: "New booking request",
    intro: hotelName
      ? `A guest has requested a room at ${escapeHtml(hotelName)}. Nothing is confirmed until you confirm it.`
      : "A guest has requested a room. Nothing is confirmed until you confirm it.",
    rows: [
      row("Room", roomTitle),
      row("Guest", guestName),
      row("Phone", guestPhone),
      row("Email", guestEmail),
      row("Check-in", formatDate(booking.check_in)),
      row("Check-out", formatDate(booking.check_out)),
      row("Nights", String(nights)),
      row("Guests", guests),
      row(
        "Total",
        `${formatMoney(booking.total_amount)} (${formatMoney(booking.rate_per_night)}/night)`,
      ),
      booking.notes ? row("Notes", booking.notes) : "",
    ].join(""),
    ctaLabel: "Open the booking",
    ctaUrl: escapeHtml(manageUrl),
    footer:
      "Call the guest to confirm — most guests here expect a phone call, not a reply to this email.",
  });

  return { to: recipient, subject, text, html };
}

/**
 * service_inquiry — someone filled in the services form.
 *
 * Recipient is always the platform desk. There is no per-service owner in the
 * schema: services are admin-managed (see the RLS on 20260805000002), so admin
 * is the correct and only audience.
 */
async function handleServiceInquiry(
  admin: Admin,
  inquiryId: string,
): Promise<HandlerResult> {
  const recipient = Deno.env.get("ADMIN_NOTIFY_EMAIL")?.trim();
  if (!recipient) {
    console.warn(
      `[send-notification] inquiry ${inquiryId}: ADMIN_NOTIFY_EMAIL is not set — nothing sent. The inquiry is still in the admin panel.`,
    );
    return null;
  }

  const { data, error } = await admin
    .from("service_inquiries")
    .select("id, service_id, property_id, sender_name, sender_email, sender_phone, message, created_at")
    .eq("id", inquiryId)
    .maybeSingle();

  const inquiry = data as ServiceInquiryRow | null;
  if (error || !inquiry) {
    console.warn(`[send-notification] inquiry ${inquiryId} not found; nothing to send.`);
    return null;
  }

  let serviceTitle = "a service";
  if (inquiry.service_id) {
    const { data: serviceData } = await admin
      .from("services")
      .select("title")
      .eq("id", inquiry.service_id)
      .maybeSingle();
    serviceTitle = (serviceData as ServiceRow | null)?.title || serviceTitle;
  }

  const senderName = inquiry.sender_name || "Someone";
  const senderEmail = inquiry.sender_email || "not provided";
  const senderPhone = inquiry.sender_phone || "not provided";
  const message = inquiry.message || "";
  const adminUrl = `${SITE_URL}/admin-panel`;

  const subject = `New service inquiry — ${serviceTitle}`;

  const text = [
    `New inquiry about: ${serviceTitle}`,
    ``,
    `From:  ${senderName}`,
    `Email: ${senderEmail}`,
    `Phone: ${senderPhone}`,
    ``,
    `Message:`,
    message,
    ``,
    adminUrl,
  ].join("\n");

  const html = renderHtml({
    heading: "New service inquiry",
    intro: `Someone asked about <strong>${escapeHtml(serviceTitle)}</strong>.`,
    rows: [
      row("From", senderName),
      row("Email", senderEmail),
      row("Phone", senderPhone),
      row("Message", message),
    ].join(""),
    ctaLabel: "Open the admin panel",
    ctaUrl: escapeHtml(adminUrl),
  });

  return { to: recipient, subject, text, html };
}

/** The columns both property notifications read. */
type PropertyNotifyRow = {
  id: string;
  title: string | null;
  type: string | null;
  location: string | null;
  price: number | string | null;
  deposit: number | string | null;
  is_daily_rate: boolean | null;
  is_listed: boolean | null;
  is_available: boolean | null;
  occupancy_status: string | null;
  bedrooms: number | null;
  toilets: number | null;
  owner_id: string | null;
  org_id: string | null;
  created_at: string | null;
};

/**
 * property_listed and property_available — both go to the platform desk.
 *
 * One handler, because the two emails differ only in framing: the facts, the
 * recipient and the link are identical, and two near-copies would drift the
 * first time someone adds a field to one of them.
 *
 * ── WHY THE DB STORES `villa` AND THE EMAIL SAYS "House" ────────────────────
 * The `property_type` enum was renamed house→villa in 20260323070000 but the UI
 * vocabulary never followed. Anyone reading these emails is looking at the same
 * listing in the admin panel, so the label has to match what they see there.
 */
async function handlePropertyEvent(
  admin: Admin,
  propertyId: string,
  kind: "listed" | "available",
): Promise<HandlerResult> {
  const recipient = Deno.env.get("ADMIN_NOTIFY_EMAIL")?.trim();
  if (!recipient) {
    console.warn(
      `[send-notification] property ${propertyId}: ADMIN_NOTIFY_EMAIL is not set — nothing sent. The listing is unaffected.`,
    );
    return null;
  }

  const { data, error } = await admin
    .from("properties")
    .select(
      "id, title, type, location, price, deposit, is_daily_rate, is_listed, is_available, occupancy_status, bedrooms, toilets, owner_id, org_id, created_at",
    )
    .eq("id", propertyId)
    .maybeSingle();

  const p = data as PropertyNotifyRow | null;
  if (error || !p) {
    // A row deleted between the trigger firing and this request is normal —
    // pg_net is fire-and-forget and does not join the transaction.
    console.warn(`[send-notification] property ${propertyId} not found; nothing to send.`);
    return null;
  }

  const title = p.title || "Untitled listing";
  const typeLabel =
    p.type === "villa" || p.type === "house"
      ? "House"
      : p.type === "apartment"
        ? "Apartment"
        : p.type === "hotel"
          ? "Hotel room"
          : p.type === "commercial"
            ? "Commercial"
            : (p.type || "Property");

  // Nightly vs monthly is not cosmetic: a $45/night room read as $45/month is a
  // 30x misstatement, and this email is what someone skims before acting.
  const perPeriod = p.is_daily_rate || p.type === "hotel" ? "night" : "month";
  const priceNum = p.price === null ? null : Number(p.price);
  const price =
    priceNum !== null && Number.isFinite(priceNum)
      ? `$${priceNum.toLocaleString("en-US")}/${perPeriod}`
      : "no price set";

  const rooms = [
    p.bedrooms != null ? `${p.bedrooms} bed` : null,
    p.toilets != null ? `${p.toilets} bath` : null,
  ]
    .filter(Boolean)
    .join(", ") || "not specified";

  const publicUrl = `${SITE_URL}/property/${p.id}`;
  const visibility = p.is_listed
    ? p.is_available
      ? "live on the marketplace"
      : "listed but not currently available"
    : "not listed publicly";

  const heading = kind === "listed" ? "New listing" : "Back on the market";
  const subject =
    kind === "listed"
      ? `New listing — ${title} (${p.location || "Mogadishu"})`
      : `Back on the market — ${title} (${p.location || "Mogadishu"})`;
  const intro =
    kind === "listed"
      ? `An owner registered a new ${typeLabel.toLowerCase()}.`
      : `A previously occupied unit is available to rent again.`;

  const text = [
    heading.toUpperCase(),
    ``,
    intro,
    ``,
    `Title:      ${title}`,
    `Type:       ${typeLabel}`,
    `District:   ${p.location || "not set"}`,
    `Price:      ${price}`,
    `Rooms:      ${rooms}`,
    `Occupancy:  ${p.occupancy_status || "not set"}`,
    `Visibility: ${visibility}`,
    // No email column exists on `profiles` — the Clerk id is genuinely all the
    // database knows about who owns this. Do not invent a lookup.
    `Owner:      ${p.owner_id || "unknown"}${p.org_id ? ` (agency ${p.org_id})` : ""}`,
    ``,
    publicUrl,
  ].join("\n");

  const html = renderHtml({
    heading,
    intro: escapeHtml(intro),
    rows: [
      row("Title", title),
      row("Type", typeLabel),
      row("District", p.location || "not set"),
      row("Price", price),
      row("Rooms", rooms),
      row("Occupancy", p.occupancy_status || "not set"),
      row("Visibility", visibility),
      row("Owner", `${p.owner_id || "unknown"}${p.org_id ? ` (agency ${p.org_id})` : ""}`),
    ].join(""),
    ctaLabel: "View the listing",
    ctaUrl: escapeHtml(publicUrl),
  });

  return { to: recipient, subject, text, html };
}

/**
 * hotel_invite — a hotel admin added someone to their team.
 *
 * ⚠ THE TOKEN IS THE CREDENTIAL. Read STEP 13 of 20260813000001: this project's
 * Clerk JWT carries no `email` claim, so the email-matching invite path can
 * never authorize anyone. Authorization is the secret in the link — whoever
 * holds `/join/<token>` can redeem it. Consequences enforced here:
 *
 *   • the token is NEVER logged (not even truncated) and NEVER put in a subject
 *     line — subjects show up in notification previews, on lock screens, and in
 *     mail-server logs that nobody audits;
 *   • the body says the link is single-use and states the expiry, so a
 *     forwarded link is at least a link the recipient knows is spent.
 */
async function handleHotelInvite(
  admin: Admin,
  inviteId: string,
): Promise<HandlerResult> {
  const { data, error } = await admin
    .from("hotel_invites")
    .select("id, hotel_id, email, role, permissions, token, expires_at, accepted_at")
    .eq("id", inviteId)
    .maybeSingle();

  const invite = data as HotelInviteRow | null;
  if (error || !invite) {
    console.warn(`[send-notification] invite ${inviteId} not found; nothing to send.`);
    return null;
  }

  const recipient = invite.email?.trim();
  if (!recipient) {
    console.warn(`[send-notification] invite ${inviteId} has no email; nothing to send.`);
    return null;
  }

  // Already redeemed before the mail went out (a re-run of the trigger, a
  // replayed pg_net request). Sending a dead link only generates a support
  // question.
  if (invite.accepted_at) {
    console.info(`[send-notification] invite ${inviteId} already accepted; nothing to send.`);
    return null;
  }

  const { data: hotelData } = await admin
    .from("hotels")
    .select("name")
    .eq("id", invite.hotel_id)
    .maybeSingle();

  const hotelName = (hotelData as HotelRow | null)?.name || "a hotel";

  // Plain words, not the enum. "agent" alone means nothing to a receptionist.
  const ROLE_WORDS: Record<string, string> = {
    admin: "Admin — full control of the hotel page, its rooms, bookings, staff and team",
    manager: "Manager — manages operations: rooms, bookings, staff, housekeeping and inquiries",
    agent: "Agent — can manage listings, bookings and day-to-day operations",
    viewer: "Viewer — can see the hotel information, but cannot change anything",
  };
  const roleWords = ROLE_WORDS[invite.role] ?? invite.role;

  // Build a task list label from explicit permissions (if any were granted)
  const TASK_LABELS: Record<string, string> = {
    list: "List new rooms / properties",
    edit: "Edit pages & listings",
    publish: "Publish / unpublish",
    bookings: "Manage bookings & front desk",
    inquiries: "Respond to inquiries",
  };
  const permissionsList = (invite.permissions ?? [])
    .filter((t) => TASK_LABELS[t])
    .map((t) => `  • ${TASK_LABELS[t]}`)
    .join("\n");
  const permissionsSection = permissionsList
    ? `\nYou have also been granted these specific permissions:\n${permissionsList}\n`
    : "";

  const joinUrl = `${SITE_URL}/join/${invite.token}`;
  const expires = new Date(invite.expires_at);
  const expiresLabel = Number.isNaN(expires.getTime())
    ? "soon"
    : expires.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  // No token, no hotel-internal detail. Subjects leak to lock screens.
  const subject = `You've been invited to join ${hotelName} on Mogadishu Rents`;

  const text = [
    `You've been invited to join ${hotelName} on Mogadishu Rents.`,
    ``,
    `Your role: ${roleWords}${permissionsSection}`,
    ``,
    `Open this link while signed in to accept:`,
    joinUrl,
    ``,
    `This link works ONCE and expires on ${expiresLabel}. Anyone who has the link`,
    `can use it, so don't forward it. If you weren't expecting this, ignore it —`,
    `nothing happens until the link is opened.`,
  ].join("\n");

  const html = renderHtml({
    heading: `Join ${escapeHtml(hotelName)}`,
    intro:
      `You've been invited to the team for <strong>${escapeHtml(hotelName)}</strong> on Mogadishu Rents.`,
    rows: [
      row("Hotel", hotelName),
      row("Your role", roleWords),
      ...(permissionsList
        ? [row("Extra permissions", permissionsList.replace(/\n/g, "<br>"))]
        : []),
    ].join(""),
    ctaLabel: "Accept the invitation",
    // The URL sits in an href, so it is escaped like every other interpolation.
    ctaUrl: escapeHtml(joinUrl),
    footer:
      `This link works <strong>once</strong> and expires on ${escapeHtml(expiresLabel)}. ` +
      `Anyone who has the link can use it — please don't forward it. ` +
      `If you weren't expecting this invitation, you can ignore this email.`,
  });

  return { to: recipient, subject, text, html };
}

/**
 * property_listed / property_available — the platform's supply feed.
 *
 * ONE handler for both, because the facts are identical and only the framing
 * differs. Keeping them as two `type`s rather than one with a flag means the
 * trigger side stays dumb (each trigger states what it saw, it does not compute
 * anything) and the subject lines can differ without a branch at the call site.
 *
 *   property_listed    — a row appeared in `properties`. A NEW unit exists.
 *   property_available — an existing row's `is_available` went false → true.
 *                        The unit is BACK on the market, not new.
 *
 * ⚠ HTML INJECTION. `title` and `description` are owner-written free text typed
 * into the AddProperty form, and `location` is a free-text district, not an
 * enum. Every single one of them goes through escapeHtml() below. The plain-text
 * body is not an injection sink but is built from the same values, so nothing is
 * duplicated in a form that could drift.
 *
 * There is NO owner email to CC. properties.owner_id is a Clerk id and no table
 * in this database stores an address for a user — the same wall the booking
 * handler documents above. So the Clerk id itself goes in the body: it is the
 * only handle an admin has, and it is enough to find the person in the Clerk
 * dashboard. Do not add a `profiles` lookup here; there is no email column to
 * look up.
 */
async function handlePropertyNotice(
  admin: Admin,
  propertyId: string,
  kind: "listed" | "available",
): Promise<HandlerResult> {
  // Checked first, before the read: with no desk to mail, the read is wasted
  // work on a path that fires on every property insert in the system.
  const recipient = Deno.env.get("ADMIN_NOTIFY_EMAIL")?.trim();
  if (!recipient) {
    console.warn(
      `[send-notification] property_${kind} ${propertyId}: ADMIN_NOTIFY_EMAIL is not set — nothing sent. The property is still in the admin panel.`,
    );
    return null;
  }

  const { data, error } = await admin
    .from("properties")
    .select(
      "id, title, description, type, price, is_daily_rate, location, bedrooms, toilets, occupancy_status, is_listed, is_available, owner_id, created_at",
    )
    .eq("id", propertyId)
    .maybeSingle();

  const property = data as PropertyDetailRow | null;
  if (error || !property) {
    // Normal, not alarming: pg_net is asynchronous and does not join the
    // transaction that queued it, so an insert that rolled back after the
    // trigger fired lands right here. Nothing to send is the correct outcome.
    console.warn(
      `[send-notification] property ${propertyId} not found (rolled back, or deleted before we read it); nothing to send.`,
    );
    return null;
  }

  const title = property.title || "Untitled listing";
  const kindLabel = property.type || "unknown type";
  const district = property.location || "not given";
  // The period is the difference between a hotel room and a rental. Printing
  // "$45" with no period has burned people reading these at a glance.
  const period = property.is_daily_rate ? "/night" : "/month";
  const price = `${formatMoney(property.price)}${period}`;
  const bedrooms = property.bedrooms ?? 0;
  // `toilets` is the bathroom count in this schema — see PropertyDetailRow.
  const bathrooms = property.toilets ?? 0;
  const occupancy = property.occupancy_status || "unknown";
  // is_listed is the owner's intent ("show this publicly"); is_available is the
  // computed truth the marketplace filters on. Print both — an owner who ticked
  // "occupied" gets a listing that is registered but invisible, and the admin
  // needs to see that this is on purpose rather than a bug.
  const publiclyListed = property.is_listed
    ? "Yes — the owner has it switched on"
    : "No — the owner is holding it back";
  const visibleNow = property.is_available
    ? "Yes — it is showing in the public rental cards now"
    : "No — not showing publicly (it is occupied, unlisted, or both)";
  const ownerId = property.owner_id || "unknown";
  // Long descriptions turn the mail into a wall. This is a triage notice.
  const rawDescription = (property.description || "").trim();
  const description = rawDescription.length > 400
    ? `${rawDescription.slice(0, 400)}…`
    : rawDescription;

  const propertyUrl = `${SITE_URL}/property/${property.id}`;

  const isNew = kind === "listed";

  const subject = isNew
    ? `New listing — ${title} (${district})`
    : `Back on the market — ${title} (${district})`;

  const heading = isNew ? "A new listing was created" : "A listing is available again";

  // The lead line carries the whole distinction. An admin reading on a phone
  // sees the subject and this sentence and nothing else.
  const leadText = isNew
    ? "An owner has just registered a new property on Mogadishu Rents."
    : "An existing property has come back onto the market — it was unavailable and is now free to rent again. This is NOT a new listing.";

  // ── The one case worth calling out in a NEW-listing mail ──────────────────
  // The INSERT trigger fires on every row, including a unit registered as
  // already occupied. That is intentional (the platform wants to know its
  // supply, not just its shop window), so the body has to say why an admin who
  // clicks through will find nothing on the public page.
  const notNew = !isNew;
  const occupiedOnArrival = isNew && property.is_available !== true;
  const footnote = occupiedOnArrival
    ? "Note: this unit is registered but NOT publicly visible — it was filed as occupied and/or unlisted. It is still new supply worth knowing about; you will get a second email if and when it becomes available to rent."
    : notNew
    ? "You are getting this because the unit's availability flipped from unavailable to available. Editing a price or a photo on an already-available unit does not send this email."
    : "";

  const text = [
    isNew ? `NEW LISTING` : `BACK ON THE MARKET`,
    ``,
    leadText,
    ``,
    `Title:      ${title}`,
    `Type:       ${kindLabel}`,
    `District:   ${district}`,
    `Price:      ${price}`,
    `Bedrooms:   ${bedrooms}`,
    `Bathrooms:  ${bathrooms}`,
    `Occupancy:  ${occupancy}`,
    `Listed:     ${publiclyListed}`,
    `Visible:    ${visibleNow}`,
    `Owner:      ${ownerId} (Clerk user id — look them up in the Clerk`,
    `            dashboard; this database holds no email for a user)`,
    ...(description ? [``, `Description:`, description] : []),
    ``,
    propertyUrl,
    ...(footnote ? [``, footnote] : []),
  ].join("\n");

  const html = renderHtml({
    heading,
    // escapeHtml even here: `leadText` is ours, but the pattern is "nothing
    // reaches the template unescaped", and an exception is how the next edit
    // introduces a hole.
    intro: escapeHtml(leadText),
    rows: [
      row("Title", title),
      row("Type", kindLabel),
      row("District", district),
      row("Price", price),
      row("Bedrooms", String(bedrooms)),
      row("Bathrooms", String(bathrooms)),
      row("Occupancy", occupancy),
      row("Publicly listed", publiclyListed),
      row("Visible now", visibleNow),
      row("Owner (Clerk id)", ownerId),
      description ? row("Description", description) : "",
    ].join(""),
    ctaLabel: "Open the listing",
    ctaUrl: escapeHtml(propertyUrl),
    footer: footnote
      ? escapeHtml(footnote)
      : "Sent automatically by Mogadishu Rents. Please do not reply to this address.",
  });

  return { to: recipient, subject, text, html };
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  // ── 1. Verify the shared secret BEFORE touching the payload ────────────────
  // Same posture as clerk-webhook's Svix check. Anyone who finds this URL must
  // not be able to make it read rows or send mail; 401 is the only non-200 this
  // function ever returns.
  const NOTIFY_SECRET = Deno.env.get("NOTIFY_WEBHOOK_SECRET");
  if (!NOTIFY_SECRET) {
    // Fail CLOSED. An unset secret means "unauthenticated send endpoint", which
    // is strictly worse than "no notifications".
    console.error(
      "[send-notification] NOTIFY_WEBHOOK_SECRET is not set — rejecting every request. See docs/NOTIFICATIONS.md.",
    );
    return json({ error: "Not configured." }, 401);
  }

  const presented = req.headers.get("x-notify-secret") ?? "";
  if (!(await timingSafeEqual(presented, NOTIFY_SECRET))) {
    console.warn("[send-notification] rejected a request with a bad or missing x-notify-secret.");
    return json({ error: "Unauthorized." }, 401);
  }

  // ── 2. Parse ───────────────────────────────────────────────────────────────
  let payload: NotifyPayload;
  try {
    payload = (await req.json()) as NotifyPayload;
  } catch {
    // ACK rather than 400: pg_net cannot fix a malformed body by retrying.
    console.warn("[send-notification] unparseable body; acknowledged and dropped.");
    return json({ ok: true, ignored: "unparseable_body" });
  }

  const type = payload?.type as NotificationType | undefined;

  // ── 3. Resend key is OPTIONAL ──────────────────────────────────────────────
  // Deliberately mirrors src/lib/analytics.ts: a missing key disables the
  // feature instead of breaking the thing it is attached to. There, a missing
  // VITE_POSTHOG_KEY must never break a submit handler. Here, a missing
  // RESEND_API_KEY must never turn into a retrying 500 against a database that
  // has already committed the booking. Log once, return 200, move on.
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.info(
      `[send-notification] RESEND_API_KEY is not set — email is disabled, "${type ?? "unknown"}" not sent. See docs/NOTIFICATIONS.md.`,
    );
    return json({ ok: true, skipped: "no_resend_key" });
  }

  const FROM_EMAIL = Deno.env.get("FROM_EMAIL")?.trim() || FROM_EMAIL_FALLBACK;
  if (FROM_EMAIL === FROM_EMAIL_FALLBACK) {
    console.warn(
      `[send-notification] FROM_EMAIL is not set — using the placeholder "${FROM_EMAIL}". Resend WILL reject this.`,
    );
  }

  // ── 4. Service-role client (bypasses RLS) ──────────────────────────────────
  // Required, not convenience: service_inquiries is admin-only for SELECT and
  // hotel_invites is admin-only too, so an anon client would read nothing.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let message: HandlerResult = null;

    switch (type) {
      case "booking_requested": {
        if (!payload.booking_id) {
          console.warn("[send-notification] booking_requested without booking_id.");
          return json({ ok: true, ignored: "missing_booking_id" });
        }
        message = await handleBookingRequested(admin, payload.booking_id);
        break;
      }

      case "service_inquiry": {
        if (!payload.inquiry_id) {
          console.warn("[send-notification] service_inquiry without inquiry_id.");
          return json({ ok: true, ignored: "missing_inquiry_id" });
        }
        message = await handleServiceInquiry(admin, payload.inquiry_id);
        break;
      }

      case "hotel_invite": {
        if (!payload.invite_id) {
          console.warn("[send-notification] hotel_invite without invite_id.");
          return json({ ok: true, ignored: "missing_invite_id" });
        }
        message = await handleHotelInvite(admin, payload.invite_id);
        break;
      }

      case "property_listed": {
        if (!payload.property_id) {
          console.warn("[send-notification] property_listed without property_id.");
          return json({ ok: true, ignored: "missing_property_id" });
        }
        message = await handlePropertyEvent(admin, payload.property_id, "listed");
        break;
      }

      case "property_available": {
        if (!payload.property_id) {
          console.warn("[send-notification] property_available without property_id.");
          return json({ ok: true, ignored: "missing_property_id" });
        }
        message = await handlePropertyEvent(admin, payload.property_id, "available");
        break;
      }

      default:
        // ACK unknown types so the caller stops retrying — same posture as
        // clerk-webhook's default branch.
        console.warn(`[send-notification] unknown type "${type}"; acknowledged and ignored.`);
        return json({ ok: true, ignored: type ?? "missing_type" });
    }

    if (!message) {
      // The handler already logged why. Nothing to send is a normal outcome.
      return json({ ok: true, sent: false });
    }

    const sent = await sendEmail(RESEND_API_KEY, FROM_EMAIL, message);
    // 200 either way — see the "one rule" note at the top of this file.
    return json({ ok: true, sent, type });
  } catch (err) {
    // Even an unexpected throw ACKs. The row this notification describes is
    // already committed; a 500 here only buys a pg_net retry storm.
    console.error("[send-notification] unhandled error:", String(err));
    return json({ ok: true, sent: false, error: "handled" });
  }
});
