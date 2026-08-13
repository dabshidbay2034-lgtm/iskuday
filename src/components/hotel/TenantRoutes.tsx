import { Routes, Route, useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import TenantShell, { useHotelBySubdomain } from "@/components/hotel/TenantShell";
import { PageSectionView, type PageBrand } from "@/components/hotel/PageSectionView";
import { usePublicHotelPage } from "@/hooks/use-hotel-pages";
import { useHotelRooms } from "@/hooks/use-hotels";
import { sectionsFromJson } from "@/components/hotel/page-sections";
import { platformUrl } from "@/lib/tenant";

/**
 * Everything the app serves on a hotel's OWN subdomain.
 *
 * The hostname picks the hotel, so there is no `:slug` for the hotel itself —
 * only for which of its pages you are on. `/` is the home page, `/:pageSlug` is
 * any other published one.
 *
 * ── WHY THERE IS NO SIGN-IN HERE ───────────────────────────────────────────
 * A Clerk session cookie is scoped to the domain that issued it, so a user
 * signed in on mogadishurents.com is NOT signed in on jazeera.mogadishurents.com.
 * Making auth work across both needs Clerk satellite domains, which is a
 * configuration change nobody can verify from inside this codebase. So tenant
 * hosts are deliberately PUBLIC-ONLY: they render published pages to anonymous
 * visitors, and anything that needs an account sends you to the apex, where the
 * session already exists. That is also the safer default — a misconfigured
 * satellite domain fails by silently signing people out, which is far worse
 * than a link that changes host.
 *
 * The hostname decides what we DISPLAY, never what a visitor may READ: the
 * published-only SELECT policy on `hotels`/`hotel_pages` is still the boundary.
 */
export default function TenantRoutes({ subdomain }: { subdomain: string }) {
  return (
    <TenantShell subdomain={subdomain}>
      <Routes>
        <Route path="/" element={<TenantPage subdomain={subdomain} />} />
        <Route path="/:pageSlug" element={<TenantPage subdomain={subdomain} />} />
        {/* No catch-all 404 of our own: a deep path on a tenant host is more
            likely a stale platform link than a real page, so send it home
            rather than dead-ending on someone else's brand. */}
        <Route path="*" element={<TenantPage subdomain={subdomain} />} />
      </Routes>
    </TenantShell>
  );
}

function TenantPage({ subdomain }: { subdomain: string }) {
  const { pageSlug } = useParams<{ pageSlug?: string }>();
  const { data: hotel } = useHotelBySubdomain(subdomain);
  // "home" is the slug the migration stamps on the page it back-fills for every
  // existing hotel, so a bare "/" resolves without a special case.
  const { data: page, isPending } = usePublicHotelPage(hotel?.id, pageSlug ?? "home");
  const { data: roomLinks } = useHotelRooms(hotel?.id);

  if (isPending || !hotel) {
    return (
      <div className="container max-w-5xl py-10 space-y-4">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="container max-w-2xl py-24 text-center">
        <h1 className="font-heading font-bold text-2xl text-foreground mb-2">
          Page not found
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          This page isn't published yet.
        </p>
        <a
          href={platformUrl("/properties?type=hotel")}
          className="text-primary underline underline-offset-2 text-sm"
        >
          Browse hotels on Mogadishu Rents
        </a>
      </div>
    );
  }

  // `TenantHotel` is a narrower read than the builder's `Hotel`, so brand is
  // assembled here rather than through brandFromHotel(); the fields the renderer
  // actually uses are all present.
  const brand: PageBrand = {
    name: hotel.name,
    tagline: null,
    accentColor: hotel.accentColor,
    logoUrl: hotel.logoUrl,
    contactPhone: hotel.contactPhone,
    contactWhatsapp: hotel.contactWhatsapp,
    contactEmail: hotel.contactEmail,
    address: hotel.address,
    mapsUrl: null,
    socials: {},
  };

  const rooms = (roomLinks ?? [])
    .map((link) => link.property)
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <>
      {sectionsFromJson(page.sections).map((section) => (
        <PageSectionView key={section.id} section={section} brand={brand} rooms={rooms} />
      ))}
    </>
  );
}
