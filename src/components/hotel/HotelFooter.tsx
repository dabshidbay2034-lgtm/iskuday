import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Building2, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone, Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { HotelPageRef } from "@/lib/hotel-links";
import type { HotelSocials } from "@/hooks/use-hotels";

/**
 * The footer every page of a hotel's site carries.
 *
 * A hotel's three pages used to end in three different ways — one with a
 * `contact` block, the others with a one-line "Powered by Mogadishu Rents" bar —
 * so they read as three separate documents rather than one website. This is the
 * shared bottom of the site: the hotel's identity, how to reach it, and links to
 * its other published pages, on every page.
 *
 * ── WORKS ON BOTH HOSTS ────────────────────────────────────────────────────
 * The same hotel is served from two places, and they disagree about URLs:
 *
 *   platform  `/hotels/:slug` and `/hotels/:slug/:pageSlug`
 *   tenant    `/` and `/:pageSlug`   (jazeera.mogadishurents.com)
 *
 * So the footer never builds a path itself — the caller passes `pagePath`, and
 * `platformHotelPagePath` / `tenantHotelPagePath` in `@/lib/hotel-links` are the
 * two ready-made builders. `linkMode` exists for the same reason: TenantShell
 * may be mounted
 * ABOVE the Router, where a react-router <Link> throws, so plain <a> is the
 * default and the platform page opts into client-side navigation.
 *
 * ── DATA ───────────────────────────────────────────────────────────────────
 * Everything comes off the existing hotel record — no new columns. Every
 * section is conditional: a hotel with no socials gets no social row, one with
 * no address gets no address line, rather than an empty shell.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Structural, not a `Hotel` or a `PageBrand`, so both callers fit: the platform
 * page passes `brandFromHotel(hotel)` and the subdomain shell can pass its
 * slimmer `TenantHotel` without inventing the fields it doesn't load.
 */
export type HotelFooterBrand = {
  name: string;
  /** Owner-supplied hex — data, not a design token, so it is applied inline. */
  accentColor: string;
  logoUrl?: string | null;
  tagline?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  mapsUrl?: string | null;
  socials?: HotelSocials | null;
};

/** One published page of the hotel, as the footer needs it. */
export type HotelFooterPage = HotelPageRef & {
  id: string;
  title: string;
};

export type HotelFooterProps = {
  brand: HotelFooterBrand;
  /** PUBLISHED pages only — the caller filters; drafts must never be linked. */
  pages?: HotelFooterPage[];
  /** Path builder for this host — `platformHotelPagePath` / `tenantHotelPagePath`. */
  pagePath: (page: HotelFooterPage) => string;
  /** The page being viewed, so its own link is marked and not offered as a destination. */
  activePageId?: string;
  /**
   * Href for the "Powered by Mogadishu Rents" credit. Defaults to "/", which is
   * right on the platform; a tenant host must pass `platformUrl("/")` because a
   * relative "/" there stays on the hotel's own site.
   */
  platformHref?: string;
  /** "router" = react-router <Link>. "anchor" = plain <a>, safe outside a Router. */
  linkMode?: "router" | "anchor";
  /**
   * The page already renders a `contact` block, which carries the same phone /
   * WhatsApp / email / socials AND its own copyright bar. Repeating all of it
   * immediately underneath is noise, so in that case the footer contributes
   * only the thing the contact block lacks: links to the rest of the site.
   */
  hasContactSection?: boolean;
  className?: string;
};

// ── Bits ─────────────────────────────────────────────────────────────────────

const SOCIAL_LINKS: ReadonlyArray<{
  key: keyof HotelSocials;
  label: string;
  Icon: typeof Facebook;
}> = [
  { key: "facebook", label: "Facebook", Icon: Facebook },
  { key: "instagram", label: "Instagram", Icon: Instagram },
  // Same icon substitutions the contact block makes — lucide ships neither a
  // TikTok nor an X glyph, and the two surfaces must not drift.
  { key: "tiktok", label: "TikTok", Icon: Sparkles },
  { key: "twitter", label: "Twitter / X", Icon: Building2 },
];

/**
 * Owners type whatever they like into the social fields, including bare
 * "@handle". Only a real URL can be an href — anything else would render a link
 * that resolves to a 404 on the hotel's own site.
 */
function socialHref(value: string | undefined | null): string | null {
  const url = value?.trim();
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function FooterLink({
  linkMode, to, className, children, ariaCurrent,
}: {
  linkMode: "router" | "anchor";
  to: string;
  className?: string;
  children: ReactNode;
  ariaCurrent?: "page";
}) {
  if (linkMode === "router") {
    return (
      <Link to={to} className={className} aria-current={ariaCurrent}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

const CONTACT_LINK_CLASS =
  "flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors";

// ── Footer ───────────────────────────────────────────────────────────────────

const HotelFooter = ({
  brand,
  pages = [],
  pagePath,
  activePageId,
  platformHref = "/",
  linkMode = "anchor",
  hasContactSection = false,
  className,
}: HotelFooterProps) => {
  const accent: CSSProperties = { color: brand.accentColor };

  // A single page is not a site, and a menu with one entry is noise.
  const showPages = pages.length > 1;

  const whatsappDigits = brand.contactWhatsapp?.replace(/\D/g, "") || null;
  const socials = SOCIAL_LINKS.map((social) => ({
    ...social,
    href: socialHref(brand.socials?.[social.key]),
  })).filter((social) => social.href !== null);

  const hasContactDetails = Boolean(
    brand.contactPhone || whatsappDigits || brand.contactEmail || brand.mapsUrl,
  );

  const pageNav = showPages ? (
    <nav aria-label={`${brand.name} pages`} className="min-w-0">
      <h2 className="font-heading font-semibold text-sm text-foreground mb-3">Pages</h2>
      <ul className="space-y-2">
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <li key={page.id}>
              <FooterLink
                linkMode={linkMode}
                to={pagePath(page)}
                ariaCurrent={active ? "page" : undefined}
                className={cn(
                  "text-sm transition-colors hover:text-foreground",
                  active ? "text-foreground font-medium" : "text-muted-foreground",
                )}
              >
                {page.title}
              </FooterLink>
            </li>
          );
        })}
      </ul>
    </nav>
  ) : null;

  // The contact block above already ends the page with the hotel's details and
  // a "Powered by Mogadishu Rents" line. All that is missing there is the way
  // through to the hotel's other pages — so that is all this renders, and if
  // there are no other pages it renders nothing at all.
  if (hasContactSection) {
    if (!pageNav) return null;
    return (
      <footer className={cn("border-t border-border bg-muted/30", className)}>
        <div className="container max-w-5xl py-6">{pageNav}</div>
      </footer>
    );
  }

  return (
    // bg-muted/30, not bg-card: the contact block owns bg-card, and a footer in
    // the same tone directly under it would read as one undifferentiated slab.
    <footer className={cn("border-t border-border bg-muted/30", className)}>
      <div className="container max-w-5xl py-10 space-y-8">
        <div className="flex flex-wrap justify-between gap-8">
          {/* ── Who this is ───────────────────────────────────────────────── */}
          <div className="min-w-0 max-w-sm space-y-3">
            {brand.logoUrl && (
              <img
                src={brand.logoUrl}
                alt=""
                className="h-10 w-auto max-w-[180px] object-contain"
              />
            )}
            {/* The name is text even when a logo is present: it is the accessible
                label for the footer and the one thing a visitor should always be
                able to read and copy. The logo above is therefore alt="". */}
            <p className="font-heading font-bold text-base" style={accent}>
              {brand.name}
            </p>
            {brand.tagline && (
              <p className="text-sm text-muted-foreground">{brand.tagline}</p>
            )}
            {brand.address && (
              <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{brand.address}</span>
              </p>
            )}
          </div>

          {/* ── How to reach them ─────────────────────────────────────────── */}
          {hasContactDetails && (
            <div className="min-w-0">
              <h2 className="font-heading font-semibold text-sm text-foreground mb-3">
                Contact
              </h2>
              <div className="space-y-2">
                {brand.contactPhone && (
                  <a href={`tel:${brand.contactPhone}`} className={CONTACT_LINK_CLASS}>
                    <Phone className="w-4 h-4 shrink-0" />
                    <span>{brand.contactPhone}</span>
                  </a>
                )}
                {whatsappDigits && (
                  <a
                    href={`https://wa.me/${whatsappDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={CONTACT_LINK_CLASS}
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span>WhatsApp</span>
                  </a>
                )}
                {brand.contactEmail && (
                  <a href={`mailto:${brand.contactEmail}`} className={CONTACT_LINK_CLASS}>
                    <Mail className="w-4 h-4 shrink-0" />
                    <span>{brand.contactEmail}</span>
                  </a>
                )}
                {brand.mapsUrl && (
                  <a
                    href={brand.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={accent}
                  >
                    <MapPin className="w-3.5 h-3.5" /> Open in maps
                  </a>
                )}
              </div>
            </div>
          )}

          {pageNav}
        </div>

        {socials.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {socials.map(({ key, label, Icon, href }) => (
              <a
                key={key}
                href={href as string}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="w-10 h-10 rounded-2xl border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        )}

        <div className="pt-5 border-t border-border/70 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            © {new Date().getFullYear()} {brand.name}
          </p>
          {/* Always an <a>: the platform is a different origin from a tenant host,
              so this can never be a client-side route. */}
          <a href={platformHref} className="hover:text-foreground transition-colors">
            Powered by Mogadishu Rents
          </a>
        </div>
      </div>
    </footer>
  );
};

export default HotelFooter;
