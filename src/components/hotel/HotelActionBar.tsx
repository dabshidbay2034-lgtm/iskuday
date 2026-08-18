import type { CSSProperties } from "react";
import { CalendarCheck, MessageCircle, Phone } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "How do I actually book this?" — the one answer, shared by every hotel surface.
 *
 * In Somalia a hotel booking happens on WhatsApp, or on the phone. Everything
 * else on a hotel page is context for that one tap, so the tap must never be
 * more than a thumb away: a pinned button in the page nav, and a fixed bar at
 * the bottom of the screen on mobile.
 *
 * Both the platform page (`/hotels/:slug`, HotelPage) and the tenant subdomain
 * (TenantShell) render these, so the rules — WhatsApp beats phone, a number
 * that isn't dialable renders nothing rather than a dead button — live here
 * once instead of being re-derived per surface.
 */

/**
 * The minimum a caller has to know about a hotel to offer to contact it.
 *
 * Structurally satisfied by both `PageBrand` (via `brandFromHotel`) and the
 * narrower `TenantHotel` the subdomain shell reads, so neither surface needs a
 * conversion step.
 */
export type HotelContactSource = {
  name?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  accentColor?: string | null;
};

/**
 * Below this many digits it is a typo, a placeholder or an extension — not a
 * number anyone can reach the hotel on. Somali mobiles are 9 digits before the
 * +252 country code, so this is a floor, not a format check: owners store their
 * number every which way and we are not in the business of rejecting theirs.
 */
const MIN_DIALABLE_DIGITS = 6;

/**
 * `https://wa.me/<digits>` — the only WhatsApp link format that works.
 *
 * wa.me chokes on spaces, dashes, brackets and a leading `+`, and owners type
 * all of them ("+252 61 234 5678"), so every non-digit is stripped.
 */
export function whatsappHref(raw?: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= MIN_DIALABLE_DIGITS ? `https://wa.me/${digits}` : null;
}

/** `tel:` link, keeping a leading `+` because dialers need the country code. */
export function telHref(raw?: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < MIN_DIALABLE_DIGITS) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** Whether this hotel can be reached at all — i.e. whether a bar/button exists. */
export function hasHotelContact(hotel: HotelContactSource): boolean {
  return Boolean(whatsappHref(hotel.contactWhatsapp) || telHref(hotel.contactPhone));
}

/**
 * Where "Book now" goes: WhatsApp, else phone, else whatever on-page anchor the
 * caller offers (`#contact`, `#rooms`), else nowhere — and "nowhere" means the
 * button is not rendered. A CTA that does nothing is worse than no CTA.
 */
export function bookingHref(
  hotel: HotelContactSource,
  fallbackHref?: string | null,
): string | null {
  return (
    whatsappHref(hotel.contactWhatsapp) ??
    telHref(hotel.contactPhone) ??
    (fallbackHref || null)
  );
}

/**
 * The hotel's accent as a background. Owner-supplied data, so it goes inline —
 * a Tailwind class can't hold a value from the database. When the hotel has no
 * accent the caller falls back to the `primary` design token instead of a
 * hard-coded colour.
 */
function accentBackground(hotel: HotelContactSource): CSSProperties | undefined {
  const accent = hotel.accentColor?.trim();
  return accent ? { backgroundColor: accent } : undefined;
}

const isWhatsApp = (href: string) => href.startsWith("https://wa.me/");

function ActionIcon({ href, className }: { href: string; className?: string }) {
  if (isWhatsApp(href)) return <MessageCircle className={className} />;
  if (href.startsWith("tel:")) return <Phone className={className} />;
  return <CalendarCheck className={className} />;
}

/**
 * The pinned "Book now" pill.
 *
 * A plain <a>, never a react-router <Link>: every destination it can have is
 * either an external scheme (`https://wa.me`, `tel:`) or a same-document anchor,
 * and it is rendered by the subdomain shell too, which must not assume a Router
 * above it.
 */
export function HotelBookButton({
  hotel,
  fallbackHref,
  label = "Book now",
  className,
}: {
  hotel: HotelContactSource;
  /** Same-page anchor to use when the hotel has no phone and no WhatsApp. */
  fallbackHref?: string | null;
  label?: string;
  className?: string;
}) {
  const href = bookingHref(hotel, fallbackHref);
  if (!href) return null;

  const style = accentBackground(hotel);
  const external = isWhatsApp(href);

  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      style={style}
      className={cn(
        "shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2",
        "text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90",
        !style && "bg-primary text-primary-foreground",
        className,
      )}
    >
      <ActionIcon href={href} className="w-4 h-4 shrink-0" />
      {label}
    </a>
  );
}

/**
 * The fixed bottom bar on phones: WhatsApp and Call, nothing else.
 *
 * ── WHY THIS AND `BottomNav` NEVER BOTH RENDER ─────────────────────────────
 * The platform's `BottomNav` is `md:hidden fixed bottom-0 z-50` — exactly the
 * strip this bar wants. Stacking them would cost ~8rem of a phone screen and
 * put "Saved / Account" between the visitor and the booking. So on a hotel page
 * this bar REPLACES BottomNav: the hotel's page exists to convert a visitor
 * into a booking, and platform navigation is still one tap away in the sticky
 * <Header/> at the top. The swap is conditional — a hotel with no reachable
 * number renders no bar, and its page keeps BottomNav rather than losing its
 * bottom chrome for nothing. Callers therefore branch on `hasHotelContact()`.
 *
 * Same z-50 and `safe-area-bottom` as BottomNav so it clears the iPhone home
 * indicator and sits above page content identically; callers already pad the
 * page with `pb-20 md:pb-0` for exactly this height.
 */
export function HotelMobileActionBar({
  hotel,
  className,
}: {
  hotel: HotelContactSource;
  className?: string;
}) {
  const whatsapp = whatsappHref(hotel.contactWhatsapp);
  const tel = telHref(hotel.contactPhone);
  if (!whatsapp && !tel) return null;

  const style = accentBackground(hotel);
  const both = Boolean(whatsapp && tel);

  return (
    <div
      role="group"
      aria-label={`Contact ${hotel.name?.trim() || "this hotel"}`}
      className={cn(
        "md:hidden fixed bottom-0 left-0 right-0 z-50",
        "border-t border-border bg-card/95 backdrop-blur-lg safe-area-bottom",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            style={style}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-full",
              "text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90",
              !style && "bg-primary text-primary-foreground",
            )}
          >
            <MessageCircle className="w-4 h-4 shrink-0" /> WhatsApp
          </a>
        )}
        {tel && (
          <a
            href={tel}
            className={cn(
              "inline-flex items-center justify-center gap-2 h-11 rounded-full",
              "border border-border bg-background text-sm font-semibold text-foreground",
              "transition-colors hover:bg-muted",
              // Alone it is the booking button and takes the whole bar; next to
              // WhatsApp it is the secondary option and only needs its label.
              both ? "px-6" : "flex-1",
            )}
          >
            <Phone className="w-4 h-4 shrink-0" /> Call
          </a>
        )}
      </div>
    </div>
  );
}
