import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, MapPin, Home, SlidersHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";

/**
 * ⚠ REPLACE THIS WITH A REAL PHOTOGRAPH OF A MOGADISHU PROPERTY.
 *
 * This is a stock image of a Western living room and it is the most damaging
 * thing on the page. Everything else here can be argued about; a visitor who
 * knows Mogadishu can see in one second that whoever built this has never been
 * there, and nothing further down the page recovers that.
 *
 * It is also one of the most heavily reused images on Unsplash, so a fair
 * number of visitors have already seen it on some other product's homepage.
 *
 * Any real photo beats any stock photo here — one of your own listings, shot on
 * a phone, is better than the best stock library. Drop it in /public and point
 * this at it; the overlay below is tuned for a mid-bright image, so a very dark
 * or very light photo may want the `from-foreground/85` value adjusted.
 */
const heroBg = "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1920&q=85";

const PROPERTY_TYPES = [
  { value: "villa", label: "Villa" },
  { value: "apartment", label: "Apartment" },
  { value: "hotel", label: "Hotel" },
  { value: "bnb", label: "BnB" },
  { value: "commercial", label: "Commercial" },
];

const PRICE_RANGES = [
  { value: "0-300", label: "Under $300" },
  { value: "300-800", label: "$300 – $800" },
  { value: "800-2000", label: "$800 – $2,000" },
  { value: "2000-", label: "$2,000+" },
];

const HeroSection = () => {
  const navigate = useNavigate();
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedPrice, setSelectedPrice] = useState("");

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (selectedDistrict && selectedDistrict !== "all") params.set("district", selectedDistrict);
    if (selectedType && selectedType !== "all") params.set("type", selectedType);
    if (selectedPrice) {
      const [min, max] = selectedPrice.split("-");
      if (min) params.set("minPrice", min);
      if (max) params.set("maxPrice", max);
    }

    // What people search for is the clearest signal of demand we have —
    // especially districts and budgets that return nothing.
    track(ANALYTICS_EVENTS.PROPERTY_SEARCH_SUBMITTED, {
      district: selectedDistrict || null,
      type: selectedType || null,
      price_range: selectedPrice || null,
    });

    navigate(`/properties${params.toString() ? `?${params}` : ""}`);
  };

  return (
    <section className="relative min-h-[92vh] md:min-h-[78vh] flex items-end md:items-center overflow-hidden">
      {/* Background image with warm sunset overlay */}
      <div className="absolute inset-0">
        <img src={heroBg} alt="Sunlit modern home interior" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/35 to-foreground/10" />
        <div className="absolute inset-0 mix-blend-multiply opacity-40" style={{ background: "var(--gradient-hero)" }} />
      </div>

      <div className="container relative z-10 pb-24 md:pb-0 pt-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="max-w-xl"
        >
          {/* No "trusted by N renters" badge.
              It said 10,000+, which was invented — and a pulsing dot next to a
              number nobody can check is the single loudest tell that copy was
              written before the product had users. An empty space reads as
              confident; a fabricated number reads as a placeholder nobody
              removed. Put a real figure here when there is one. */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-heading font-extrabold text-white leading-[1.05] mb-4 tracking-tight">
            Find your next home
            <span className="text-white block">in Mogadishu</span>
          </h1>
          <p className="text-white/80 text-base md:text-lg mb-8 max-w-md">
            Villas, apartments and hotel rooms across all 18 districts. See real
            photos and prices, then deal with the owner directly.
          </p>

          {/* Airbnb-style segmented search pill */}
          <div className="bg-card rounded-[2rem] md:rounded-full p-2 shadow-elevated flex flex-col md:flex-row md:items-center gap-1.5">
            <div className="flex-1 flex flex-col md:flex-row md:items-stretch divide-y md:divide-y-0 md:divide-x divide-border/70">
              <div className="flex-1 px-4 py-2.5 md:rounded-l-full hover:bg-muted transition-colors rounded-2xl md:rounded-none">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-0.5">Where</p>
                {/* h-11, not h-7: these three are the site's primary conversion
                    control and a 28px target is well under the 44px minimum.
                    The "Where"/"Property type"/"Budget" captions above are <p>,
                    not <label>, so without aria-label a screen reader announces
                    three unnamed comboboxes. */}
                <Select value={selectedDistrict} onValueChange={setSelectedDistrict}>
                  <SelectTrigger aria-label="Where — district" className="h-11 border-0 bg-transparent shadow-none p-0 rounded-none [&>svg]:hidden">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                      <SelectValue placeholder="Search districts" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All districts</SelectItem>
                    {MOGADISHU_DISTRICTS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 px-4 py-2.5 hover:bg-muted transition-colors rounded-2xl md:rounded-none">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-0.5">Property type</p>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger aria-label="Property type" className="h-11 border-0 bg-transparent shadow-none p-0 rounded-none [&>svg]:hidden">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Home className="w-3.5 h-3.5 text-primary shrink-0" />
                      <SelectValue placeholder="Any type" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any type</SelectItem>
                    {PROPERTY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 px-4 py-2.5 hover:bg-muted transition-colors rounded-2xl md:rounded-r-full md:rounded-l-none">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground mb-0.5">Budget</p>
                <Select value={selectedPrice} onValueChange={setSelectedPrice}>
                  <SelectTrigger aria-label="Budget" className="h-11 border-0 bg-transparent shadow-none p-0 rounded-none [&>svg]:hidden">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-primary shrink-0" />
                      <SelectValue placeholder="Any budget" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_RANGES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              size="lg"
              onClick={handleSearch}
              className="rounded-full h-12 md:h-14 px-6 md:px-8 font-semibold shrink-0"
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
            </Button>
          </div>

          {/*
            What the platform actually does, not how big it claims to be.

            This replaced three invented figures — "2,000+ properties",
            "500+ verified owners", "4.8★ average rating" — on a platform with
            no reviews feature and no verification step behind the word
            "verified". Scale claims age badly and can't be defended; capability
            claims are true on day one and still true at ten thousand listings.
            Every line below is checkable against the product:
            MOGADISHU_DISTRICTS has 18 entries, listings carry the owner's own
            contact details, and the booking flow takes no payment.
          */}
          <dl className="flex flex-wrap gap-x-8 gap-y-4 mt-9">
            {[
              { term: "18 districts", detail: "Across all of Mogadishu" },
              { term: "Direct contact", detail: "Deal with the owner" },
              { term: "No booking fee", detail: "We take no cut" },
            ].map((item) => (
              <div key={item.term}>
                <dt className="text-base md:text-lg font-heading font-bold text-white">{item.term}</dt>
                <dd className="text-xs text-white/60 mt-0.5">{item.detail}</dd>
              </div>
            ))}
          </dl>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
