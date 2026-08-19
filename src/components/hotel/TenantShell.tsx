import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Hotel as HotelIcon, Mail, MapPin, MessageCircle, Phone } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  HotelBookButton, HotelMobileActionBar, hasHotelContact,
} from "@/components/hotel/HotelActionBar";
import { PLATFORM_ROOT_DOMAIN, platformUrl } from "@/lib/tenant";
import { POLICY_PAGE_SLUG } from "@/hooks/use-hotel-pages";

/**
 * The chrome a hotel gets on ITS OWN subdomain (`jazeera.mogadishurents.com`).
 *
 * On the platform domain a hotel page is a page inside our site, so it wears our
 * <Header/> and <BottomNav/>. On the hotel's own subdomain that would be wrong:
 * the visitor believes they are on the hotel's website, and MogadishuRents
 * branding at the top contradicts that. So this shell swaps the platform chrome
 * for the hotel's own — its logo, its accent, a nav built from its published
 * pages, and a footer with its contact details.
 *
 * It renders chrome only. What sits between the header and the footer is
 * `children`, which the routing layer supplies.
 *
 * NOTE: the hostname decides which hotel we DISPLAY, never what the visitor may
 * READ. Anonymous visitors get exactly what the published-only SELECT policy on
 * `hotels` allows — see docs/SUBDOMAINS.md.
 */

// ── Data ─────────────────────────────────────────────────────────────────────

/**
 * Only the fields the CHROME needs. Deliberately not the full `Hotel` from
 * use-hotels: the page body is rendered by `children`, so pulling the whole
 * `sections` JSON just to draw a header would be wasted bytes on every load.
 */
export type TenantHotel = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  accentColor: string;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  address: string | null;
  isPublished: boolean;
};

/** One entry in the tenant's own nav, from its published `hotel_pages` rows. */
export type TenantNavPage = {
  id: string;
  slug: string;
  title: string;
  sortOrder: number;
};

// `hotels.subdomain` and `hotel_pages` post-date the generated Supabase types,
// so reads go through the same loose accessor the rest of the hotel data layer
// uses (see use-hotels.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (supabase as unknown as LooseClient).from(table);

type RawTenantHotel = {
  id: string;
  name: string | null;
  slug: string;
  logo_url: string | null;
  accent_color: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  address: string | null;
  is_published: boolean | null;
};

type RawHotelPage = {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
  sort_order?: number | null;
  is_published?: boolean | null;
};

export const tenantHotelKey = (subdomain?: string) =>
  ["tenant", "hotel", subdomain] as const;
export const tenantPagesKey = (hotelId?: string) =>
  ["tenant", "pages", hotelId] as const;

/** The path a tenant nav entry points at — the tenant's site is rooted at "/". */
export function tenantPagePath(slug: string): string {
  return `/${slug}`;
}

/** Look a hotel up by the subdomain it is being served from. */
export function useHotelBySubdomain(subdomain?: string) {
  return useQuery({
    queryKey: tenantHotelKey(subdomain),
    enabled: Boolean(subdomain),
    queryFn: async (): Promise<TenantHotel | null> => {
      const { data, error } = await looseFrom("hotels")
        .select(
          "id, name, slug, logo_url, accent_color, contact_phone, contact_whatsapp, contact_email, address, is_published"
        )
        .eq("subdomain", subdomain)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as RawTenantHotel;
      return {
        id: row.id,
        name: row.name ?? "This hotel",
        slug: row.slug,
        logoUrl: row.logo_url ?? null,
        accentColor: row.accent_color ?? "#0f766e",
        contactPhone: row.contact_phone ?? null,
        contactWhatsapp: row.contact_whatsapp ?? null,
        contactEmail: row.contact_email ?? null,
        address: row.address ?? null,
        isPublished: row.is_published ?? false,
      };
    },
  });
}

/**
 * The hotel's published pages, for its nav.
 *
 * Filtered and sorted CLIENT-side on purpose: `hotel_id` is the only column this
 * query can be certain of, and a nav is decoration. If `hotel_pages` drifts (a
 * renamed `sort_order`, a migration not yet applied to an environment) the site
 * should lose its menu, not fall over — hence `retry: false` and an empty list
 * on failure rather than a thrown error.
 */
export function useTenantNavPages(hotelId?: string) {
  return useQuery({
    queryKey: tenantPagesKey(hotelId),
    enabled: Boolean(hotelId),
    retry: false,
    queryFn: async (): Promise<TenantNavPage[]> => {
      const { data, error } = await looseFrom("hotel_pages")
        .select("*")
        .eq("hotel_id", hotelId);
      if (error) return [];
      return ((data ?? []) as RawHotelPage[])
        .filter((row) => row.is_published !== false && Boolean(row.slug))
        .map((row, i) => ({
          id: row.id,
          slug: String(row.slug),
          title: row.title || row.name || String(row.slug),
          sortOrder: Number(row.sort_order ?? i),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    },
  });
}

// ── Chrome ───────────────────────────────────────────────────────────────────

/**
 * Every link here is a plain <a>, not a react-router <Link>.
 *
 * The shell has to work whether the routing integration mounts it inside the
 * Router or above it, and an <a> behaves identically in both. Tenant sites are a
 * handful of mostly-static pages, so the cost of a full navigation is invisible
 * next to the cost of the shell exploding outside a Router context.
 */
function TenantHeader({ hotel, pages }: { hotel: TenantHotel; pages: TenantNavPage[] }) {
  // Accent is owner-supplied data, not a design token, so it goes inline.
  const accent: CSSProperties = { color: hotel.accentColor };

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-xl border-b border-border/70">
      <div className="container flex items-center justify-between gap-4 h-16 md:h-20">
        <a href="/" className="flex items-center gap-2.5 min-w-0 shrink-0">
          {hotel.logoUrl ? (
            <img
              src={hotel.logoUrl}
              alt={hotel.name}
              className="h-9 md:h-11 w-auto max-w-[180px] object-contain"
            />
          ) : (
            <span
              className="font-heading font-bold text-lg md:text-xl truncate"
              style={accent}
            >
              {hotel.name}
            </span>
          )}
        </a>

        <nav className="hidden md:flex items-center gap-1">
          {pages.map((page) => (
            <a
              key={page.id}
              href={tenantPagePath(page.slug)}
              className="px-3.5 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors"
            >
              {page.title}
            </a>
          ))}
        </nav>

        {/* Was a phone-only "Call" pill, which ignored the channel most of this
            audience actually books on. Same component as the platform page's
            nav button, so both surfaces prefer WhatsApp and both render
            nothing when the hotel has published no number. */}
        <HotelBookButton hotel={hotel} />
      </div>

      {/* Mobile nav: a scroll strip beats a hamburger here — no state, no focus
          trap, and the tenant's pages stay visible at a glance. */}
      {pages.length > 0 && (
        <nav className="md:hidden border-t border-border/60 overflow-x-auto">
          <div className="flex items-center gap-1 px-3 py-2 w-max">
            {pages.map((page) => (
              <a
                key={page.id}
                href={tenantPagePath(page.slug)}
                className="px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors whitespace-nowrap"
              >
                {page.title}
              </a>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}

function TenantFooter({ hotel, pages }: { hotel: TenantHotel; pages: TenantNavPage[] }) {
  const whatsapp = hotel.contactWhatsapp?.replace(/[^\d]/g, "");

  return (
    <footer className="mt-16 border-t border-border bg-muted/30">
      <div className="container max-w-5xl py-8 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-2 min-w-0">
            <p className="font-heading font-bold text-base" style={{ color: hotel.accentColor }}>
              {hotel.name}
            </p>
            {hotel.address && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{hotel.address}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            {hotel.contactPhone && (
              <a
                href={`tel:${hotel.contactPhone}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Phone className="w-4 h-4" /> {hotel.contactPhone}
              </a>
            )}
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageCircle className="w-4 h-4" /> WhatsApp
              </a>
            )}
            {hotel.contactEmail && (
              <a
                href={`mailto:${hotel.contactEmail}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Mail className="w-4 h-4" /> {hotel.contactEmail}
              </a>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-border/70 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} {hotel.name}. All rights reserved.</p>
          <div className="flex items-center gap-4">
            {/* The policy page is a normal tenant page; link it when it exists
                (published), so a guest can always reach the house rules. */}
            {pages?.some((p) => p.slug === POLICY_PAGE_SLUG) && (
              <a
                href={tenantPagePath(POLICY_PAGE_SLUG)}
                className="hover:text-foreground transition-colors"
              >
                Policy
              </a>
            )}
            {/* Absolute: a relative "/" here stays on the tenant's own site. */}
            <a
              href={platformUrl("/")}
              className="hover:text-foreground transition-colors"
            >
              Powered by MogadishuRents
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Shared frame for the three non-happy states, so they still feel like a site. */
function TenantMessage({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 text-muted-foreground">
          {icon}
        </div>
        <h1 className="font-heading font-bold text-2xl text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground text-sm mb-6">{body}</p>
        {action}
      </div>
    </div>
  );
}

function PlatformLink({ label }: { label: string }) {
  return (
    <a
      href={platformUrl("/properties?type=hotel")}
      className="inline-flex items-center justify-center h-11 px-6 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
    >
      {label}
    </a>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

export type TenantShellProps = {
  /** The resolved subdomain — `resolveTenant()` guarantees it is a valid label. */
  subdomain: string;
  children: ReactNode;
};

const TenantShell = ({ subdomain, children }: TenantShellProps) => {
  const { data: hotel, isPending, isError } = useHotelBySubdomain(subdomain);
  const { data: pages } = useTenantNavPages(hotel?.id);

  // The tab title is part of "this is their website" — index.html ships the
  // platform's title, which is wrong the moment we are on a tenant host.
  useEffect(() => {
    if (!hotel) return;
    const previous = document.title;
    document.title = hotel.name;
    return () => {
      document.title = previous;
    };
  }, [hotel]);

  if (isPending) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/70">
          <div className="container flex items-center justify-between h-16 md:h-20">
            <Skeleton className="h-9 w-40 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
        </header>
        <div className="container max-w-5xl py-10 space-y-6">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <TenantMessage
        icon={<AlertTriangle className="w-7 h-7" />}
        title="We couldn't load this site"
        body="Something went wrong on our end. Please refresh the page in a moment."
        action={<PlatformLink label="Go to MogadishuRents" />}
      />
    );
  }

  // No row for this host. A raw 404 would look broken to someone who typed the
  // name from a business card, so explain it instead.
  if (!hotel) {
    return (
      <TenantMessage
        icon={<HotelIcon className="w-7 h-7" />}
        title="There's no hotel here yet"
        body={`No hotel is using ${subdomain}.${PLATFORM_ROOT_DOMAIN}. Check the address for a typo, or browse hotels on MogadishuRents.`}
        action={<PlatformLink label="Browse hotels" />}
      />
    );
  }

  // Only reachable for someone RLS lets read drafts (the owner, their agency,
  // an admin) — anonymous visitors get `null` above and never land here.
  if (!hotel.isPublished) {
    return (
      <TenantMessage
        icon={<HotelIcon className="w-7 h-7" />}
        title="This hotel page isn't live yet"
        body="Its owner hasn't published it. Once they do, this address will show their website."
        action={<PlatformLink label="Browse hotels" />}
      />
    );
  }

  // There is no <BottomNav/> on a tenant host — this is the hotel's own site,
  // not a page inside ours — so the action bar has the bottom of the screen to
  // itself and nothing to compete with. The padding is conditional because a
  // hotel with no reachable number renders no bar and should not get a strip of
  // dead space above its footer.
  const showActionBar = hasHotelContact(hotel);

  return (
    <div
      className={cn(
        "min-h-screen bg-background flex flex-col",
        showActionBar && "pb-20 md:pb-0",
      )}
    >
      <TenantHeader hotel={hotel} pages={pages ?? []} />
      <main className="flex-1">{children}</main>
      <TenantFooter hotel={hotel} pages={pages ?? []} />
      <HotelMobileActionBar hotel={hotel} />
    </div>
  );
};

export default TenantShell;
