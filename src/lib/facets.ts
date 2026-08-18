import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import type { PropertyType } from "@/lib/types";

/**
 * Path-based category pages — `/properties/3-bedroom-apartments-in-mogadishu`.
 *
 * ── WHY THESE EXIST ─────────────────────────────────────────────────────────
 * "3 bedroom apartment in Mogadishu" is a BROWSE query: the searcher wants a
 * set, not one flat. Google ranks collection pages for it, so an individual
 * listing — however well marked up — is structurally the wrong answer and will
 * not win. What wins is a page that IS the set.
 *
 * `/properties?type=apartment&district=Hodan` already renders that set and
 * already emits a correct canonical (see `seoForFilters` in Properties.tsx).
 * The problem is the query string: Google treats `?`-parameterised URLs as
 * variants of one page and indexes them reluctantly and inconsistently. A path
 * segment is unambiguously its own document. Same content, same component —
 * only the URL shape changes, and that shape is the whole point.
 *
 * ── WHY A BOUNDED CATALOGUE AND NOT A PARSER ────────────────────────────────
 * Every facet below is enumerated up front (~120 rows: types x bedrooms, plus
 * types x districts). Resolution is then a map lookup, not a regex that has to
 * decide whether "3-bedroom-apartments-in-hamar-jajab" splits after "apartments"
 * or after "in". A typo'd or invented slug simply misses the map and 404s
 * instead of rendering an empty page that Google would index as thin content.
 *
 * ── THE THRESHOLD IS THE LOAD-BEARING PART ──────────────────────────────────
 * A facet page is only INDEXABLE once it holds `FACET_MIN_LISTINGS` live
 * listings. Publishing every combination the moment the site has one villa in
 * Yaqshid is the textbook definition of doorway pages — mass-generated
 * near-empty pages targeting keyword permutations — and Google penalises it
 * site-wide. That is the same class of violation as hidden keyword text, and on
 * a domain with no authority yet a manual action is not survivable.
 *
 * So: below the threshold the page still RENDERS (links from filters and old
 * bookmarks must not break) but ships `noindex` and stays out of the sitemap.
 * Cross the threshold and it publishes itself on the next build. Keyword
 * coverage therefore grows with real inventory and can never run ahead of it.
 */

/**
 * Live listings a facet needs before it may be indexed.
 *
 * Three is a judgement call, not a Google-published number. It is the point at
 * which the page stops reading as "one listing with a category headline" and
 * starts reading as a choice. Raise it as inventory grows — at 500 listings a
 * three-result page looks broken rather than thin.
 */
export const FACET_MIN_LISTINGS = 3;

/**
 * Per-type vocabulary for slugs, headings and prose.
 *
 * `slug` is frozen the moment a URL is indexed — changing one orphans whatever
 * ranking it earned and needs a 301, so treat this column as append-only.
 *
 * `rents` distinguishes monthly stock from nightly: "Hotel Rooms for Rent"
 * reads as a mistake, hotel rooms are booked by the night. Properties.tsx makes
 * the same distinction for the query-param pages; both read from here now.
 */
type TypeVocab = {
  slug: string;
  /** Title-case plural for <h1> and <title>. */
  plural: string;
  /** Lowercase plural for mid-sentence prose. */
  noun: string;
  /** Whether "for Rent" belongs after the plural. */
  rents: boolean;
};

const TYPE_VOCAB: Record<PropertyType, TypeVocab> = {
  villa: { slug: "villas", plural: "Villas", noun: "villas", rents: true },
  apartment: { slug: "apartments", plural: "Apartments", noun: "apartments", rents: true },
  hotel: { slug: "hotel-rooms", plural: "Hotel Rooms", noun: "hotel rooms", rents: false },
  bnb: { slug: "bnb-stays", plural: "BnB Stays", noun: "BnB stays", rents: false },
  commercial: {
    slug: "commercial-property",
    plural: "Commercial Property",
    noun: "commercial spaces",
    rents: true,
  },
};

/**
 * Bedroom counts that get their own page.
 *
 * Capped at 5 deliberately. Search demand for "6 bedroom apartment Mogadishu"
 * rounds to zero, and every extra row is another page that must clear the
 * inventory threshold or sit noindexed forever. A 6-bed villa still appears on
 * the un-bedroomed `/properties/villas-in-mogadishu` page.
 */
const BEDROOM_COUNTS = [1, 2, 3, 4, 5] as const;

/**
 * Types that get bedroom pages at all.
 *
 * Bedroom count is how people shop for a home, so villas and apartments carry
 * it. Nobody searches "2 bedroom commercial space", and a hotel room's bedroom
 * count is an artefact of how the owner filled the form rather than something a
 * guest filters on — they search by district and price.
 */
const BEDROOM_TYPES: PropertyType[] = ["villa", "apartment"];

/** Types that get one page per district. */
const DISTRICT_TYPES: PropertyType[] = ["villa", "apartment", "hotel"];

export type FacetDef = {
  /** URL segment after /properties/. Unique, lowercase, hyphenated. */
  slug: string;
  type: PropertyType;
  /** Exact bedroom count this page filters to, if any. */
  bedrooms?: number;
  /** Canonical district spelling from MOGADISHU_DISTRICTS, if any. */
  district?: string;
  /** <h1>. */
  heading: string;
  /** <title>, before the brand suffix. */
  title: string;
  /** Meta description. */
  description: string;
  /** One paragraph of real page copy under the heading. */
  intro: string;
};

/** "Waberi" -> "waberi", "Hamar Jajab" -> "hamar-jajab". */
export function districtSlug(district: string): string {
  return district.toLowerCase().replace(/\s+/g, "-");
}

function buildFacet(
  type: PropertyType,
  opts: { bedrooms?: number; district?: string },
): FacetDef {
  const vocab = TYPE_VOCAB[type];
  const { bedrooms, district } = opts;

  // "3 Bedroom Apartments" — attributive singular, because that is how the
  // phrase is actually typed into a search box. "3 Bedrooms Apartments" is not
  // a query anybody makes.
  const bedPrefix = bedrooms ? `${bedrooms} Bedroom ` : "";
  const where = district ? `${district}, Mogadishu` : "Mogadishu";
  const forRent = vocab.rents ? " for Rent" : "";

  const heading = `${bedPrefix}${vocab.plural}${forRent} in ${where}`;
  const slug = [
    bedrooms ? `${bedrooms}-bedroom` : null,
    vocab.slug,
    "in",
    district ? districtSlug(district) : "mogadishu",
  ]
    .filter(Boolean)
    .join("-");

  const what = `${bedrooms ? `${bedrooms}-bedroom ` : ""}${vocab.noun}`;
  const verb = vocab.rents ? "for rent" : "available";

  // Written per-facet rather than from one template with holes, so the pages
  // are not near-identical to each other. Duplicate boilerplate across a
  // category set is exactly what gets a set of pages filtered as thin.
  const intro = district
    ? `All ${what} we have listed in ${district}, Mogadishu, ${verb} right now. ` +
      `Prices come straight from the owner or agent, photos are of the actual unit, ` +
      `and you contact them directly — we take no commission on the deal.`
    : `All ${what} listed with us across Mogadishu, ${verb} right now. ` +
      `Compare what each district costs, see real photos rather than stock images, ` +
      `and deal with the owner or agent yourself.`;

  const description = district
    ? `Browse ${what} ${verb} in ${district}, Mogadishu. Real photos, owner prices, direct contact — no booking fee.`
    : `Browse ${what} ${verb} across all 18 districts of Mogadishu. Real photos, owner prices, direct contact — no booking fee.`;

  return { slug, type, bedrooms, district, heading, title: heading, description, intro };
}

/**
 * The full catalogue. Order matters only for the "related searches" block,
 * which slices from it — broadest first reads better than alphabetical.
 */
export const ALL_FACETS: FacetDef[] = [
  // One page per type, city-wide. The broadest and most valuable of the set.
  ...(Object.keys(TYPE_VOCAB) as PropertyType[]).map((t) => buildFacet(t, {})),
  // Bedroom counts, city-wide: the "3 bedroom apartment in Mogadishu" target.
  ...BEDROOM_TYPES.flatMap((t) => BEDROOM_COUNTS.map((n) => buildFacet(t, { bedrooms: n }))),
  // Type x district: the long tail, and where a new city's inventory lands
  // first.
  ...DISTRICT_TYPES.flatMap((t) =>
    MOGADISHU_DISTRICTS.map((d) => buildFacet(t, { district: d })),
  ),
];

const BY_SLUG = new Map(ALL_FACETS.map((f) => [f.slug, f]));

/** Resolve a URL segment to its facet, or null if it is not one of ours. */
export function findFacet(slug: string | undefined | null): FacetDef | null {
  if (!slug) return null;
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}

/**
 * The facet a set of filters corresponds to, if one exists.
 *
 * Used to point `/properties?type=apartment&district=Hodan` at its path
 * equivalent with a canonical, so the two URLs pool their signals instead of
 * competing. Returns null when no facet covers the combination — a free-text
 * search, a price band — and those stay noindex where they are.
 */
export function facetSlugFor(filters: {
  type?: string | null;
  district?: string | null;
  bedrooms?: number | null;
}): string | null {
  const match = ALL_FACETS.find(
    (f) =>
      f.type === filters.type &&
      (f.district ?? null) === (filters.district ?? null) &&
      (f.bedrooms ?? null) === (filters.bedrooms ?? null),
  );
  return match?.slug ?? null;
}

/**
 * Does this listing belong on this facet page?
 *
 * The single predicate both the page filter and the sitemap's count read from,
 * so a page can never be published on a count it does not actually render.
 */
export function facetMatches(
  facet: FacetDef,
  listing: { type?: string | null; location?: string | null; bedrooms?: number | null },
): boolean {
  if (listing.type !== facet.type) return false;
  if (facet.district && listing.location !== facet.district) return false;
  if (facet.bedrooms != null && listing.bedrooms !== facet.bedrooms) return false;
  return true;
}

/**
 * Facets worth linking to from `facet`, nearest relation first.
 *
 * Internal links are how a crawler discovers these pages at all — none of them
 * are reachable from the nav — and how authority moves between them. Siblings
 * first (same type, different bedroom count) because that is also the most
 * useful thing to a visitor who just found the 3-bed page too small.
 */
export function relatedFacets(facet: FacetDef, limit = 6): FacetDef[] {
  const score = (f: FacetDef): number => {
    if (f.slug === facet.slug) return -1;
    if (f.type !== facet.type) return 1;
    // Same type: a bedroom sibling beats a district sibling beats the city-wide
    // parent, which is already linked as a breadcrumb.
    if (facet.bedrooms && f.bedrooms) return 4;
    if (facet.district && f.district) return 3;
    return 2;
  };
  return ALL_FACETS.filter((f) => score(f) > 0)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}
