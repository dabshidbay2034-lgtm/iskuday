import { ALL_FACETS, FACET_MIN_LISTINGS, facetMatches } from "@/lib/facets";
import { listingSeoDescription, listingSeoTitle, type ListingSeoInput } from "@/lib/listing-seo";
import { listingPath } from "@/lib/listing-url";
import { isNightlyRateType } from "@/lib/property-kind";
import { DEFAULT_OG_IMAGE, absoluteUrl, buildTitle, serializeJsonLd, truncate } from "@/lib/seo";
import {
  breadcrumbLd,
  itemListLd,
  organizationLd,
  propertyListingLd,
  websiteSearchLd,
} from "@/lib/structured-data";

/**
 * The head of every public page, computed at BUILD time.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The app is a client-rendered SPA and `vercel.json` rewrites every path to
 * `/index.html`. So every route ships the HOMEPAGE's head — its title, its
 * description, and a canonical pointing at `/`. Googlebot renders JavaScript on
 * a later pass and eventually sees the real tags that `src/components/Seo.tsx`
 * writes, but nothing else does: Bingbot, the WhatsApp and Facebook link
 * unfurlers that are how listings actually get shared here, and most LLM
 * fetchers all read the HTML as served and stop. To all of them, all 150-odd
 * pages of this site are the same page.
 *
 * `scripts/prerender.mjs` writes one real HTML file per route with the head
 * below baked in. The body is unchanged — it is still the same shell that
 * hydrates into the same app — so this carries no runtime risk. What changes is
 * that a crawler which never runs a line of JavaScript now gets the right title,
 * the right canonical and the right structured data.
 *
 * ── WHY IT LIVES IN src/ AND NOT IN THE SCRIPT ──────────────────────────────
 * Every string here already has a single source of truth in `lib/` — the facet
 * catalogue, the listing title builder, the structured-data helpers. Rewriting
 * any of it in a plain .mjs script would create a second copy that drifts, and
 * the whole point of `listing-seo.ts` was to stop titles being invented in more
 * than one place. So this stays TypeScript beside the code it uses, and the
 * build compiles it with `vite build --ssr` for the script to import.
 *
 * NOTHING HERE MAY TOUCH THE DOM. It runs in Node.
 */

export type HeadTags = {
  title: string;
  description: string;
  canonical: string;
  image: string;
  /** Serialised JSON-LD, ready to drop into a <script> element. */
  jsonLd: string | null;
  /** Pages that render but must not be indexed. */
  noindex: boolean;
};

/** The shape the prerender script hands us for one listing. */
export type PrerenderProperty = {
  id: string;
  title: string;
  description?: string | null;
  type?: string | null;
  location?: string | null;
  price: number;
  bedrooms?: number | null;
  toilets?: number | null;
  kitchens?: number | null;
  living_rooms?: number | null;
  purpose?: string | null;
  is_available?: boolean | null;
  is_daily_rate?: boolean | null;
  images?: string[];
};

export type PrerenderHotel = {
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  hero_image_url?: string | null;
  logo_url?: string | null;
};

function head(partial: Partial<HeadTags> & Pick<HeadTags, "title" | "description" | "canonical">): HeadTags {
  return {
    image: DEFAULT_OG_IMAGE,
    jsonLd: null,
    noindex: false,
    ...partial,
  };
}

/** `/` */
export function homeHead(): HeadTags {
  return head({
    title: buildTitle(""),
    description:
      "Browse verified villas, apartments, hotel rooms and commercial space for rent across all 18 districts of Mogadishu. Real photos, owner prices, direct contact.",
    canonical: absoluteUrl("/"),
    // The sitewide nodes. Only the homepage carries them — repeating an
    // Organization on 150 pages does not make it 150 times more true.
    jsonLd: serializeJsonLd([organizationLd(), websiteSearchLd()]),
  });
}

/** `/properties` */
export function propertiesHead(): HeadTags {
  return head({
    title: buildTitle("Properties for Rent in Mogadishu"),
    description:
      "Every villa, apartment, hotel room and commercial space listed with us in Mogadishu. Compare prices and photos, then deal with the owner directly.",
    canonical: absoluteUrl("/properties"),
  });
}

/**
 * `/properties/:facetSlug`
 *
 * `noindex` below the inventory threshold, matching what Properties.tsx does at
 * runtime. The sitemap already withholds these, but a crawler that finds one
 * through an internal link must still be told not to index it — see the
 * doorway-page note in src/lib/facets.ts.
 */
export function facetHead(slug: string, properties: PrerenderProperty[]): HeadTags | null {
  const facet = ALL_FACETS.find((f) => f.slug === slug);
  if (!facet) return null;

  const members = properties.filter((p) =>
    facetMatches(facet, { type: p.type, location: p.location, bedrooms: p.bedrooms }),
  );

  return head({
    title: buildTitle(facet.title),
    description: facet.description,
    canonical: absoluteUrl(`/properties/${facet.slug}`),
    noindex: members.length < FACET_MIN_LISTINGS,
    jsonLd: serializeJsonLd([
      breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Properties", url: "/properties" },
        { name: facet.heading, url: `/properties/${facet.slug}` },
      ]),
      itemListLd(
        members.map((p) => ({ url: absoluteUrl(listingUrlPath(p)), name: p.title })),
        facet.heading,
      ),
    ]),
  });
}

/** Every category page the app can resolve, indexable or not. */
export function allFacetSlugs(): string[] {
  return ALL_FACETS.map((f) => f.slug);
}

/** `/property/:id` */
/** The SEO input for one listing. Shared by the head and the URL. */
export function listingSeoInput(property: PrerenderProperty): ListingSeoInput {
  const isNightly = isNightlyRateType(property.type ?? undefined);
  return {
    title: property.title,
    description: property.description,
    type: property.type,
    location: property.location,
    price: Number(property.price ?? 0),
    bedrooms: property.bedrooms,
    toilets: property.toilets,
    kitchens: property.kitchens,
    livingRooms: property.living_rooms,
    isNightly,
    isForSale: property.purpose === "sell",
  };
}

/** The canonical path for one listing. */
export function listingUrlPath(property: PrerenderProperty): string {
  return listingPath(property.id, listingSeoInput(property));
}

export function listingHead(property: PrerenderProperty): HeadTags {
  const input = listingSeoInput(property);

  return head({
    title: buildTitle(listingSeoTitle(input)),
    description: listingSeoDescription(input),
    canonical: absoluteUrl(listingUrlPath(property)),
    image: property.images?.[0] ? absoluteUrl(property.images[0]) : DEFAULT_OG_IMAGE,
    jsonLd: serializeJsonLd([
      propertyListingLd({
        id: property.id,
        title: property.title,
        description: property.description,
        type: property.type,
        price: Number(property.price ?? 0),
        location: property.location,
        images: property.images ?? [],
        isAvailable: property.is_available ?? true,
        isDailyRate: property.is_daily_rate ?? false,
        bedrooms: property.bedrooms,
      }),
      breadcrumbLd([
        { name: "Home", url: "/" },
        { name: "Properties", url: "/properties" },
        { name: property.title, url: listingUrlPath(property) },
      ]),
    ]),
  });
}

/** `/hotels/:slug` and `/hotels/:slug/:pageSlug` */
export function hotelHead(hotel: PrerenderHotel, pageSlug?: string, pageTitle?: string): HeadTags {
  const onHome = !pageSlug;
  return head({
    title: buildTitle(
      onHome ? `${hotel.name} — Hotel in Mogadishu` : `${pageTitle ?? pageSlug} — ${hotel.name}`,
    ),
    description: truncate(
      hotel.description ||
        hotel.tagline ||
        `${hotel.name} — hotel rooms in Mogadishu, Somalia. See photos, nightly rates and contact details, and book direct.`,
      158,
    ),
    canonical: absoluteUrl(onHome ? `/hotels/${hotel.slug}` : `/hotels/${hotel.slug}/${pageSlug}`),
    image: hotel.hero_image_url
      ? absoluteUrl(hotel.hero_image_url)
      : hotel.logo_url
        ? absoluteUrl(hotel.logo_url)
        : DEFAULT_OG_IMAGE,
  });
}

/** A route with no data behind it. */
export function staticHead(path: string, title: string, description: string): HeadTags {
  return head({
    title: buildTitle(title),
    description,
    canonical: absoluteUrl(path),
  });
}
