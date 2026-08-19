// Sifalo Pay — start a payment, and settle it when the provider calls back.
//
// Two routes on one function, chosen by the path:
//   POST /sifalo-payment/create    — a guest asks to pay; we charge their wallet
//   POST /sifalo-payment/callback  — Sifalo tells us how it went
//
// Follows the structure of supabase/functions/send-notification/index.ts: CORS
// headers, OPTIONS handling, secret verification BEFORE the payload is trusted,
// a service-role client for every read, and typed row shapes because this repo
// has no generated `Database` type.
//
// ── THE RULE THIS FILE IS BUILT AROUND ─────────────────────────────────────
// THE CLIENT NEVER SAYS WHAT SOMETHING COSTS. `/create` is handed a booking id
// and a payment option, and re-reads the room, the nights and the hotel's
// deposit percentage from Postgres to work out the amount itself. A browser
// that posts `amount: 0.01` for a $450 stay gets charged $450, because the
// number it sent is never read. This is the single most important property of
// this file — every other check here is secondary to it.
//
// ── WHY THE CREDENTIALS LIVE HERE ──────────────────────────────────────────
// Sifalo authenticates with an API User and an API Key issued from
// https://pay.sifalo.com/business/merchant/api. Anything under src/ ships to the
// browser, so the keys cannot go there. This function is the only thing in the
// project that may hold them.
//
// ── WHAT IS AND IS NOT VERIFIED FROM THE PROVIDER ──────────────────────────
// `/callback` requires SIFALO_CALLBACK_SECRET on the `x-sifalo-secret` header,
// which is a shared secret we set on the Sifalo dashboard's callback URL, not a
// signature we compute. If Sifalo later publishes an HMAC signing scheme,
// replace `verifyCallback` with it — the rest of this file does not change. Do
// NOT relax that check: without it this URL is "mark any booking paid".
//
// Required env (Supabase → Edge Functions → Secrets):
//   SIFALO_API_USER          — from the merchant dashboard
//   SIFALO_API_KEY           — from the merchant dashboard. Never in src/.
//   SIFALO_CALLBACK_SECRET   — our own random string; also set as the callback
//                              URL's `secret` query/header on the dashboard.
//   SUPABASE_URL             — injected by the platform
//   SUPABASE_SERVICE_ROLE_KEY— injected by the platform
//   SIFALO_API_BASE          — OPTIONAL. Defaults below. Override without a
//                              redeploy if Sifalo moves the endpoint.
//
// Deploy: npx supabase functions deploy sifalo-payment
//
// ── UNVERIFIED AGAINST A LIVE MERCHANT ACCOUNT ─────────────────────────────
// The request shape below (account / gateway / amount / currency / order_id)
// comes from Sifalo's published integration material. The exact endpoint PATH
// and the response field names could not be confirmed without merchant
// credentials, so both are isolated in `SIFALO` and `readProviderRef` — if the
// first live payment fails, those two are what to correct, and nothing else in
// this file should need to change.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sifalo-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Everything provider-specific, in one place. */
const SIFALO = {
  base: Deno.env.get("SIFALO_API_BASE") ?? "https://api.sifalo.com",
  createPath: "/api/v1/payments",
};

// ── Row shapes (no generated Database type in this repo) ─────────────────────

interface BookingRow {
  id: string;
  room_id: string;
  org_id: string | null;
  total_amount: number | null;
  payment_status: string;
  status: string;
}

interface HotelRow {
  id: string;
  name: string;
  payment_options: string[] | null;
  deposit_percent: number | null;
}

// ── Amount rules — MUST match src/lib/payments.ts ────────────────────────────
// Duplicated rather than imported: an edge function cannot import from the app
// bundle. src/test/payments.test.ts pins the rounding so the two cannot drift
// without a test failing.

function clampPercent(percent: number | null | undefined): number {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 1 || n > 100) return 25;
  return Math.round(n);
}

function amountDueNow(total: number, option: string, depositPercent: number): number {
  if (option === "at_hotel") return 0;
  if (option === "pay_now") return Math.round(total * 100) / 100;
  return Math.ceil((total * clampPercent(depositPercent)) / 100 * 100) / 100;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const route = url.pathname.split("/").filter(Boolean).pop();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("[sifalo] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
    return json({ error: "Payments are not configured." }, 500);
  }
  const db = createClient(supabaseUrl, serviceKey);

  try {
    if (route === "create") return await handleCreate(req, db);
    if (route === "callback") return await handleCallback(req, db);
  } catch (err) {
    console.error("[sifalo] unhandled", err);
    return json({ error: "Payment could not be processed." }, 500);
  }

  return json({ error: "Not found" }, 404);
});

/**
 * Open a payment and push it to the guest's wallet.
 *
 * Returns the payment id so the client can poll, and whatever redirect the
 * provider gives us for card payments. Never returns the provider's raw body —
 * it can carry merchant-side detail a guest has no business seeing.
 */
async function handleCreate(req: Request, db: ReturnType<typeof createClient>) {
  const body = await req.json().catch(() => ({}));
  const bookingId = String(body?.booking_id ?? "");
  const option = String(body?.payment_option ?? "");
  const gateway = String(body?.gateway ?? "");
  const account = String(body?.account ?? "").replace(/\D/g, "");

  if (!bookingId || !option || !gateway) {
    return json({ error: "Missing booking, payment option or wallet." }, 400);
  }
  if (option === "at_hotel") {
    // Not an error the guest caused, but there is nothing to charge and calling
    // the provider with a zero amount would create a junk transaction.
    return json({ error: "That option does not take a payment." }, 400);
  }

  const { data: booking, error: bookingError } = await db
    .from("bookings")
    .select("id, room_id, org_id, total_amount, payment_status, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return json({ error: "Booking not found." }, 404);
  }
  const b = booking as unknown as BookingRow;

  if (b.payment_status === "paid") {
    return json({ error: "This booking is already paid." }, 409);
  }

  // The hotel that owns the room decides what it accepts and what a deposit is.
  const { data: hotelRow } = await db
    .from("hotel_rooms")
    .select("hotels!hotel_id(id, name, payment_options, deposit_percent)")
    .eq("property_id", b.room_id)
    .maybeSingle();

  const hotel = (hotelRow as unknown as { hotels: HotelRow | null } | null)?.hotels ?? null;
  const offered = hotel?.payment_options ?? ["pay_now", "deposit", "at_hotel"];
  if (!offered.includes(option)) {
    return json({ error: "This hotel does not offer that payment option." }, 400);
  }

  // THE AMOUNT. Computed here, from the booking row, never from the request.
  const total = Number(b.total_amount ?? 0);
  const amount = amountDueNow(total, option, clampPercent(hotel?.deposit_percent));
  if (!(amount > 0)) {
    return json({ error: "Nothing to pay on this booking." }, 400);
  }

  const { data: payment, error: paymentError } = await db
    .from("payments")
    .insert({
      booking_id: b.id,
      purpose: "booking",
      kind: option === "deposit" ? "deposit" : "full",
      provider: "sifalo",
      gateway,
      account,
      amount,
      currency: "USD",
      status: "pending",
    })
    .select("id")
    .single();

  if (paymentError || !payment) {
    console.error("[sifalo] could not open payment", paymentError);
    return json({ error: "Could not start the payment." }, 500);
  }
  const paymentId = (payment as { id: string }).id;

  // Record WHAT THE GUEST CHOSE on the booking itself, so the front desk sees
  // "deposit" rather than having to infer it from the ledger. Done here rather
  // than by widening create_booking_request's signature: a guest who picks
  // "pay at the hotel" opens no payment at all, and 'at_hotel' is already the
  // column default — so the only case that needs writing is the one that
  // reaches this function anyway.
  await db.from("bookings").update({ payment_option: option }).eq("id", b.id);

  const apiUser = Deno.env.get("SIFALO_API_USER");
  const apiKey = Deno.env.get("SIFALO_API_KEY");
  if (!apiUser || !apiKey) {
    // Configuration, not the guest's fault. The pending row stays so the desk
    // can see that somebody tried and why it went nowhere.
    console.error("[sifalo] SIFALO_API_USER / SIFALO_API_KEY not set");
    await db.rpc("record_payment_result", {
      _payment_id: paymentId,
      _status: "failed",
      _failure_reason: "Sifalo credentials are not configured on the server.",
    });
    return json({ error: "Online payment is not switched on yet." }, 503);
  }

  // `order_id` is our payment id, which is what makes the callback matchable.
  const providerBody = {
    account,
    gateway,
    amount: amount.toFixed(2),
    currency: "USD",
    order_id: paymentId,
    description: `Booking at ${hotel?.name ?? "hotel"}`,
  };

  let providerJson: Record<string, unknown> = {};
  let ok = false;
  try {
    const res = await fetch(`${SIFALO.base}${SIFALO.createPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-USER": apiUser,
        "API-KEY": apiKey,
      },
      body: JSON.stringify(providerBody),
    });
    providerJson = await res.json().catch(() => ({}));
    ok = res.ok;
  } catch (err) {
    console.error("[sifalo] provider unreachable", err);
  }

  if (!ok) {
    await db.rpc("record_payment_result", {
      _payment_id: paymentId,
      _status: "failed",
      _raw: providerJson,
      _failure_reason: readMessage(providerJson) ?? "The payment service did not respond.",
    });
    return json(
      { error: readMessage(providerJson) ?? "The payment could not be started. Try again." },
      502,
    );
  }

  // Some gateways settle synchronously and some push to the handset and call
  // back. Record a reference either way; the callback is still the only thing
  // that may mark it paid.
  const ref = readProviderRef(providerJson);
  if (ref) {
    await db.from("payments").update({ provider_ref: ref, raw: providerJson }).eq("id", paymentId);
  }

  return json({
    payment_id: paymentId,
    amount,
    // Present for card flows; absent for a wallet push, where the guest just
    // approves on their handset and we wait for the callback.
    redirect_url: readString(providerJson, ["redirect_url", "checkout_url", "url"]),
  });
}

/**
 * Sifalo reporting the outcome.
 *
 * Returns 200 for everything except a bad secret. The payment either settled or
 * did not; a non-200 makes the provider retry, and a retry storm helps nobody
 * when the problem is our own bug.
 */
async function handleCallback(req: Request, db: ReturnType<typeof createClient>) {
  const expected = Deno.env.get("SIFALO_CALLBACK_SECRET");
  if (!expected) {
    console.error("[sifalo] SIFALO_CALLBACK_SECRET not set — refusing callbacks");
    return json({ error: "Not configured" }, 503);
  }
  const url = new URL(req.url);
  const supplied = req.headers.get("x-sifalo-secret") ?? url.searchParams.get("secret") ?? "";
  if (supplied !== expected) {
    // The one case that is NOT 200: an unauthenticated caller must not learn
    // whether a payment id exists.
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const paymentId = readString(body, ["order_id", "orderId", "reference"]);
  if (!paymentId) {
    console.error("[sifalo] callback carried no order_id", body);
    return json({ ok: true });
  }

  const state = (readString(body, ["status", "state", "result"]) ?? "").toLowerCase();
  const paid = ["paid", "success", "successful", "completed", "approved"].includes(state);
  const cancelled = ["cancelled", "canceled", "expired"].includes(state);

  const { error } = await db.rpc("record_payment_result", {
    _payment_id: paymentId,
    _status: paid ? "paid" : cancelled ? "cancelled" : "failed",
    _provider_ref: readProviderRef(body),
    _raw: body,
    _failure_reason: paid ? null : readMessage(body) ?? `Provider reported "${state || "unknown"}".`,
  });

  if (error) {
    // Logged loudly, still 200 — see the note at the top of this handler.
    console.error("[sifalo] record_payment_result failed", error);
  }
  return json({ ok: true });
}

// ── Reading a provider body without betting on one field name ────────────────

function readString(source: unknown, keys: string[]): string | null {
  const obj = (source ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** The provider's own id for this transaction, whatever it chose to call it. */
function readProviderRef(source: unknown): string | null {
  return readString(source, ["transaction_id", "transactionId", "reference", "id", "txn_id"]);
}

function readMessage(source: unknown): string | null {
  return readString(source, ["message", "error", "description", "reason"]);
}
