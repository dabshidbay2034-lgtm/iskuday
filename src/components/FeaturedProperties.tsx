import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import PropertyCard from "./PropertyCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useFavorites } from "@/hooks/use-favorites";
import {
  ChevronLeft, ChevronRight, Search, SlidersHorizontal, MapPin, X,
  DollarSign, Bed, Car, Cctv, Waves, ArrowUpDown, Home, Building2, Hotel, Briefcase,
  Armchair, CalendarDays, Shuffle, BedDouble,
  Snowflake, Refrigerator, ConciergeBell,
} from "lucide-react";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import type { Property, PropertyType } from "@/lib/types";
import { useRoomBookedRanges, bookedUntil } from "@/hooks/use-room-availability";

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

const ITEMS_PER_PAGE = 20;

const typeFilters = [
  { value: "", label: "All", icon: SlidersHorizontal },
  { value: "villa", label: "Villas", icon: Home },
  { value: "apartment", label: "Apartments", icon: Building2 },
  { value: "hotel", label: "Hotels", icon: Hotel },
  { value: "bnb", label: "BnB", icon: BedDouble },
  { value: "commercial", label: "Commercial", icon: Briefcase },
];

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const FeaturedProperties = () => {
  const [page, setPage] = useState(0);
  const { isFavorite, toggleFavorite, isAuthenticated } = useFavorites();

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [activeType, setActiveType] = useState("");
  const [district, setDistrict] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("randomized");
  const [showFilters, setShowFilters] = useState(false);

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const activeFilterCount = [district, minPrice, maxPrice, bedrooms, activeType].filter(Boolean).length + amenities.length;

  const clearFilters = () => {
    setDistrict("");
    setMinPrice("");
    setMaxPrice("");
    setBedrooms("");
    setAmenities([]);
    setSearchQuery("");
    setActiveType("");
    setSortBy("randomized");
    setPage(0);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["featured-properties", page],
    queryFn: async () => {
      const from = page * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      // `is_available` is the ONLY visibility gate.
      //
      // It used to be checked alongside is_listed and occupancy_status here,
      // which re-implemented the rule client-side and got it wrong for nightly
      // units: a hotel room or BnB marked occupied vanished from the
      // marketplace even though it is still bookable for every later date.
      // 20260820000001 derives is_available in a database trigger, per type
      // (nightly = listed; monthly = listed AND vacant), so one condition here
      // is both correct and impossible to drift from.
      const { count } = await supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("is_available", true);

      const { data, error } = await supabase
        .from("properties")
        .select("*, property_images(image_url, sort_order)")
        .eq("is_available", true)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { items: (data as unknown as RawPropertyRecord[]) || [], total: count || 0 };
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / ITEMS_PER_PAGE);

  const rawProperties: Property[] = (data?.items || [])
    .filter((p) => {
      // No occupancy re-check here — see the query above. A nightly unit that
      // is booked tonight still belongs in the results; the card says "Booked
      // till <date>" instead of the listing disappearing.
      if (searchQuery && !p.title.toLowerCase().includes(searchQuery.toLowerCase()) && !p.location.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (activeType && p.type !== activeType) return false;
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
    }));;

  // Per plan §8 D3: Randomised ordering for the explore section
  const properties = useMemo(() => {
    if (sortBy === "price_asc") {
      return [...rawProperties].sort((a, b) => a.price - b.price);
    }
    if (sortBy === "price_desc") {
      return [...rawProperties].sort((a, b) => b.price - a.price);
    }
    if (sortBy === "newest") {
      return [...rawProperties].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }
    // Default "randomized": randomize explore ordering
    return shuffleArray(rawProperties);
  }, [rawProperties, sortBy]);

  // One RPC for every nightly unit on the page, not one per card. The mapping
  // above passes `type` through untouched now that villa is the only spelling,
  // so "hotel"/"bnb" reach `isBookableType` inside the hook intact.
  const { data: bookedRanges } = useRoomBookedRanges(properties);
  const bookedUntilFor = (id: string) => bookedUntil(bookedRanges?.[id] ?? []);

  if (!isLoading && (data?.items || []).length === 0 && page === 0) return null;

  return (
    <section className="py-12 md:py-20">
      <div className="container">
        <div className="flex items-center justify-between mb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">Explore Marketplace</span>
            <h2 className="text-2xl md:text-3xl font-heading font-extrabold text-foreground tracking-tight">
              Featured rentals
            </h2>
            <p className="text-muted-foreground text-sm mt-1">Discover vacant homes, apartments & hotel rooms in Mogadishu</p>
          </div>
        </div>

        {/* Search & Filter Bar */}
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

        {/* Expandable Filter Panel */}
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
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> District
                  </label>
                  <Select value={district} onValueChange={setDistrict}>
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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" /> Price range
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" placeholder="Min" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="h-10 rounded-xl" />
                    <Input type="number" placeholder="Max" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="h-10 rounded-xl" />
                  </div>
                </div>

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

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <ArrowUpDown className="w-3.5 h-3.5" /> Sort by
                  </label>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="randomized">Randomized Explore</SelectItem>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="price_asc">Price: Low to High</SelectItem>
                      <SelectItem value="price_desc">Price: High to Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {activeFilterCount > 0 && (
                  <Button variant="ghost" size="sm" className="text-xs w-full" onClick={clearFilters}>
                    <X className="w-3.5 h-3.5" /> Clear all filters
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Type pills */}
        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
          {typeFilters.map((f) => (
            <button
              key={f.value}
              onClick={() => { setActiveType(f.value); setPage(0); }}
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

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-muted-foreground text-sm">
            {isLoading ? "Loading…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} found`}
          </p>
          {(searchQuery || (district && district !== "all")) && (
            <div className="flex flex-wrap gap-1">
              {searchQuery && <Badge variant="secondary" className="text-[10px] rounded-full font-medium">"{searchQuery}"</Badge>}
              {district && district !== "all" && <Badge variant="secondary" className="text-[10px] rounded-full font-medium">{district}</Badge>}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 md:gap-x-6">
            {Array.from({ length: 8 }).map((_, i) => (
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
        ) : (
          <>
            {properties.length === 0 ? (
              <div className="text-center py-16 bg-card rounded-3xl border border-border shadow-card">
                <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-7 h-7 text-muted-foreground" />
                </div>
                <h3 className="font-heading font-bold text-lg mb-2">No properties found</h3>
                <p className="text-muted-foreground text-sm mb-4 max-w-sm mx-auto font-medium">
                  No vacant properties match your filter.
                </p>
                <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters}>Clear all filters</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 md:gap-x-6">
                {properties.map((property, i) => (
                  <motion.div
                    key={property.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
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
            )}

            {totalPages > 1 && properties.length > 0 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full shadow-card"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`min-w-[36px] h-9 px-3 rounded-full text-sm font-semibold transition-colors ${
                      page === i
                        ? "bg-primary text-primary-foreground shadow-card"
                        : "bg-card text-muted-foreground border border-border hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full shadow-card"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default FeaturedProperties;
