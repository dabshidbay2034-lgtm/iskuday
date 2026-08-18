import { Link, useParams } from "react-router-dom";
import { Hotel as HotelIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle, META_DESCRIPTION_MAX, truncate } from "@/lib/seo";
import { breadcrumbLd, faqPageLd, hotelLd } from "@/lib/structured-data";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { brandFromHotel, PageSectionView } from "@/components/hotel/PageSectionView";
import HotelFooter from "@/components/hotel/HotelFooter";
import { platformHotelPagePath } from "@/lib/hotel-links";
import {
  HotelBookButton, HotelMobileActionBar, hasHotelContact,
} from "@/components/hotel/HotelActionBar";
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

  // The PAGE LIST only earns its space once there is somewhere to go. One page
  // is not a site, and a menu with a single item is noise. The bar itself still
  // renders — the hotel's mark and its "Book now" are worth a sticky strip on
  // their own, whether the hotel has one page or six.
  const showMenu = menuPages.length > 1;

  // Where "Book now" lands when the hotel has published no number at all: the
  // contact block, else the rooms block, else nothing — HotelBookButton renders
  // nothing rather than a button that goes to an anchor that isn't on the page.
  const hasRoomsBlock = pageSections.some((s) => s.type === "rooms") && rooms.length > 0;
  const bookFallbackHref = hasContact ? "#contact" : hasRoomsBlock ? "#rooms" : null;
  const onHome = !safePageSlug || isHomeSlug(currentPage?.slug);
  // One path builder for the top menu AND the footer, so the two can't disagree
  // about where a page lives. The subdomain passes the tenant builder instead.
  const pagePath = platformHotelPagePath(hotel.slug);

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
        // `.filter(Boolean)` at the end: faqPageLd returns null for a page with
        // no FAQ block (or one whose questions are still blank), and a null in
        // this array would serialise as `null` inside the <script> and
        // invalidate every other node in it.
        jsonLd={[
          faqPageLd(
            pageSections.flatMap((s) => (s.type === "faq" ? s.faqs ?? [] : [])),
          ),
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
        ].filter(Boolean)}
      />
      <Header />

      {/* ── The hotel's own menu ─────────────────────────────────────────
          Their pages, on our domain. The subdomain has carried a nav since
          20260810000002 (TenantShell) while the apex — the surface we actually
          want indexed — showed only one page, so a hotel that built three had
          two of them reachable nowhere Google looks. Plain <Link>s: these are
          real URLs with real content, which is the entire point. */}
      <nav
        aria-label={`${hotel.name} pages`}
        // `top-16 md:top-20` is the platform <Header/>'s own height: it is
        // sticky at z-50, so a bar stuck at top-0 would slide underneath it and
        // vanish the moment the visitor scrolled.
        className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-16 md:top-20 z-30"
      >
        <div className="container max-w-5xl flex items-center gap-3 py-2">
          {/* The hotel's mark, always home. On their own site the logo IS the
              home link, and visitors arriving on a sub-page from search have
              no other way back to the main page. */}
          <Link
            to={`/hotels/${hotel.slug}`}
            aria-label={`${hotel.name} home`}
            className="flex items-center shrink-0 min-w-0 rounded-lg transition-opacity hover:opacity-80"
          >
            {hotel.logoUrl ? (
              <img
                src={hotel.logoUrl}
                alt={hotel.name}
                className="h-8 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <span
                // Accent is owner data from the database, so it goes inline;
                // a hotel that never picked one falls back to the token.
                style={brand.accentColor ? { color: brand.accentColor } : undefined}
                className="font-heading font-bold text-sm md:text-base truncate max-w-[9rem] md:max-w-[14rem] text-foreground"
              >
                {hotel.name}
              </span>
            )}
          </Link>

          {showMenu && (
            <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-hide">
              {menuPages.map((page) => {
                const href = pagePath(page);
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
          )}

          {/* Pinned right, on every page of the hotel's site: the booking is the
              only thing this page is for. `ml-auto` so it stays pinned when
              there is no page list to push it over. */}
          <HotelBookButton
            hotel={brand}
            fallbackHref={bookFallbackHref}
            className="ml-auto"
          />
        </div>
      </nav>

      {/* ── Blocks, in the owner's order ─────────────────────────────────── */}
      {pageSections.map((section) => (
        <PageSectionView
          key={section.id}
          section={section}
          brand={brand}
          rooms={rooms}
        />
      ))}

      {/* ── The site's footer ────────────────────────────────────────────
          Every page ends the same way, which is most of what makes a hotel's
          three pages read as one website rather than three documents. On a page
          that already has a `contact` block the footer knows to shrink to just
          the page links instead of repeating the details directly above it. */}
      <HotelFooter
        brand={brand}
        pages={menuPages}
        pagePath={pagePath}
        activePageId={currentPage?.id}
        linkMode="router"
        hasContactSection={hasContact}
      />


      {/* ── Bottom chrome: ONE bar, never two ────────────────────────────────
          BottomNav is `md:hidden fixed bottom-0 z-50`, and so is the hotel's
          action bar — the same strip of a phone screen. On a hotel page the
          HOTEL wins: this page exists to turn a visitor into a booking, and in
          Mogadishu that booking happens on WhatsApp, so "WhatsApp / Call" is
          worth more than "Home / Explore / Saved / Account" — which is still
          one tap away in the sticky <Header/> above. When the hotel has no
          reachable number there is no bar to show, so BottomNav keeps the slot
          rather than the page losing its bottom chrome for nothing. Either way
          the wrapper's `pb-20 md:pb-0` clears exactly one bar. */}
      {hasHotelContact(brand) ? <HotelMobileActionBar hotel={brand} /> : <BottomNav />}
    </div>
  );
};

export default HotelPage;