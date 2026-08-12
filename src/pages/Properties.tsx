import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  Bed, DollarSign, Car, Cctv, Waves, ArrowUpDown, Armchair, CalendarDays,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import type { Property, PropertyType } from "@/lib/types";

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
  bedrooms?: number;
  living_rooms?: number;
  kitchens?: number;
  toilets?: number;
  has_cctv?: boolean;
  has_parking?: boolean;
  floor_number?: number;
  has_balcony?: boolean;
  is_furnished?: boolean;
  property_images?: Array<{ image_url: string; sort_order?: number }>;
}

const typeFilters = [
  { value: "", label: "All", icon: SlidersHorizontal },
  { value: "villa", label: "Houses", icon: Home },
  { value: "apartment", label: "Apartments", icon: Building2 },
  { value: "hotel", label: "Hotels", icon: Hotel },
  { value: "commercial", label: "Commercial", icon: Briefcase },
];

const Properties = () => {
  const { isFavorite, toggleFavorite, isAuthenticated } = useFavorites();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeType = searchParams.get("type") || "";
  const districtParam = searchParams.get("district") || searchParams.get("location") || "";
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
      // Query properties where is_listed = true AND occupancy_status = 'vacant'
      let query = supabase
        .from("properties")
        .select("*, property_images(image_url, sort_order)")
        .or("is_listed.eq.true,is_listed.is.null")
        .or("occupancy_status.eq.vacant,occupancy_status.is.null")
        .eq("is_available", true)
        .order("created_at", { ascending: false });

      if (activeType) {
        // activeType comes from a URL query param; cast to the database enum
        // so the generated column types are satisfied.
        query = query.eq("type", activeType as "villa" | "apartment" | "hotel" | "commercial");
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as RawPropertyRecord[]) || [];
    },
  });

  // Client-side filtering and strict enforcement of listed + vacant status
  const properties: Property[] = (dbProperties || [])
    .filter((p) => {
      // Hard requirement: only show properties where is_listed = true AND occupancy_status = 'vacant'
      const isListed = p.is_listed !== false;
      const isVacant = p.occupancy_status ? p.occupancy_status === "vacant" : p.is_available !== false;
      if (!isListed || !isVacant) return false;

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
      return true;
    })
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      type: (p.type === "villa" ? "house" : p.type) as PropertyType,
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

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
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
                setSearchParams(next);
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
              {/* Read the label off typeFilters rather than capitalising the
                  raw value: the database enum is "villa", so the old version
                  titled the Houses page "Villas" (and "Commercials"). */}
              {activeType
                ? typeFilters.find((f) => f.value === activeType)?.label ?? "Properties"
                : "All properties"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isLoading ? "Loading…" : `${properties.length} ${properties.length === 1 ? "property" : "properties"} found`}
            </p>
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
        {!isLoading && (
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
                />
              </motion.div>
            ))}
          </div>
        )}

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
      </div>

      <BottomNav />
    </div>
  );
};

export default Properties;
