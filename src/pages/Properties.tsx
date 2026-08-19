import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFavorites } from "@/hooks/use-favorites";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import PropertyCard from "@/components/PropertyCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Home, Building2, Hotel, Briefcase, SlidersHorizontal, Search, MapPin, X,
  Bed, BedDouble, DollarSign, Car, Cctv, Waves, ArrowUpDown, Armchair, CalendarDays,
  Snowflake, Refrigerator, ConciergeBell,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle, truncate } from "@/lib/seo";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import {
  FACET_MIN_LISTINGS,
  facetMatches,
  facetSlugFor,
  findFacet,
  relatedFacets,
} from "@/lib/facets";
import { breadcrumbLd, itemListLd } from "@/lib/structured-data";
import NotFound from "@/pages/NotFound";
import type { Property, PropertyType } from "@/lib/types";
import { useRoomBookedRanges, bookedUntil } from "@/hooks/use-room-availability";
import { looseFrom } from "@/lib/supabase-loose";

interface RawPropertyRecord {
  id: string;
  title: string;
  description: string;
  type: string;
  price: number;
  deposit: number;
  location: string;
  owner_id?: string;
  org_id?: string;
  created_at: string;
  is_available?: boolean;
  is_listed?: boolean;
  occupancy_status?: string;
  is_daily_rate?: boolean;
  purpose?: string;
  bedrooms?: number;
  living_rooms?: number;
  kitchens?: number;
  toilets?: number;
  has_cctv?: boolean;
  has_parking?: boolean;
  floor_number?: number;
  has_balcony?: boolean;
  is_furnished?: boolean;
  has_air_conditioning?: boolean;
  has_refrigerator?: boolean;
  has_room_service?: boolean;
  property_images?: Array<{ image_url: string; sort_order?: number }>;
}

const typeFilters = [
  { value: "", label: "All", icon: SlidersHorizontal },
  { value: "villa", label: "Villas", icon: Home },
  { value: "apartment", label: "Apartments", icon: Building2 },
  { value: "hotel", label: "Hotels", icon: Hotel },
  { value: "bnb", label: "BnB", icon: BedDouble },
  { value: "commercial", label: "Commercial", icon: Briefcase },
];

// ── SEO for a faceted listing page ──────────────────────────────────────────
//
// /properties is the classic crawl-budget sink: every filter is a query param,
// every combination is a distinct URL, and free-text search makes the set
// literally infinite. Left alone, Googlebot spends its budget on
// ?q=asdf&minPrice=317 instead of on the 15 listings that matter.
//
// The policy, applied by `seoForFilters` below:
//   1. Only `district` + `type` produce an INDEXABLE page. Those are the two
//      facets people actually search for ("apartments Hodan"), and there are
//      18 x 4 of them — a bounded, useful set.
//   2. Free-text `q` and any price bound are noindex. Unbounded, and the
//      resulting page is a personal search result, not a category.
//   3. The canonical is rebuilt from ONLY the recognised facets, in a fixed
//      order. That collapses ?type=X&district=Y and ?district=Y&type=X, folds
//      the legacy ?location= alias into ?district=, normalises casing, and
//      drops tracking params — all of which are otherwise separate URLs
//      serving identical HTML.
//
// Titles/descriptions read from the URL, NOT from the filter React state. The
// panel's district/bedroom/amenity controls change state without touching the
// query string, so that state describes a view no crawler can ever reach.

/** Plural labels for the four real category pages, keyed on the URL value. */
const SEO_TYPE_LABELS: Record<string, { plural: string; lower: string; forRent: boolean }> = {
  villa: { plural: "Villas", lower: "villas", forRent: true },
  apartment: { plural: "Apartments", lower: "apartments", forRent: true },
  // "Hotels for rent" reads as a typo — hotels are booked by the night.
  hotel: { plural: "Hotels", lower: "hotel rooms", forRent: false },
  // Same reasoning: a BnB is booked, not rented.
  bnb: { plural: "BnB", lower: "BnB", forRent: false },
  commercial: { plural: "Commercial Spaces", lower: "commercial spaces", forRent: true },
};

/**
 * Fold a raw ?district= value onto the canonical spelling from the district
 * list, case-insensitively.
 *
 * It must stay a real district name rather than becoming a lowercase slug: the
 * results are filtered with an exact `p.location !== district` comparison, so a
 * canonical pointing at ?district=hodan would advertise a URL that renders zero
 * properties. A canonical has to serve the same content as the page declaring
 * it, or it is just a fancier version of the bug this file is fixing.
 */
function canonicalDistrict(raw: string): string | null {
  const needle = raw.trim().toLowerCase();
  if (!needle || needle === "all") return null;
  return MOGADISHU_DISTRICTS.find((d) => d.toLowerCase() === needle) ?? null;
}

function seoForFilters(params: {
  type: string;
  district: string;
  query: string;
  minPrice: string;
  maxPrice: string;
}) {
  const type = SEO_TYPE_LABELS[params.type] ? params.type : "";
  const district = canonicalDistrict(params.district);

  // A supplied facet we do not recognise is junk (a typo, a scraper, a stale
  // link). It still renders, but it must not be indexed as its own page.
  const unknownFacet =
    (params.type !== "" && type === "") || (params.district.trim() !== "" && district === null);
  const noindex =
    unknownFacet ||
    params.query.trim() !== "" ||
    params.minPrice.trim() !== "" ||
    params.maxPrice.trim() !== "";

  const search = new URLSearchParams();
  if (district) search.set("district", district);
  if (type) search.set("type", type);
  const qs = search.toString();
  // Points at the clean facet page even when noindexed, so that an inbound link
  // to someone's filtered URL still consolidates onto a page we do want ranked.
  //
  // When the combination has a path-based twin (/properties/apartments-in-hodan),
  // that is the canonical instead. The two URLs render identical HTML, and a
  // path segment is indexed far more willingly than a query string — so the
  // query form exists to be linked, and the path form exists to be ranked.
  const pathFacet = facetSlugFor({ type: type || null, district });
  const canonical = pathFacet
    ? absoluteUrl(`/properties/${pathFacet}`)
    : absoluteUrl(`/properties${qs ? `?${qs}` : ""}`);

  const where = district ? `${district}, Mogadishu` : "Mogadishu";
  const label = type ? SEO_TYPE_LABELS[type] : null;

  const title = label
    ? `${label.plural}${label.forRent ? " for Rent" : ""} in ${where}`
    : `Properties for Rent in ${where}`;

  const what = label ? label.lower : "villas, apartments, hotels and commercial spaces";
  const description = truncate(
    district
      ? `Browse verified ${what} for rent in ${district}, Mogadishu. Compare prices, photos and amenities, then contact the owner directly. Guri kiro ah oo ${district} ah.`
      : `Browse verified ${what} for rent across all 18 districts of Mogadishu. Compare prices, photos and amenities, then contact the owner directly. Guri kiro ah oo Muqdisho ah.`,
    158,
  );

  return { title: buildTitle(title), description, canonical, noindex };
}

const Properties = () => {
  const { isFavorite, toggleFavorite, isAuthenticated } = useFavorites();
  const [searchParams, setSearchParams] = useSearchParams();

  // `/properties/:facetSlug` renders this same component with its filters
  // forced. An unrecognised slug is NOT rendered as an empty category page —
  // that is a thin page Google would happily index — it falls through to the
  // 404 below, after every hook has run.
  const { facetSlug } = useParams();
  const facet = findFacet(facetSlug);
  const facetUnknown = Boolean(facetSlug) && !facet;

  const navigate = useNavigate();

  const activeType = facet?.type ?? (searchParams.get("type") || "");
  const activePurpose = searchParams.get("purpose") || "";
  // Folded through canonicalDistrict so an inbound ?district=hodan matches the
  // stored "Hodan". The filter at the bottom of this component compares
  // district names with ===, so a lowercase or oddly-cased value from a shared
  // link, an old bookmark or a scraper filtered out EVERY property and rendered
  // an empty page. canonicalDistrict was already here doing exactly this fold
  // for the canonical URL; it just never reached the filter input.
  //
  // An unrecognised name falls back to "" (show everything) rather than to
  // itself. `seoForFilters` already marks an unknown district noindex, so the
  // visitor gets results instead of a dead page and Google is not offered it.
  const districtParam =
    facet?.district ??
    (canonicalDistrict(searchParams.get("district") || searchParams.get("location") || "") ?? "");
  const minPriceParam = searchParams.get("minPrice") || "";
  const maxPriceParam = searchParams.get("maxPrice") || "";
  const queryParam = searchParams.get("q") || "";

  const [searchQuery, setSearchQuery] = useState(queryParam);
  const [district, setDistrict] = useState(districtParam);
  const [minPrice, setMinPrice] = useState(minPriceParam);
  const [maxPrice, setMaxPrice] = useState(maxPriceParam);
  const [bedrooms, setBedrooms] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("newest");
  const [showFilters, setShowFilters] = useState(false);

  // Re-seed the URL-backed filters whenever the query string changes under us.
  // `useState` only reads its initial value on mount, and this page does not
  // remount when you navigate from one /properties URL to another — so going
  // from ?district=Waberi to ?type=villa kept filtering by Waberi while the URL
  // claimed otherwise, and the results silently disagreed with the address bar.
  useEffect(() => {
    setSearchQuery(queryParam);
    setDistrict(districtParam);
    setMinPrice(minPriceParam);
    setMaxPrice(maxPriceParam);
  }, [queryParam, districtParam, minPriceParam, maxPriceParam]);

  /**
   * Apply a filter change that the facet PATH also encodes.
   *
   * On `/properties/2-bedroom-apartments-in-mogadishu` the slug decides what
   * renders — `activeType` and `districtParam` read the facet first. So a
   * control that only wrote to the query string changed the address bar and
   * nothing else: clicking "Hotels" produced
   * `/properties/2-bedroom-apartments-in-mogadishu?type=hotel`, still showing
   * apartments. Changing type or district means you have LEFT this facet, so
   * the path has to change with it.
   *
   * Where a facet exists for the new combination we go to it rather than to the
   * query-string form — that is the URL we want indexed, and it keeps the user
   * on the same kind of page they were already on. The bedroom count carries
   * over when the destination supports one (2-bed apartments → 2-bed villas)
   * and is dropped when it does not (→ hotel rooms, which have no bedroom
   * facets), because a slug that does not exist would 404.
   */
  const applyFacetFilters = (next: URLSearchParams) => {
    if (!facet) {
      setSearchParams(next);
      return;
    }
    const nextType = next.get("type") || null;
    const nextDistrict = canonicalDistrict(next.get("district") || "");
    const twin =
      facetSlugFor({ type: nextType, district: nextDistrict, bedrooms: facet.bedrooms }) ??
      facetSlugFor({ type: nextType, district: nextDistrict });

    if (twin) {
      // Those two live in the path now; leaving them in the query as well would
      // be the same value stated twice, in two places that can disagree.
      next.delete("type");
      next.delete("district");
    }
    const qs = next.toString();
    navigate(`/properties${twin ? `/${twin}` : ""}${qs ? `?${qs}` : ""}`);
  };

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const activeFilterCount = [district, minPrice, maxPrice, bedrooms].filter(Boolean).length + amenities.length;

  const clearFilters = () => {
    setDistrict("");
    setMinPrice("");
    setMaxPrice("");
    setBedrooms("");
    setAmenities([]);
    setSearchQuery("");
    setSortBy("newest");
  };

  const { data: dbProperties, isLoading } = useQuery({
    queryKey: ["properties", activeType],
    queryFn: async () => {
      // `is_available` is the ONLY visibility gate.
      //
      // It used to be checked alongside is_listed and occupancy_status here,
      // which re-implemented the rule client-side and got it wrong for nightly
      // units: a hotel room or BnB marked occupied vanished from search even
      // though it is still bookable for every later date. 20260820000001
      // derives is_available in a database trigger, per type (nightly =
      // listed; monthly = listed AND vacant), so one condition here is both
      // correct and impossible to drift from.
      let query = supabase
        .from("properties")
        .select("*, property_images(image_url, sort_order)")
        .eq("is_available", true)
        .order("created_at", { ascending: false });

      if (activeType) {
        // activeType comes from a URL query param; cast to the database enum
        // so the generated column types are satisfied.
        query = query.eq("type", activeType as "villa" | "apartment" | "hotel" | "bnb" | "commercial");
      }

      // ?purpose=rent or ?purpose=sell — for-sale listings filter
      if (activePurpose) {
        query = query.eq("purpose", activePurpose as "rent" | "sell");
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as RawPropertyRecord[]) || [];
    },
  });

  // Client-side filtering for the facets the query doesn't cover.
  const propertiesOnlyIds = (dbProperties || []).map((property) => property.id);
  const properties: Property[] = (dbProperties || [])
    .filter((p) => {
      // No occupancy re-check here — see the query above. A nightly unit that
      // is booked tonight still belongs in the results; the card says "Booked
      // till <date>" instead of the listing disappearing.
      // One predicate for type + district + EXACT bedroom count, shared with
      // the sitemap's threshold count, so a page can never be published on a
      // number it does not actually render. Note "exact": the bedrooms control
      // below is a minimum ("3+"), which is the right filter for a shopper and
      // the wrong one for a page titled "3 Bedroom Apartments".
      if (facet && !facetMatches(facet, p)) return false;
      if (searchQuery && !p.title.toLowerCase().includes(searchQuery.toLowerCase()) && !p.location.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (district && district !== "all" && p.location !== district) return false;
      if (minPrice && p.price < Number(minPrice)) return false;
      if (maxPrice && p.price > Number(maxPrice)) return false;
      if (bedrooms && bedrooms !== "any" && (p.bedrooms || 0) < Number(bedrooms)) return false;
      if (amenities.includes("parking") && !p.has_parking) return false;
      if (amenities.includes("cctv") && !p.has_cctv) return false;
      if (amenities.includes("balcony") && !p.has_balcony) return false;
      if (amenities.includes("furnished") && !p.is_furnished) return false;
      if (amenities.includes("daily_rate") && !p.is_daily_rate) return false;
      if (amenities.includes("air_conditioning") && !p.has_air_conditioning) return false;
      if (amenities.includes("refrigerator") && !p.has_refrigerator) return false;
      if (amenities.includes("room_service") && !p.has_room_service) return false;
      return true;
    })
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      type: p.type as PropertyType,
      price: p.price,
      deposit: p.deposit,
      location: p.location,
      images: (p.property_images || [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((img) => img.image_url),
      owner_id: p.owner_id || "",
      org_id: p.org_id,
      created_at: p.created_at,
      is_available: p.is_available ?? true,
      is_daily_rate: p.is_daily_rate,
      purpose: p.purpose as "rent" | "sell" | undefined,
      bedrooms: p.bedrooms,
      living_rooms: p.living_rooms,
      kitchens: p.kitchens,
      toilets: p.toilets,
      has_cctv: p.has_cctv,
      has_parking: p.has_parking,
      floor_number: p.floor_number,
      has_balcony: p.has_balcony,
      is_furnished: p.is_furnished,
    }))
    .sort((a: Property, b: Property) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // One RPC for every nightly unit on the page, not one per card. The mapping
  // above rewrites only villa→house, so "hotel"/"bnb" survive it intact and
  // `isBookableType` inside the hook still recognises them.
  const { data: hotelDirectoryRows } = useQuery({
    queryKey: ["hotel-directory-links", activeType, propertiesOnlyIds.join(",")],
    enabled: activeType === "hotel" && propertiesOnlyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await looseFrom("hotel_rooms")
        .select("property_id, hotel_id, hotels!hotel_id(id, slug, name, tagline, logo_url, hero_image_url, address)")
        .in("property_id", propertiesOnlyIds)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{
        property_id: string;
        hotel_id: string;
        hotels: {
          id: string;
          slug: string;
          name: string;
          tagline: string | null;
          logo_url: string | null;
          hero_image_url: string | null;
          address: string | null;
        } | null;
      }>;
    },
  });

  const shuffle = <T,>(arr: T[]): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const hotelDirectory = activeType === "hotel" ? (() => {
    const map = new Map<string, {
      id: string;
      slug: string;
      name: string;
      tagline: string | null;
      logoUrl: string | null;
      heroImageUrl: string | null;
      address: string | null;
      rooms: Property[];
    }>();

    for (const row of hotelDirectoryRows ?? []) {
      const hotel = row.hotels;
      if (!hotel) continue;
      const room = properties.find((candidate) => candidate.id === row.property_id);
      if (!room) continue;

      const current = map.get(hotel.id) ?? {
        id: hotel.id,
        slug: hotel.slug,
        name: hotel.name,
        tagline: hotel.tagline,
        logoUrl: hotel.logo_url,
        heroImageUrl: hotel.hero_image_url,
        address: hotel.address,
        rooms: [],
      };

      current.rooms.push(room);
      map.set(hotel.id, current);
    }

    return Array.from(map.values()).map((hotel) => ({
      ...hotel,
      rooms: [...hotel.rooms],
    }));
  })() : [];

  const randomizedHotelDirectory = useMemo(() => {
    if (activeType !== "hotel") return [];
    return shuffle(hotelDirectory);
  }, [activeType, hotelDirectory]);

  const randomizedHotelRooms = useMemo(() => {
    if (activeType !== "hotel") return [];
    return shuffle(hotelDirectory.flatMap((hotel) => hotel.rooms));
  }, [activeType, hotelDirectory]);

  const { data: bookedRanges } = useRoomBookedRanges(properties);
  const bookedUntilFor = (id: string) => bookedUntil(bookedRanges?.[id] ?? []);

  const queryParamSeo = seoForFilters({
    type: activeType,
    district: districtParam,
    query: queryParam,
    minPrice: minPriceParam,
    maxPrice: maxPriceParam,
  });

  // A facet page below the inventory threshold still renders — old links and
  // filter chips must not break — but it is not offered to the index. See the
  // doorway-page note in src/lib/facets.ts for why that line is not optional.
  //
  // Gated on `!isLoading` deliberately. `properties` is empty on first paint,
  // and emitting noindex during load would hand a crawler that snapshots early
  // a directive we did not mean. The sitemap applies the same threshold at
  // build time, so a genuinely thin page is not being advertised anyway.
  const facetTooThin = facet ? !isLoading && properties.length < FACET_MIN_LISTINGS : false;
  const seo = facet
    ? {
        title: buildTitle(facet.title),
        description: facet.description,
        canonical: absoluteUrl(`/properties/${facet.slug}`),
        noindex: facetTooThin,
      }
    : queryParamSeo;

  const facetJsonLd = facet
    ? [
        breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Properties", url: "/properties" },
          { name: facet.heading, url: `/properties/${facet.slug}` },
        ]),
        itemListLd(
          properties.map((property) => ({
            url: absoluteUrl(`/property/${property.id}`),
            name: property.title,
          })),
          facet.heading,
        ),
      ]
    : undefined;

  if (facetUnknown) return <NotFound />;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* Rendered immediately rather than gated on `isLoading`: unlike
          PropertyDetail, this route is always valid — an empty result set is a
          real, indexable category page, not a 404 — so there is no risk of
          publishing a canonical for a URL that does not exist. */}
      <Seo
        title={seo.title}
        description={seo.description}
        canonical={seo.canonical}
        noindex={seo.noindex}
        jsonLd={facetJsonLd}
      />
      <Header />

      <div className="container py-6">
        {/* Search bar */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by title or district..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12 rounded-full border-border bg-card shadow-card focus-visible:ring-primary"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters ? "default" : "outline"}
            size="icon"
            className="h-12 w-12 rounded-full shrink-0 relative shadow-card"
            onClick={() => setShowFilters(!showFilters)}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center ring-2 ring-background">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="p-4 mb-4 rounded-2xl bg-card border border-border shadow-card space-y-4">
                {/* District */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> District
                  </label>
                  <Select
                    value={district}
                    onValueChange={(value) => {
                      // Off a facet this is pure local state, as before. On one,
                      // the facet's own district would override it and the list
                      // would come back empty — so change the path instead.
                      if (!facet) {
                        setDistrict(value);
                        return;
                      }
                      const next = new URLSearchParams(searchParams);
                      if (value && value !== "all") next.set("district", value);
                      else next.delete("district");
                      applyFacetFilters(next);
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="All districts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All districts</SelectItem>
                      {MOGADISHU_DISTRICTS.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Price range */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Price range
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Min"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="number"
                      placeholder="Max"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="h-10 rounded-xl"
                    />
                  </div>
                </div>

                {/* Bedrooms */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Bed className="w-3.5 h-3.5" /> Min bedrooms
                  </label>
                  <Select value={bedrooms} onValueChange={setBedrooms}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}+</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Amenities */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Amenities</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "parking", label: "Parking", icon: Car },
                      { key: "cctv", label: "CCTV", icon: Cctv },
                      { key: "balcony", label: "Balcony", icon: Waves },
                      { key: "furnished", label: "Furnished", icon: Armchair },
                      { key: "daily_rate", label: "Daily Rate", icon: CalendarDays },
                      { key: "air_conditioning", label: "Air Conditioning", icon: Snowflake },
                      { key: "refrigerator", label: "Refrigerator", icon: Refrigerator },
                      { key: "room_service", label: "Room Service", icon: ConciergeBell },
                    ].map((a) => (
                      <button
                        key={a.key}
                        onClick={() => toggleAmenity(a.key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                          amenities.includes(a.key)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                        }`}
                      >
                        <a.icon className="w-3.5 h-3.5" /> {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <ArrowUpDown className="w-3.5 h-3.5" /> Sort by
                  </label>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="price_asc">Price: Low to High</SelectItem>
                      <SelectItem value="price_desc">Price: High to Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Clear button */}
                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs w-full" onClick={clearFilters}>
                    <X className="w-3.5 h-3.5" /> Clear all filters
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Purpose pills — For Rent / For Sale toggle */}
        <div className="flex gap-2 pb-2">
          <button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("purpose");
              setSearchParams(next);
            }}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
              !activePurpose
                ? "bg-accent text-accent-foreground border-accent"
                : "bg-card text-muted-foreground border-border hover:border-accent/40 hover:text-foreground"
            }`}
          >
            All
          </button>
          {[
            { value: "rent", label: "For Rent", icon: Home },
            { value: "sell", label: "For Sale", icon: DollarSign },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                if (activePurpose === f.value) next.delete("purpose");
                else next.set("purpose", f.value);
                setSearchParams(next);
              }}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
                activePurpose === f.value
                  ? "bg-accent text-accent-foreground border-accent"
                  : "bg-card text-muted-foreground border-border hover:border-accent/40 hover:text-foreground"
              }`}
            >
              <f.icon className="w-3.5 h-3.5" />
              {f.label}
            </button>
          ))}
        </div>

        {/* Type pills */}
        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => {
                // Edit the existing query string rather than replacing it —
                // `setSearchParams({ type })` dropped district/price from the
                // URL while they stayed active in state, so the address bar and
                // the results parted ways.
                const next = new URLSearchParams(searchParams);
                if (f.value) next.set("type", f.value);
                else next.delete("type");
                applyFacetFilters(next);
              }}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold border transition-colors ${
                activeType === f.value
                  ? "bg-primary text-primary-foreground border-primary shadow-card"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <f.icon className="w-4 h-4" />
              {f.label}
            </button>
          ))}
        </div>

        {/* Results header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl md:text-2xl font-heading font-extrabold text-foreground tracking-tight">
              {/* On a facet page the heading IS the page's subject and has to
                  match its <title> — "3 Bedroom Apartments for Rent in Hodan,
                  Mogadishu". Off a facet, read the label off typeFilters rather
                  than capitalising the raw value: the database enum is "villa",
                  so the old version titled the Villas page "Villas" via a path
                  that also produced "Commercials". */}
              {facet
                ? facet.heading
                : activeType
                  ? typeFilters.find((f) => f.value === activeType)?.label ?? "Properties"
                  : "All properties"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isLoading ? "Loading…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} found`}
            </p>
            {/* Real copy, not filler. A category page whose only text is its own
                heading and a grid of cards has nothing to rank ON — and the
                intro is written per-facet so the set does not read as one
                template stamped out 120 times. */}
            {facet && (
              <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">
                {facet.intro}
              </p>
            )}
          </div>
          {(searchQuery || activeFilterCount > 0) && (
            <div className="flex flex-wrap gap-1">
              {searchQuery && (
                <Badge variant="secondary" className="text-[10px] rounded-full font-medium">
                  "{searchQuery}"
                </Badge>
              )}
              {district && (
                <Badge variant="secondary" className="text-[10px] rounded-full font-medium">
                  {district}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-x-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="aspect-square sm:aspect-[4/3.4] w-full rounded-2xl" />
                <div className="pt-3 space-y-2">
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-1/2 rounded-md" />
                  <Skeleton className="h-4 w-1/3 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        {!isLoading && activeType === "hotel" && hotelDirectory.length > 0 ? (
          <div className="space-y-6">
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max gap-3">
                {randomizedHotelDirectory.map((hotel) => (
                  <Link
                    key={hotel.id}
                    to={`/hotels/${hotel.slug}`}
                    className="group block min-w-[220px] max-w-[220px] overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-colors hover:border-primary/50"
                  >
                    <div className="relative">
                      <img
                        src={hotel.heroImageUrl || hotel.logoUrl || "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80"}
                        alt={hotel.name}
                        className="h-36 w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                      {hotel.logoUrl && (
                        <img
                          src={hotel.logoUrl}
                          alt=""
                          className="absolute bottom-3 left-3 h-10 w-10 rounded-xl border border-white/30 object-cover bg-background"
                        />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="truncate font-heading text-base font-bold text-foreground group-hover:text-primary transition-colors">
                        {hotel.name}
                      </p>
                      {hotel.tagline && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hotel.tagline}</p>
                      )}
                      {hotel.address && (
                        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          <span className="truncate">{hotel.address}</span>
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {randomizedHotelRooms.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-heading text-lg font-bold text-foreground">Rooms</h2>
                  <span className="text-xs font-medium text-muted-foreground">
                    {randomizedHotelRooms.length} room{randomizedHotelRooms.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-x-6">
                  {randomizedHotelRooms.map((property, i) => (
                    <motion.div
                      key={property.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.5) }}
                    >
                      <PropertyCard
                        property={property}
                        isFavorite={isFavorite(property.id)}
                        onToggleFavorite={toggleFavorite}
                        isAuthenticated={isAuthenticated}
                        bookedUntil={bookedUntilFor(property.id)}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : !isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-x-6">
            {properties.map((property, i) => (
              <motion.div
                key={property.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.05, 0.5) }}
              >
                <PropertyCard
                  property={property}
                  isFavorite={isFavorite(property.id)}
                  onToggleFavorite={toggleFavorite}
                  isAuthenticated={isAuthenticated}
                  bookedUntil={bookedUntilFor(property.id)}
                />
              </motion.div>
            ))}
          </div>
        ) : null}

        {!isLoading && properties.length === 0 && (
          <div className="text-center py-20 bg-card rounded-3xl border border-border shadow-card mt-8">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-heading font-bold text-lg mb-2">No properties found</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              We couldn't find any vacant properties matching your current filters. Try adjusting your search criteria.
            </p>
            <Button variant="outline" className="rounded-full" onClick={clearFilters}>
              Clear all filters
            </Button>
          </div>
        )}

        {/* Related searches.
            None of the facet pages appear in the nav, so this block plus the
            "More like this" strip on each listing is the ONLY path a crawler
            has between them. It is also how authority moves around the set —
            a link from a page that ranks is worth more to its neighbours than
            anything the sitemap can do, which merely announces that a URL
            exists. Rendered even while the results load, because the links do
            not depend on the result set. */}
        {facet && (
          <nav aria-label="Related searches" className="mt-10 pt-6 border-t border-border">
            <h2 className="text-sm font-heading font-bold text-foreground mb-3">
              Related searches
            </h2>
            <ul className="flex flex-wrap gap-2">
              {relatedFacets(facet).map((related) => (
                <li key={related.slug}>
                  <Link
                    to={`/properties/${related.slug}`}
                    className="inline-flex items-center rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                  >
                    {related.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Properties;
