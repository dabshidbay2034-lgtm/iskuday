/**
 * schema.org JSON-LD builders — pure functions, no React, no side effects.
 *
 * These produce the plain objects handed to `<Seo jsonLd={...} />`, which is the
 * only thing that knows how to get them into a `<script type="application/ld+json">`.
 * Keeping the builders here means the shapes are unit-testable and reusable, and
 * that "what does Google think this page IS?" has exactly one answer per page type.
 *
 * WHY this matters for this product specifically: a listing rendered as anonymous
 * HTML competes on text alone. The same listing that DECLARES itself a real-estate
 * listing — with a price, a Mogadishu district, a Banaadir region signal and photos
 * — is machine-matchable against "3 bedroom apartment Hodan". Lodging markup is
 * better supported still, which is why the hotel builder is the richest one here.
 *
 * What each builder is for
 * ────────────────────────────────────────────────────────────────────────────
 *  organizationLd()      The publisher entity. Emitted once (site-wide, on "/").
 *                        Everything else references it by @id rather than
 *                        restating it, so there is a single Organization node.
 *  websiteSearchLd()     WebSite + SearchAction. Tells Google the site has its own
 *                        search at /properties?q=… (sitelinks searchbox).
 *  breadcrumbLd()        BreadcrumbList for the crumb trail on any page.
 *  propertyListingLd()   ONE rental listing → RealEstateListing wrapping an
 *                        Accommodation subtype. The detail page (/property/:id).
 *  hotelLd()             ONE hotel page (/hotels/:slug) → Hotel (a LodgingBusiness)
 *                        with its rooms as containsPlace + makesOffer.
 *  itemListLd()          A results grid (/properties, /services) declaring what it
 *                        lists, in order.
 *  serviceLd()           ONE entry in the services catalog (/services).
 *
 * Verify with
 * ────────────────────────────────────────────────────────────────────────────
 *  · Google Rich Results Test — https://search.google.com/test/rich-results
 *    (eligibility for rich treatment; paste the rendered page URL, not the JSON,
 *    because this app is client-rendered and the script is injected at runtime)
 *  · Schema Markup Validator — https://validator.schema.org
 *    (raw vocabulary correctness; paste the JSON-LD block itself)
 *
 * Two hard rules run through every function below:
 *  1. NEVER emit a field we do not have. An absent key is strictly better than
 *     `null`, `""` or a plausible guess — and inventing an aggregateRating or a
 *     reviewCount for listings that have no reviews is precisely the kind of thing
 *     that earns a manual spam action. Every object is routed through `omitEmpty`.
 *  2. Everything must survive `JSON.stringify` unchanged: no `undefined` left in
 *     the tree, no `Date` objects — dates are passed through as ISO strings.
 */

import { MOGADISHU_DISTRICTS } from "@/lib/districts";

// ── Site constants ───────────────────────────────────────────────────────────

/**
 * Every URL in structured data must be absolute — a crawler resolves JSON-LD
 * without a document base. One constant so a domain change is a one-line edit.
 * No trailing slash: paths are always appended with a leading "/".
 */
export const siteUrl = "https://mogadishurents.com";

/** Stable node ids, so Organization/WebSite are stated once and linked thereafter. */
export const ORGANIZATION_ID = `${siteUrl}/#organization`;
export const WEBSITE_ID = `${siteUrl}/#website`;

const SITE_NAME = "MogadishuRents";

/**
 * The platform's single published contact channel (the WhatsApp number wired into
 * PropertyDetail's contact button). E.164 so it is dialable from a search result.
 */
const SITE_TELEPHONE = "+252612679357";

/** Mogadishu is the capital of the Banaadir region — that pair is the local-search signal. */
const ADDRESS_REGION = "Banaadir";
const ADDRESS_COUNTRY = "SO";

/** All money on this platform is quoted in US dollars. */
const CURRENCY = "USD";

/** UN/CEFACT common codes for the two rental periods this product supports. */
const UNIT_DAY = "DAY";
const UNIT_MONTH = "MON";

// ── JSON-LD primitives ───────────────────────────────────────────────────────

export type LdValue = string | number | boolean | LdObject | LdValue[];

export interface LdObject {
  [key: string]: LdValue | null | undefined;
}

const isPlainObject = (v: unknown): v is LdObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys that describe a node but say nothing about it on their own. */
const STRUCTURAL_KEYS = new Set(["@context", "@type"]);

/**
 * Recursively drop anything we do not actually have: `undefined`, `null`, blank
 * or whitespace-only strings, non-finite numbers, empty arrays, and objects that
 * ended up with nothing but an `@type` on them.
 *
 * That last case is the one that bites in practice — a PostalAddress built from a
 * listing with no district would otherwise ship as a bare `{"@type":"PostalAddress"}`,
 * which is noise a validator flags and a crawler cannot use. `false` and `0` are
 * deliberately KEPT: a studio legitimately has 0 bedrooms, and callers are expected
 * to decide for themselves whether a zero price is meaningful (they mostly aren't,
 * so the builders below guard prices explicitly rather than leaning on this).
 */
export function omitEmpty(input: LdObject): LdObject {
  const out: LdObject = {};
  for (const key of Object.keys(input)) {
    const pruned = prune(input[key]);
    if (pruned !== undefined) out[key] = pruned;
  }
  return out;
}

function prune(value: LdValue | null | undefined): LdValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const kept = value
      .map(prune)
      .filter((v): v is LdValue => v !== undefined);
    return kept.length > 0 ? kept : undefined;
  }
  if (isPlainObject(value)) {
    const cleaned = omitEmpty(value);
    const meaningful = Object.keys(cleaned).some((k) => !STRUCTURAL_KEYS.has(k));
    return meaningful ? cleaned : undefined;
  }
  return undefined;
}

// ── Small value helpers ──────────────────────────────────────────────────────

/** Absolute-ise a path. Already-absolute http(s) URLs (Supabase assets) pass through. */
function abs(pathOrUrl?: string | null): string | undefined {
  const v = pathOrUrl?.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return `${siteUrl}${v.startsWith("/") ? "" : "/"}${v}`;
}

function absAll(list?: readonly (string | null | undefined)[] | null): string[] | undefined {
  const kept = (list ?? []).map(abs).filter((u): u is string => Boolean(u));
  return kept.length > 0 ? kept : undefined;
}

/** A price/size only counts if it is a real positive number — 0 means "not set" here. */
function positive(n?: number | null): number | undefined {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** A room/bed count, where 0 is a legitimate answer but a missing value is not. */
function count(n?: number | null): number | undefined {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Fold a free-text `location` onto the canonical district spelling when we can.
 * Owners type things like "hodan" or "Hodan, near KM4"; search engines match the
 * canonical "Hodan" far better, and getting the 18 districts spelled consistently
 * across every listing is most of the value of marking up the address at all.
 * Anything we can't recognise is passed through verbatim rather than dropped —
 * it is still the listing's real stated location.
 */
export function canonicalDistrict(location?: string | null): string | undefined {
  const raw = location?.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const hit = MOGADISHU_DISTRICTS.find(
    (d) => d.toLowerCase() === lower || lower.includes(d.toLowerCase()),
  );
  return hit ?? raw;
}

/**
 * PostalAddress for anything on this platform. `addressLocality` is the district,
 * because that is the unit renters actually search in; region/country are constant
 * because the whole product is Mogadishu-only.
 */
function postalAddressLd(args: {
  locality?: string | null;
  streetAddress?: string | null;
}): LdObject {
  return {
    "@type": "PostalAddress",
    streetAddress: args.streetAddress?.trim(),
    addressLocality: canonicalDistrict(args.locality),
    addressRegion: ADDRESS_REGION,
    addressCountry: ADDRESS_COUNTRY,
  };
}

/** The one geographic scope this platform serves. Mirrors the block in index.html. */
function areaServedLd(): LdObject {
  return {
    "@type": "City",
    name: "Mogadishu",
    containedInPlace: { "@type": "Country", name: "Somalia" },
  };
}

/**
 * A per-period rate. Getting the period wrong is worse than omitting it — a nightly
 * hotel rate published as a monthly rent is an off-by-30x lie about the price — so
 * the caller's `isDailyRate` / hotel type decides `unitCode` and there is no default
 * that silently assumes one or the other.
 */
function unitPriceSpecificationLd(price: number, perNight: boolean): LdObject {
  return {
    "@type": "UnitPriceSpecification",
    price,
    priceCurrency: CURRENCY,
    unitCode: perNight ? UNIT_DAY : UNIT_MONTH,
    unitText: perNight ? "NIGHT" : "MONTH",
  };
}

/** schema.org availability enum. Unknown availability emits nothing at all. */
function availabilityUrl(isAvailable?: boolean | null): string | undefined {
  if (isAvailable === true) return "https://schema.org/InStock";
  if (isAvailable === false) return "https://schema.org/OutOfStock";
  return undefined;
}

/** GoodRelations business function: this is a lease, not a sale. */
const LEASE_OUT = "http://purl.org/goodrelations/v1#LeaseOut";

/** Build the amenity list, keeping only the flags that are actually true. */
function amenityFeaturesLd(flags: Record<string, boolean | null | undefined>): LdObject[] {
  return Object.keys(flags)
    .filter((name) => flags[name] === true)
    .map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    }));
}

// ── Organization ─────────────────────────────────────────────────────────────

/**
 * The publisher. Deliberately plain `Organization` rather than `RealEstateAgent`:
 * MogadishuRents is a marketplace that hosts other people's listings, it is not
 * itself the letting agent, and claiming otherwise would be a factual overreach.
 *
 * This complements — and must not contradict — the `WebApplication` block already
 * hard-coded in index.html: same name, same url, same areaServed, different @type,
 * separate node. No rating, no founding date, no sameAs: we have no verified
 * social profiles to point at, so the key is simply absent.
 */
export function organizationLd(): object {
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE_NAME,
    url: `${siteUrl}/`,
    logo: {
      "@type": "ImageObject",
      url: `${siteUrl}/icon-512.png`,
      width: 512,
      height: 512,
    },
    image: `${siteUrl}/icon-512.png`,
    description:
      "Mogadishu's rental platform for houses, apartments, hotel rooms and commercial spaces.",
    telephone: SITE_TELEPHONE,
    areaServed: areaServedLd(),
    address: {
      "@type": "PostalAddress",
      addressLocality: "Mogadishu",
      addressRegion: ADDRESS_REGION,
      addressCountry: ADDRESS_COUNTRY,
    },
  });
}

// ── WebSite + SearchAction ───────────────────────────────────────────────────

/**
 * Declares the site and its internal search. `/properties?q=` is the real search
 * endpoint (Properties.tsx reads the `q` param), so this is a truthful claim —
 * a SearchAction pointing at a URL that doesn't search is worse than none.
 */
export function websiteSearchLd(): object {
  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME,
    url: `${siteUrl}/`,
    inLanguage: "en",
    publisher: { "@id": ORGANIZATION_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl}/properties?q={search_term_string}`,
      },
      // Must stay a bare string in this exact form — it is a magic token, not a URL.
      "query-input": "required name=search_term_string",
    },
  });
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

export interface BreadcrumbCrumb {
  name: string;
  /** Absolute URL, or a site-relative path like "/properties". */
  url: string;
}

/**
 * Positions are 1-based and must be contiguous, so the trail is filtered BEFORE
 * numbering — a crumb missing a name or url would otherwise leave a hole that
 * invalidates the whole list.
 */
export function breadcrumbLd(trail: BreadcrumbCrumb[]): object {
  const items = (trail ?? [])
    .map((crumb) => ({ name: crumb?.name?.trim(), url: abs(crumb?.url) }))
    .filter((crumb): crumb is { name: string; url: string } =>
      Boolean(crumb.name && crumb.url),
    );

  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  });
}

// ── Property listing ─────────────────────────────────────────────────────────

/**
 * The shape a listing page hands in. Mirrors the `properties` row plus its joined
 * images, in the DB's own vocabulary (`type` may be `villa`, which the UI calls
 * `house`) so callers don't have to translate before calling.
 */
export interface PropertyListingLdInput {
  id: string;
  title: string;
  description?: string | null;
  /** DB enum: "villa" | "house" | "apartment" | "hotel" | "commercial". */
  type?: string | null;
  /** Monthly rent, or nightly rate when `isDailyRate` (or type "hotel"). */
  price?: number | null;
  deposit?: number | null;
  /** Mogadishu district, as typed by the owner. */
  location?: string | null;
  images?: (string | null | undefined)[] | null;
  isAvailable?: boolean | null;
  isDailyRate?: boolean | null;
  bedrooms?: number | null;
  toilets?: number | null;
  livingRooms?: number | null;
  kitchens?: number | null;
  floorNumber?: number | null;
  hasParking?: boolean | null;
  hasCctv?: boolean | null;
  isFurnished?: boolean | null;
  hasElevator?: boolean | null;
  hasBalcony?: boolean | null;
  /** ISO 8601 string (the `created_at` column). Never a Date — this gets stringified. */
  createdAt?: string | null;
  /**
   * Interior floor area in square metres. There is NO such column today, so this
   * is only ever populated if a caller genuinely has the number; left unset,
   * `floorSize` is omitted rather than estimated from the room counts.
   */
  floorSizeSqm?: number | null;
  /** Override the canonical URL; defaults to /property/:id. */
  url?: string | null;
}

/**
 * DB/UI type → schema.org Accommodation subtype.
 *
 * `villa` and `house` are the same thing under two names (see lib/property-display.ts)
 * and both are a `House`. `commercial` gets the generic `Accommodation` because
 * schema.org has no "shop unit" type and `House`/`Apartment` would be a lie. A
 * `hotel`-type property is one bookable nightly room, not a hotel business, so it
 * is a `HotelRoom` — still an Accommodation subtype, and it keeps a room listing
 * from claiming to be a lodging business with no address or phone to back it up.
 */
function accommodationType(type?: string | null): string {
  switch ((type ?? "").toLowerCase()) {
    case "villa":
    case "house":
      return "House";
    case "apartment":
      return "Apartment";
    case "hotel":
      return "HotelRoom";
    default:
      return "Accommodation";
  }
}

/**
 * One rental listing.
 *
 * Outer type is `RealEstateListing` — it is a WebPage subtype, which is what a
 * listing page IS, and (via CreativeWork) it legitimately carries `offers`,
 * `image`, `about` and `mainEntity`. The physical unit hangs off `mainEntity` as
 * a typed Accommodation with its own @id, and `about` points back at that same
 * node by reference instead of duplicating the object.
 */
export function propertyListingLd(p: PropertyListingLdInput): object {
  const listingUrl = abs(p.url) ?? `${siteUrl}/property/${p.id}`;
  const accommodationId = `${listingUrl}#accommodation`;
  const perNight = p.isDailyRate === true || (p.type ?? "").toLowerCase() === "hotel";
  const price = positive(p.price);
  const deposit = positive(p.deposit);
  const district = canonicalDistrict(p.location);

  const bedrooms = count(p.bedrooms);
  const livingRooms = count(p.livingRooms);
  const kitchens = count(p.kitchens);
  const bathrooms = count(p.toilets);

  /**
   * schema.org `numberOfRooms` excludes bathrooms and closets, so it is
   * bedrooms + living rooms + kitchens — summed from whichever of those we have,
   * and omitted entirely when we have none of them rather than defaulting to 0.
   */
  const roomParts = [bedrooms, livingRooms, kitchens].filter(
    (n): n is number => n !== undefined,
  );
  const numberOfRooms =
    roomParts.length > 0 ? roomParts.reduce((a, b) => a + b, 0) : undefined;

  const floorSizeSqm = positive(p.floorSizeSqm);

  const accommodation: LdObject = {
    "@type": accommodationType(p.type),
    "@id": accommodationId,
    name: p.title,
    numberOfBedrooms: bedrooms,
    numberOfBathroomsTotal: bathrooms,
    numberOfRooms,
    // Text, per schema.org — "3" not 3.
    floorLevel: p.floorNumber != null ? String(p.floorNumber) : undefined,
    floorSize: floorSizeSqm
      ? {
          "@type": "QuantitativeValue",
          value: floorSizeSqm,
          // UN/CEFACT code for square metre.
          unitCode: "MTK",
        }
      : undefined,
    address: postalAddressLd({ locality: p.location }),
    amenityFeature: amenityFeaturesLd({
      Parking: p.hasParking,
      "CCTV security": p.hasCctv,
      Furnished: p.isFurnished,
      Elevator: p.hasElevator,
      Balcony: p.hasBalcony,
    }),
  };

  /**
   * Rent first, deposit second. schema.org has no security-deposit property, so
   * the deposit rides along as a second, named, PERIODLESS PriceSpecification —
   * giving it a unitCode would misrepresent a one-off sum as a recurring charge.
   */
  const priceSpecs: LdObject[] = [];
  if (price !== undefined) priceSpecs.push(unitPriceSpecificationLd(price, perNight));
  if (deposit !== undefined) {
    priceSpecs.push({
      "@type": "PriceSpecification",
      name: "Security deposit",
      price: deposit,
      priceCurrency: CURRENCY,
    });
  }

  const offer: LdObject | undefined =
    price === undefined
      ? undefined
      : {
          "@type": "Offer",
          url: listingUrl,
          price,
          priceCurrency: CURRENCY,
          availability: availabilityUrl(p.isAvailable),
          businessFunction: LEASE_OUT,
          itemOffered: { "@id": accommodationId },
          priceSpecification: priceSpecs,
        };

  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": listingUrl,
    url: listingUrl,
    name: p.title,
    description: p.description,
    image: absAll(p.images),
    // Already an ISO string from Postgres; passed through untouched so nothing
    // non-serialisable ever reaches JSON.stringify.
    datePosted: p.createdAt,
    isPartOf: { "@id": WEBSITE_ID },
    provider: { "@id": ORGANIZATION_ID },
    mainEntity: accommodation,
    about: { "@id": accommodationId },
    offers: offer,
  });
}

// ── Hotel ────────────────────────────────────────────────────────────────────

export interface HotelLdInput {
  /** Public slug — the page lives at /hotels/:slug. */
  slug: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  heroImageUrl?: string | null;
  logoUrl?: string | null;
  gallery?: (string | null | undefined)[] | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  contactEmail?: string | null;
  /** Free-text street address as the owner typed it. */
  address?: string | null;
  /** Google Maps link, if the owner supplied one. */
  mapsUrl?: string | null;
  socials?: Record<string, string | null | undefined> | null;
  url?: string | null;
}

export interface HotelRoomLdInput {
  id: string;
  name: string;
  /** Nightly rate. */
  price?: number | null;
  /** District, when the underlying property row carries one. */
  location?: string | null;
  images?: (string | null | undefined)[] | null;
  url?: string | null;
}

/**
 * A hotel's public page.
 *
 * `Hotel` is a `LodgingBusiness`, which is both a Place and an Organization —
 * that dual nature is what lets it carry `address`/`containsPlace` alongside
 * `makesOffer`, and it is the best-supported rich-result surface this product has.
 *
 * Rooms appear twice, by design and without duplication: as `containsPlace`
 * HotelRoom nodes (what the hotel physically contains) and as `makesOffer` Offers
 * whose `itemOffered` is an @id reference back to those rooms (what they cost).
 * Price does NOT go on the room itself — `Accommodation` is a Place, and Places
 * have no `offers` property.
 *
 * Deliberately absent: `starRating`, `aggregateRating`, `review`, `checkinTime`,
 * `amenityFeature`, `geo`. None of that exists in the `hotels` table, and a
 * fabricated star rating is exactly the kind of markup that earns a penalty.
 */
export function hotelLd(h: HotelLdInput, rooms?: HotelRoomLdInput[]): object {
  const pageUrl = abs(h.url) ?? `${siteUrl}/hotels/${h.slug}`;
  const hotelId = `${pageUrl}#hotel`;
  const roomList = (rooms ?? []).filter((r) => r && r.id && r.name?.trim());

  /**
   * The district comes from whichever room carries one; otherwise the locality is
   * simply "Mogadishu", which is true of every hotel on this platform. We never
   * guess a district — the wrong district is worse than the right city.
   */
  const roomDistrict = roomList
    .map((r) => canonicalDistrict(r.location))
    .find((d): d is string => Boolean(d));

  /**
   * One address for the building and every room in it. Rooms don't have their own
   * street — letting a room without a `location` fall through to a locality-less
   * address would put sibling rooms in the same hotel at different addresses.
   */
  const hotelAddress = postalAddressLd({
    locality: roomDistrict ?? "Mogadishu",
    streetAddress: h.address,
  });

  const entries = roomList.map((r) => ({
    node: {
      "@type": "HotelRoom",
      "@id": `${pageUrl}#room-${r.id}`,
      name: r.name,
      url: abs(r.url) ?? `${siteUrl}/property/${r.id}`,
      image: absAll(r.images),
      address: hotelAddress,
    } satisfies LdObject,
    rate: positive(r.price),
    id: `${pageUrl}#room-${r.id}`,
  }));
  const rates = entries
    .map((e) => e.rate)
    .filter((n): n is number => n !== undefined);

  /**
   * priceRange is derived from the actual nightly rates and omitted when there
   * are none — a guessed "$$" tells a renter nothing and a crawler less.
   */
  let priceRange: string | undefined;
  if (rates.length > 0) {
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    priceRange = min === max ? `$${min}` : `$${min} - $${max}`;
  }

  const offers = entries
    .filter((e) => e.rate !== undefined)
    .map((e) => ({
      "@type": "Offer",
      price: e.rate,
      priceCurrency: CURRENCY,
      businessFunction: LEASE_OUT,
      // Every room here is a nightly rate — that is what a hotel page is.
      priceSpecification: unitPriceSpecificationLd(e.rate as number, true),
      itemOffered: { "@id": e.id },
    }));

  /** Only real URLs go in sameAs; the editor may hold bare handles, which are not. */
  const sameAs = absAll(
    Object.values(h.socials ?? {}).filter((v) => /^https?:\/\//i.test((v ?? "").trim())),
  );

  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "Hotel",
    "@id": hotelId,
    name: h.name,
    url: pageUrl,
    // Tagline is the fallback description — both are owner-written prose.
    description: h.description ?? h.tagline,
    slogan: h.tagline,
    image: absAll([h.heroImageUrl, ...(h.gallery ?? [])]),
    logo: abs(h.logoUrl),
    telephone: h.contactPhone ?? h.contactWhatsapp,
    email: h.contactEmail,
    address: hotelAddress,
    hasMap: abs(h.mapsUrl),
    sameAs,
    areaServed: areaServedLd(),
    currenciesAccepted: CURRENCY,
    priceRange,
    containsPlace: entries.map((e) => e.node),
    makesOffer: offers,
    isPartOf: { "@id": WEBSITE_ID },
  });
}

// ── ItemList ─────────────────────────────────────────────────────────────────

export interface ItemListEntry {
  url: string;
  name: string;
}

/**
 * What a results grid contains, in the order it is rendered. Used on /properties
 * so a filtered category page ("apartments in Hodan") declares its members rather
 * than looking like an undifferentiated wall of links.
 *
 * Entries are ListItem + url rather than fully inlined listings on purpose: the
 * detail page is the authority on each listing, and restating a trimmed copy here
 * only creates two versions of the truth to keep in sync.
 */
export function itemListLd(items: ItemListEntry[], listName: string): object {
  const entries = (items ?? [])
    .map((item) => ({ name: item?.name?.trim(), url: abs(item?.url) }))
    .filter((item): item is { name: string; url: string } => Boolean(item.name && item.url));

  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    numberOfItems: entries.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: entries.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: item.url,
    })),
  });
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface ServiceLdInput {
  title: string;
  slug: string;
  description?: string | null;
  imageUrl?: string | null;
  /** "From $X" starting price, when the catalog entry has one. */
  priceFrom?: number | null;
  /** Free-text qualifier, e.g. "per unit, per month". */
  priceNote?: string | null;
  url?: string | null;
}

/**
 * One entry in the property-services catalog (cleaning, maintenance, management…).
 *
 * `Service` carries `offers` natively. A `price_from` is a floor, not a price, so
 * it is published as `minPrice` on a PriceSpecification — quoting it as `price`
 * would state a fixed fee the business has not committed to. No unitCode: the
 * billing period lives in the owner's free-text `price_note`, and inferring one
 * from prose would be a guess.
 */
export function serviceLd(s: ServiceLdInput): object {
  const url = abs(s.url) ?? `${siteUrl}/services#${s.slug}`;
  const from = positive(s.priceFrom);

  return omitEmpty({
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": url,
    name: s.title,
    description: s.description,
    url,
    image: abs(s.imageUrl),
    provider: { "@id": ORGANIZATION_ID },
    areaServed: areaServedLd(),
    offers:
      from === undefined
        ? undefined
        : {
            "@type": "Offer",
            priceCurrency: CURRENCY,
            description: s.priceNote,
            priceSpecification: {
              "@type": "PriceSpecification",
              minPrice: from,
              priceCurrency: CURRENCY,
            },
          },
  });
}
