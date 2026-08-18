import { Link, useParams } from "react-router-dom";
import { Hotel as HotelIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle, META_DESCRIPTION_MAX, truncate } from "@/lib/seo";
import { breadcrumbLd, hotelLd } from "@/lib/structured-data";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { brandFromHotel, PageSectionView } from "@/components/hotel/PageSectionView";
import {
  usePublicHotelPage, useHotelRooms, type HotelRoomProperty,
} from "@/hooks/use-hotels";
// Same exported name in both modules, for two different things: use-hotels
// finds a HOTEL by its public slug, use-hotel-pages finds one PAGE of a hotel.
// Aliased rather than renamed at the source so the tenant routes that already
// import it keep working.
import {
  isHomeSlug,
  sectionsForPage,
  useHotelPages,
  usePublicHotelPage as usePublicHotelSubpage,
} from "@/hooks/use-hotel-pages";

const SAFE_SLUG = /^[a-z0-9-]{1,80}$/;

/** Raw row shape for the one-off room fallback query (when the join is empty). */
type RawFallbackRoom = {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  property_images: Array<{ image_url: string; sort_order: number | null }> | null;
};

function toFallbackRoom(row: RawFallbackRoom): HotelRoomProperty {
  const images = (row.property_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((img) => img.image_url);
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price) || null,
    location: row.location ?? null,
    isDailyRate: null,
    type: "hotel",
    images,
  };
}

/**
 * A hotel's PUBLIC web page — /hotels/:slug (20260808000001).
 *
 * Renders the page's ordered BLOCKS (hero / text / gallery / rooms / button /
 * contact) exactly as the owner arranged them in the builder. The gallery
 * block is a sliding carousel. Draft pages 404 for visitors.
 */
const HotelPage = () => {
  // `/hotels/:slug` is the hotel's MAIN page; `/hotels/:slug/:pageSlug` is any
  // of its other published ones. The main page is resolved by the `is_home`
  // flag, never by guessing a slug spelling — so however many pages a hotel
  // builds, and whichever one it later promotes, /hotels/:slug keeps showing
  // the one it has designated. See the partial unique index in
  // 20260810000002 that guarantees exactly one home per hotel.
  const { slug, pageSlug } = useParams<{ slug: string; pageSlug?: string }>();
  const safeSlug = slug && SAFE_SLUG.test(slug) ? slug : null;
  const safePageSlug = pageSlug && SAFE_SLUG.test(pageSlug) ? pageSlug : undefined;

  const { data: hotel, isPending } = usePublicHotelPage(safeSlug ?? undefined);

  // The page being viewed, and every published page for the menu. Both are
  // RLS-scoped: the public only ever sees published pages of a published hotel.
  const { data: currentPage, isPending: pagePending } = usePublicHotelSubpage(
    hotel?.id,
    safePageSlug,
  );
  const { data: allPages } = useHotelPages(hotel?.id);
  const menuPages = (allPages ?? []).filter((page) => page.isPublished);
  const { data: roomLinks } = useHotelRooms(hotel?.id);

  // Room images ride along with the embedded property row; fall back to a
  // public query for any room the join didn't carry over.
  const { data: roomImages } = useQuery({
    queryKey: ["hotel-page-room-images", hotel?.id],
    enabled: Boolean(hotel?.id && (roomLinks ?? []).some((r) => !r.property)),
    queryFn: async (): Promise<HotelRoomProperty[]> => {
      const ids = (roomLinks ?? []).filter((r) => !r.property).map((r) => r.propertyId);
      const { data, error } = await supabase
        .from("properties")
        .select("id, title, price, location, property_images(image_url, sort_order)")
        .in("id", ids);
      if (error) throw error;
      return ((data ?? []) as RawFallbackRoom[]).map(toFallbackRoom);
    },
  });

  if (isPending) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <Skeleton className="w-full h-[320px] md:h-[420px]" />
        <div className="container max-w-5xl py-8 space-y-6">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <BottomNav />
      </div>
    );
  }

  // Draft or unknown slug — the public never sees un-published pages. A named
  // sub-page that does not resolve is the same soft 404: rendering the home
  // page under someone else's URL would put two URLs on identical content.
  if (!hotel || (safePageSlug && !pagePending && !currentPage)) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        {/* A draft or missing hotel is a soft 404 (vercel.json serves it with
            HTTP 200), so it must be noindexed explicitly or Google will index
            every unpublished slug as a real page. */}
        <Seo
          title={buildTitle("Hotel Page Not Available")}
          description="This hotel page isn't published yet. Browse hotels and nightly rooms available in Mogadishu instead."
          canonical={absoluteUrl(`/hotels/${encodeURIComponent(slug ?? "")}`)}
          noindex
        />
        <Header />
        <div className="container max-w-2xl py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <HotelIcon className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-heading font-bold text-2xl text-foreground mb-2">
            This hotel page isn't live yet
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            The page doesn't exist or its owner hasn't published it. Check back soon.
          </p>
          <Button variant="hero" asChild>
            <Link to="/properties?type=hotel">Browse hotels</Link>
          </Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const rooms: HotelRoomProperty[] = (roomLinks ?? [])
    .map((link) => link.property ?? roomImages?.find((r) => r.id === link.propertyId) ?? null)
    .filter((r): r is HotelRoomProperty => r !== null);

  // `sectionsForPage` back-fills a home page whose own `sections` is still
  // empty from the hotel's legacy scalar fields, so a hotel that never touched
  // the multi-page builder renders exactly as it did before. `hotel.sections`
  // remains the fallback for a hotel with no `hotel_pages` row at all.
  const pageSections = currentPage ? sectionsForPage(currentPage, hotel) : hotel.sections;
  const hasContact = pageSections.some((s) => s.type === "contact");
  const brand = brandFromHotel(hotel);

  // The menu only earns its space once there is somewhere to go. One page is
  // not a site, and a nav with a single item is noise.
  const showMenu = menuPages.length > 1;
  const onHome = !safePageSlug || isHomeSlug(currentPage?.slug);
  const pagePath = (pageSlugValue: string, isHome: boolean) =>
    isHome || isHomeSlug(pageSlugValue)
      ? `/hotels/${hotel.slug}`
      : `/hotels/${hotel.slug}/${pageSlugValue}`;

  // A sub-page is its own document and must say so. Pointing every page of a
  // hotel at /hotels/:slug would collapse the whole site into one URL.
  const canonicalPath = onHome
    ? `/hotels/${hotel.slug}`
    : `/hotels/${hotel.slug}/${currentPage?.slug ?? ""}`;
  // What this page would be called if nobody said otherwise.
  const generatedTitle = onHome
    ? `${hotel.name} — Hotel in Mogadishu`
    : `${currentPage?.title ?? ""} — ${hotel.name}`;

  // …and the hotel's own wording when it wrote some (20260904000002). NULL —
  // which is every page nobody has edited — keeps the generated string, so no
  // title that Google has already indexed moves on its own.
  //
  // The override still goes through buildTitle() below, exactly like the
  // generated one: a hotelier who writes "Rooms & Rates at Jazeera Palace"
  // should get the brand suffix appended, and one who already ended their line
  // with the brand should not get it twice. That judgement lives in buildTitle,
  // and duplicating it here is how the two paths would drift apart.
  const pageTitle = currentPage?.seoTitle?.trim() || generatedTitle;

  // Owner-written snippet first, then the page copy, tagline, generated line.
  // All of them are user-controlled free text, so everything goes through
  // truncate() — which also collapses the newlines a textarea puts in, since a
  // raw \n inside a meta content="" attribute is what makes unfurlers drop the
  // description. seo_description is a textarea with no length limit in the
  // database (deliberately — see the migration), so it needs that cut most of
  // all: a 400-character snippet is the one failure this field can produce.
  const hotelDescription = truncate(
    currentPage?.seoDescription?.trim() ||
      hotel.description ||
      hotel.tagline ||
      `${hotel.name} — hotel rooms in Mogadishu, Somalia. See photos, nightly rates and contact details, and book direct.`,
    META_DESCRIPTION_MAX,
  );

  return (
    // `pb-20 md:pb-0` matches the loading and not-published branches: BottomNav
    // is fixed at z-50 on mobile, and without the clearance it sits on top of
    // the footer — the copyright and the "Powered by Mogadishu Rents" link both
    // become untappable on a phone, which is most of this audience.
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* Reached only after `hotel` resolved and is published, so the canonical
          is guaranteed to describe a real, live page. `hotel.slug` (not the raw
          `slug` param) is the canonical spelling straight from the database. */}
      <Seo
        title={buildTitle(pageTitle)}
        description={hotelDescription}
        canonical={absoluteUrl(canonicalPath)}
        image={hotel.heroImageUrl || hotel.logoUrl || hotel.gallery[0]}
        // Lodging has the best-supported rich results of anything on this site,
        // and the rooms carry per-NIGHT offers — publishing a nightly rate as
        // monthly would be a 30x misstatement of price.
        jsonLd={[
          hotelLd(
            {
              slug: hotel.slug,
              name: hotel.name,
              tagline: hotel.tagline,
              description: hotel.description,
              heroImageUrl: hotel.heroImageUrl,
              logoUrl: hotel.logoUrl,
              gallery: hotel.gallery,
              contactPhone: hotel.contactPhone,
              contactWhatsapp: hotel.contactWhatsapp,
              contactEmail: hotel.contactEmail,
              address: hotel.address,
              mapsUrl: hotel.mapsUrl,
              // HotelSocials is a fixed-key interface with no index signature,
              // so it needs widening to the builder's Record. The builder only
              // reads values matching ^https?://, so a bare @handle is dropped
              // rather than turned into a fake URL.
              socials: hotel.socials as Record<string, string | null | undefined>,
            },
            rooms.map((room) => ({
              id: room.id,
              name: room.title,
              price: room.price,
              location: room.location,
              images: room.images,
            })),
          ),
          breadcrumbLd([
            { name: "Home", url: absoluteUrl("/") },
            { name: "Hotels", url: absoluteUrl("/properties?type=hotel") },
            { name: hotel.name, url: absoluteUrl(`/hotels/${hotel.slug}`) },
          ]),
        ]}
      />
      <Header />

      {/* ── The hotel's own menu ─────────────────────────────────────────
          Their pages, on our domain. The subdomain has carried a nav since
          20260810000002 (TenantShell) while the apex — the surface we actually
          want indexed — showed only one page, so a hotel that built three had
          two of them reachable nowhere Google looks. Plain <Link>s: these are
          real URLs with real content, which is the entire point. */}
      {showMenu && (
        <nav
          aria-label={`${hotel.name} pages`}
          className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-30"
        >
          <div className="container max-w-5xl flex items-center gap-1 overflow-x-auto py-2">
            {menuPages.map((page) => {
              const href = pagePath(page.slug, page.isHome);
              const active = page.isHome ? onHome : currentPage?.slug === page.slug;
              return (
                <Link
                  key={page.id}
                  to={href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-foreground text-background font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {page.title}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* ── Blocks, in the owner's order ─────────────────────────────────── */}
      {pageSections.map((section) => (
        <PageSectionView
          key={section.id}
          section={section}
          brand={brand}
          rooms={rooms}
        />
      ))}

      {!hasContact && (
        <div className="border-t border-border">
          <div className="container max-w-5xl py-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {hotel.name} · Powered by Mogadishu Rents</p>
            <a href="/" className="hover:text-foreground transition-colors">Mogadishu Rents</a>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
};

export default HotelPage;