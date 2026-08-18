import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Seo from "@/components/Seo";
import { absoluteUrl, buildTitle } from "@/lib/seo";
import { breadcrumbLd, propertyListingLd } from "@/lib/structured-data";
import ImageGallery from "@/components/ImageGallery";
import { BookingRequestForm } from "@/components/BookingRequestForm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MapPin, Bed, Bath, Car, Cctv, Building2, Waves,
  Sofa, CookingPot, DollarSign, Shield, User, Phone, Mail, Calendar, Home, Hotel, MessageCircle, Armchair, CalendarClock,
  Wifi, Coffee, PlaneTakeoff, Briefcase, Users, Sparkles, ShieldCheck, CarFront, Utensils, Sun,
  UtensilsCrossed, Bus, Landmark, Clock, CheckCircle2, Wind, Shirt,
  Snowflake, Laptop, ConciergeBell, Refrigerator, Tv, MonitorPlay, ShowerHead, Vault,
  Phone as PhoneIcon, Crown, GlassWater, Droplets, SprayCan, ArrowUpDown,
} from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAppAuth } from "@/hooks/use-auth";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { PERMISSIONS } from "@/lib/permissions";
import { propertyTypeClass, propertyTypeLabel, purposeLabel, purposeClass } from "@/lib/property-display";
import { isBookableType, isNightlyRateType } from "@/lib/property-kind";
import { ALL_FACETS, facetMatches } from "@/lib/facets";
import { listingSeoDescription, listingSeoTitle, type ListingSeoInput } from "@/lib/listing-seo";
import { useRoomBookedRanges, bookedUntil, formatBookedUntil } from "@/hooks/use-room-availability";

type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (supabase as unknown as LooseClient).from(table);

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userId: currentUserId, appRole, can } = useAppAuth();
  const isAdmin = appRole === "admin";
  const isSemiAdmin = appRole === "semi_admin";

  // Delegate view counting to the Edge Function which handles:
  //  - owner self-count prevention
  //  - 24-hour rate limiting per viewer (user id or IP)
  useEffect(() => {
    if (id) {
      supabase.functions
        .invoke("increment-view", { body: { property_id: id } })
        .catch((err) => console.error("Error incrementing view:", err));
    }
  }, [id]);

  const { data: property, isLoading } = useQuery({
    queryKey: ["property", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: images } = useQuery({
    queryKey: ["property-images", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_images")
        .select("*")
        .eq("property_id", id!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const canSeePrivateViewStats = Boolean(
    property && currentUserId === property.owner_id,
  );

  const { data: owner } = useQuery({
    queryKey: ["property-owner", property?.owner_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        // Explicit columns, not "*". This is a PUBLIC page fetching another
        // user's profile row, so it must ask for the minimum it renders — if a
        // private column is ever added to profiles, "*" would start shipping it
        // to every anonymous visitor. See src/test/privacy-guards.test.ts.
        .select("full_name, avatar_url")
        .eq("user_id", property!.owner_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!property?.owner_id,
  });

  const { data: hotelProfile } = useQuery({
    queryKey: ["property-hotel-profile", property?.id],
    enabled: Boolean(property?.id),
    queryFn: async () => {
      const { data, error } = await looseFrom("hotel_rooms")
        .select("hotels!hotel_id(id, slug, name, tagline, logo_url, hero_image_url, address)")
        .eq("property_id", property!.id)
        .maybeSingle();
      if (error) throw error;
      const hotel = (data as { hotels?: {
        id: string;
        slug: string;
        name: string;
        tagline: string | null;
        logo_url: string | null;
        hero_image_url: string | null;
        address: string | null;
      } } | null)?.hotels ?? null;
      return hotel;
    },
  });

  // Must sit ABOVE the loading/not-found early returns below — a hook called
  // after a conditional `return` changes the hook order between renders. The
  // query self-disables when there is no nightly unit to ask about, so passing
  // an empty list while `property` loads costs nothing.
  const { data: bookedRanges } = useRoomBookedRanges(
    property ? [{ id: property.id, type: property.type }] : [],
  );

  // Separate from the increment-view effect above, which fires on the id alone:
  // this one waits for the row so the event carries the type/district/price that
  // make "what do people actually look at?" answerable. Keyed on property.id, not
  // the object, so a refetch doesn't re-count the same view.
  useEffect(() => {
    if (!property) return;
    track(ANALYTICS_EVENTS.PROPERTY_VIEWED, {
      property_id: property.id,
      type: property.type,
      location: property.location,
      price: property.price,
      is_daily_rate: property.is_daily_rate ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <Skeleton className="w-full aspect-[4/3] md:aspect-[2.5/1]" />
        <div className="container max-w-4xl py-6 space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        {/* Deleted, unlisted or bogus id. vercel.json returns HTTP 200 for it,
            so noindex is the only thing stopping every dead listing URL from
            being indexed as a live page. */}
        <Seo
          title={buildTitle("Property Not Found")}
          description="This listing is no longer available. Browse other verified houses, apartments and hotels for rent in Mogadishu."
          canonical={absoluteUrl(`/property/${encodeURIComponent(id ?? "")}`)}
          noindex
        />
        <Header />
        <div className="container py-20 text-center">
          <p className="text-muted-foreground text-lg mb-4">Property not found</p>
          <Button onClick={() => navigate("/properties")}>Browse Properties</Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const imageUrls = images?.map((img) => img.image_url) || [];
  // Two different questions that used to share one `isHotel` flag: how the
  // price reads, and whether a visitor can reserve it. A BnB answers both the
  // way a hotel room does — see src/lib/property-kind.ts.
  const isNightly = isNightlyRateType(property.type);
  const isBookable = isBookableType(property.type);
  /** The date a confirmed stay frees this room up, or null if free tonight. */
  const takenUntil = bookedUntil(bookedRanges?.[property.id] ?? []);

  // ── SEO ──────────────────────────────────────────────────────────────────
  // Everything below runs only after the query resolved AND returned a row, so
  // this page never emits a canonical for a URL that is really a 404 — a
  // canonical on a dead listing is an invitation to index it.
  // Built from the stored columns, not `property.title` — see src/lib/listing-seo.ts
  // for why the owner's free-typed title is the wrong thing to lead a <title>
  // with on a platform where it reads "3 bed room Appartment aad u qabow".
  const seoInput: ListingSeoInput = {
    title: property.title,
    description: property.description,
    type: property.type,
    location: property.location,
    price: property.price,
    bedrooms: property.bedrooms,
    toilets: property.toilets,
    kitchens: property.kitchens,
    livingRooms: property.living_rooms,
    isNightly,
    isForSale: property.purpose === "sell",
  };
  const seoTitle = buildTitle(listingSeoTitle(seoInput));
  const seoDescription = listingSeoDescription(seoInput);

  // The category pages this listing belongs to. Rendered as links at the foot
  // of the page: it is how a crawler reaches a facet page (none are in the nav)
  // and how a visitor who wants "more like this" gets there.
  const parentFacets = ALL_FACETS.filter((f) => facetMatches(f, property)).slice(0, 4);

  const amenities = [
    property.bedrooms != null && { icon: Bed, label: `${property.bedrooms} Bedroom${property.bedrooms > 1 ? "s" : ""}`, color: "bg-primary/10 text-primary" },
    property.toilets != null && { icon: Bath, label: `${property.toilets} Bathroom${property.toilets > 1 ? "s" : ""}`, color: "bg-accent/10 text-accent" },
    property.living_rooms != null && { icon: Sofa, label: `${property.living_rooms} Living Room${property.living_rooms > 1 ? "s" : ""}`, color: "bg-success/10 text-success" },
    property.kitchens != null && property.kitchens > 0 && { icon: CookingPot, label: `${property.kitchens} Kitchen${property.kitchens > 1 ? "s" : ""}`, color: "bg-warning/10 text-warning" },
    property.floor_number != null && { icon: Building2, label: `Floor ${property.floor_number}`, color: "bg-muted-foreground/10 text-muted-foreground" },
    property.has_balcony && { icon: Waves, label: "Balcony", color: "bg-info/10 text-info" },
    property.has_cctv && { icon: Cctv, label: "CCTV Security", color: "bg-destructive/10 text-destructive" },
    property.has_parking && { icon: Car, label: "Parking Available", color: "bg-success/10 text-success" },
    property.is_furnished && { icon: Armchair, label: "Furnished", color: "bg-primary/10 text-primary" },
    property.has_elevator && { icon: ArrowUpDown, label: "Elevator", color: "bg-primary/10 text-primary" },
    // Hotel amenities (20260902000002)
    property.has_free_wifi && { icon: Wifi, label: "Free WiFi", color: "bg-info/10 text-info" },
    property.has_coffee_shop && { icon: Coffee, label: "Coffee Shop", color: "bg-warning/10 text-warning" },
    property.has_airport_transport && { icon: PlaneTakeoff, label: "Airport Transportation", color: "bg-info/10 text-info" },
    property.has_business_center && { icon: Briefcase, label: "Business Center", color: "bg-hotel/10 text-hotel" },
    property.has_banquet_room && { icon: Users, label: "Banquet Room", color: "bg-primary/10 text-primary" },
    property.is_all_inclusive && { icon: Sparkles, label: "All Inclusive", color: "bg-accent/10 text-accent" },
    property.has_24h_security && { icon: ShieldCheck, label: "24-Hour Security", color: "bg-destructive/10 text-destructive" },
    property.has_secured_parking && { icon: CarFront, label: "Secured Parking", color: "bg-success/10 text-success" },
    property.has_restaurant && { icon: Utensils, label: "Restaurant", color: "bg-warning/10 text-warning" },
    property.has_breakfast && { icon: Sun, label: "Breakfast Available", color: "bg-accent/10 text-accent" },
    property.has_breakfast_buffet && { icon: UtensilsCrossed, label: "Breakfast Buffet", color: "bg-warning/10 text-warning" },
    property.has_shuttle && { icon: Bus, label: "Shuttle Bus Service", color: "bg-info/10 text-info" },
    property.has_car_hire && { icon: Car, label: "Car Hire", color: "bg-primary/10 text-primary" },
    property.has_meeting_rooms && { icon: Landmark, label: "Meeting Rooms", color: "bg-hotel/10 text-hotel" },
    property.has_24h_front_desk && { icon: Clock, label: "24-Hour Front Desk", color: "bg-success/10 text-success" },
    property.has_express_checkout && { icon: CheckCircle2, label: "Express Check-in/Out", color: "bg-info/10 text-info" },
    property.has_clothes_dryer && { icon: Wind, label: "Clothes Dryer", color: "bg-primary/10 text-primary" },
    property.has_laundry && { icon: Shirt, label: "Laundry Service", color: "bg-info/10 text-info" },
    // In-room features (20260902000003)
    property.has_air_conditioning && { icon: Snowflake, label: "Air Conditioning", color: "bg-info/10 text-info" },
    property.has_desk && { icon: Laptop, label: "Desk", color: "bg-primary/10 text-primary" },
    property.has_housekeeping && { icon: Sparkles, label: "Housekeeping", color: "bg-accent/10 text-accent" },
    property.has_room_service && { icon: ConciergeBell, label: "Room Service", color: "bg-warning/10 text-warning" },
    property.has_refrigerator && { icon: Refrigerator, label: "Refrigerator", color: "bg-success/10 text-success" },
    property.has_cable_tv && { icon: Tv, label: "Cable / Satellite TV", color: "bg-primary/10 text-primary" },
    property.has_flatscreen_tv && { icon: MonitorPlay, label: "Flatscreen TV", color: "bg-info/10 text-info" },
    property.has_bath_shower && { icon: ShowerHead, label: "Bath / Shower", color: "bg-accent/10 text-accent" },
    property.has_safe && { icon: Vault, label: "In-Room Safe", color: "bg-success/10 text-success" },
    property.has_telephone && { icon: PhoneIcon, label: "Telephone", color: "bg-muted-foreground/10 text-muted-foreground" },
    property.has_vip_facilities && { icon: Crown, label: "VIP Room Facilities", color: "bg-warning/10 text-warning" },
    property.has_bottled_water && { icon: GlassWater, label: "Bottled Water", color: "bg-info/10 text-info" },
    property.has_iron && { icon: Droplets, label: "Iron", color: "bg-primary/10 text-primary" },
    property.has_toiletries && { icon: SprayCan, label: "Complimentary Toiletries", color: "bg-accent/10 text-accent" },
  ].filter(Boolean) as { icon: React.ElementType; label: string; color: string }[];

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      {/* type="product" rather than "website": a listing with a price and
          availability is the closest thing this site has to a product page, and
          it is what the Offer structured data on this route describes. */}
      <Seo
        title={seoTitle}
        description={seoDescription}
        canonical={absoluteUrl(`/property/${property.id}`)}
        image={imageUrls[0]}
        type="product"
        // RealEstateListing + Offer is what lets Google match this page to
        // "3 bedroom apartment Hodan" rather than treating it as loose text.
        // Breadcrumbs give the district its own node in the trail, which is the
        // signal local search actually reads.
        jsonLd={[
          propertyListingLd({
            id: property.id,
            title: property.title,
            description: property.description,
            type: property.type,
            price: property.price,
            deposit: property.deposit,
            location: property.location,
            images: imageUrls,
            isAvailable: property.is_available,
            isDailyRate: property.is_daily_rate,
            bedrooms: property.bedrooms,
            toilets: property.toilets,
            livingRooms: property.living_rooms,
            kitchens: property.kitchens,
            floorNumber: property.floor_number,
            hasParking: property.has_parking,
            hasCctv: property.has_cctv,
            isFurnished: property.is_furnished,
            hasElevator: property.has_elevator,
            hasBalcony: property.has_balcony,
            hasFreeWifi: property.has_free_wifi,
            hasCoffeeShop: property.has_coffee_shop,
            hasAirportTransport: property.has_airport_transport,
            hasBusinessCenter: property.has_business_center,
            hasBanquetRoom: property.has_banquet_room,
            isAllInclusive: property.is_all_inclusive,
            has24hSecurity: property.has_24h_security,
            hasSecuredParking: property.has_secured_parking,
            hasRestaurant: property.has_restaurant,
            hasBreakfast: property.has_breakfast,
            hasBreakfastBuffet: property.has_breakfast_buffet,
            hasShuttle: property.has_shuttle,
            hasCarHire: property.has_car_hire,
            hasMeetingRooms: property.has_meeting_rooms,
            has24hFrontDesk: property.has_24h_front_desk,
            hasExpressCheckout: property.has_express_checkout,
            hasClothesDryer: property.has_clothes_dryer,
            hasLaundry: property.has_laundry,
            hasAirConditioning: property.has_air_conditioning,
            hasDesk: property.has_desk,
            hasHousekeeping: property.has_housekeeping,
            hasRoomService: property.has_room_service,
            hasRefrigerator: property.has_refrigerator,
            hasCableTv: property.has_cable_tv,
            hasFlatscreenTv: property.has_flatscreen_tv,
            hasBathShower: property.has_bath_shower,
            hasSafe: property.has_safe,
            hasTelephone: property.has_telephone,
            hasVipFacilities: property.has_vip_facilities,
            hasBottledWater: property.has_bottled_water,
            hasIron: property.has_iron,
            hasToiletries: property.has_toiletries,
            createdAt: property.created_at,
          }),
          breadcrumbLd([
            { name: "Home", url: absoluteUrl("/") },
            { name: "Properties", url: absoluteUrl("/properties") },
            ...(property.location
              ? [{
                  name: property.location,
                  url: absoluteUrl(`/properties?district=${encodeURIComponent(property.location)}`),
                }]
              : []),
            { name: property.title, url: absoluteUrl(`/property/${property.id}`) },
          ]),
        ]}
      />
      <Header />

      {/*
        The gallery is edge-to-edge on phones and CONSTRAINED from `md` up.

        It used to be full-bleed at every width, so on a desktop it ran the
        whole 1265px of the viewport at 506px tall while every other thing on
        the page — title, price, amenities, booking form — sat inside
        `max-w-4xl` (896px). The photo overhung the content by ~185px on each
        side, which read as a banner the page happened to start with rather than
        as this listing's photograph, and pushed the price and the booking form
        below the fold.

        Full-bleed stays on mobile on purpose: at 390px there are no margins to
        speak of, edge-to-edge is the convention every listing app uses, and the
        back button overlays it.
      */}
      <div className="relative md:container md:max-w-4xl md:mt-6">
        <button
          onClick={() => navigate(-1)}
          className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center shadow-elevated md:hidden"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <ImageGallery images={imageUrls} title={property.title} />
      </div>

      <div className="container max-w-4xl py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main content */}
          <div className="md:col-span-2 space-y-6">
            {/* Title + badge */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={`${propertyTypeClass(property.type)} text-[10px] uppercase tracking-wider font-semibold rounded-full px-2.5`}>
                  {property.type === "hotel" ? <Hotel className="w-3 h-3 mr-1" /> : <Home className="w-3 h-3 mr-1" />}
                  {propertyTypeLabel(property.type)}
                </Badge>
                {property.purpose === "sell" && (
                  <Badge className={`${purposeClass(property.purpose)} text-[10px] font-bold rounded-full px-2.5`}>
                    For Sale
                  </Badge>
                )}
                {property.is_available ? (
                  <Badge className="bg-success/10 text-success border-success/20 text-[10px] rounded-full">Available</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] rounded-full">Taken</Badge>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground mb-2">
                {property.title}
              </h1>
              <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
                <MapPin className="w-4 h-4" /> {property.location}
              </p>
            </div>

            {/* Pricing card */}
            <div className="flex items-center gap-6 p-5 rounded-2xl bg-card border border-border shadow-card">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  {property.purpose === "sell" ? "Sale Price" : isNightly ? "Nightly Rate" : "Monthly Rent"}
                </p>
                <p className="text-3xl font-heading font-bold text-foreground">
                  <span className="text-primary">${property.price.toLocaleString()}</span>
                  <span className="text-base font-normal text-muted-foreground">/{property.purpose === "sell" ? "one-time" : isNightly ? "night" : "mo"}</span>
                </p>
              </div>
              <div className="h-12 w-px bg-border" />
              {property.purpose !== "sell" && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Deposit
                </p>
                <p className="text-xl font-heading font-bold text-foreground">
                  ${property.deposit.toLocaleString()}
                </p>
              </div>
            )}
            </div>

            {/* Description */}
            {property.description && (
              <div>
                <h2 className="font-heading font-semibold text-foreground mb-2">About this property</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{property.description}</p>
              </div>
            )}

            {hotelProfile && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  Hotel profile
                </p>
                <div className="flex items-start gap-3">
                  {(hotelProfile.hero_image_url || hotelProfile.logo_url) ? (
                    <img
                      src={hotelProfile.hero_image_url || hotelProfile.logo_url!}
                      alt={hotelProfile.name}
                      className="h-16 w-16 rounded-2xl object-cover border border-border bg-muted"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted text-lg font-semibold text-foreground">
                      {hotelProfile.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link to={`/hotels/${hotelProfile.slug}`} className="font-heading text-lg font-semibold text-foreground hover:text-primary transition-colors">
                      {hotelProfile.name}
                    </Link>
                    {hotelProfile.tagline && (
                      <p className="mt-1 text-sm text-muted-foreground">{hotelProfile.tagline}</p>
                    )}
                    {hotelProfile.address && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        {hotelProfile.address}
                      </p>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline" className="mt-4 w-full">
                  <Link to={`/hotels/${hotelProfile.slug}`}>View hotel profile</Link>
                </Button>
              </div>
            )}

            {/* Amenities grid */}
            <div>
              <h2 className="font-heading font-semibold text-foreground mb-4">Amenities & Details</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {amenities.map((amenity, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-3.5 rounded-xl bg-card border border-border/50 hover:border-accent/30 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl ${amenity.color} flex items-center justify-center shrink-0`}>
                        <amenity.icon className="w-[18px] h-[18px]" />
                      </div>
                      <span className="text-sm text-foreground font-medium">{amenity.label}</span>
                    </div>
                ))}
              </div>
              {amenities.length === 0 && (
                <p className="text-muted-foreground text-sm">No amenity details provided.</p>
              )}
            </div>

            {/* Posted date; view totals stay private to owners/managers only */}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-6 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" />
                Listed {new Date(property.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </div>
              {canSeePrivateViewStats && (
                <div className="text-right">
                  <span className="font-medium text-foreground">{property.views || 0}</span>
                  <span className="ml-1">private views</span>
                </div>
              )}
            </div>

            {/* The category pages this listing sits in. Two jobs, one block:
                a visitor who wants more like this gets there in one click, and
                a crawler discovers the facet pages at all — nothing in the nav
                links to them, so without this they are reachable only from the
                sitemap. */}
            {parentFacets.length > 0 && (
              <nav aria-label="Related searches" className="mt-6 pt-4 border-t border-border/50">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  More like this
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {parentFacets.map((facet) => (
                    <li key={facet.slug}>
                      <Link
                        to={`/properties/${facet.slug}`}
                        className="inline-flex items-center rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                      >
                        {facet.heading}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>

                    {/* Sidebar */}
          <div className="space-y-6">
            {/* Taken tonight — but the form stays, because the guest can still
                book from the day it frees up. Hiding the form here would be the
                same mistake as dropping the listing from search. */}
            {isBookable && takenUntil && (
              <div className="p-4 rounded-2xl bg-muted/50 border border-border flex items-start gap-2.5">
                <CalendarClock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  Booked until{" "}
                  <span className="font-semibold">{formatBookedUntil(takenUntil)}</span>.
                  <span className="text-muted-foreground"> You can book from that date onwards.</span>
                </p>
              </div>
            )}

            {/* Public booking request — only nightly-rate units are bookable,
                and only while the unit is available. Uses the secure
                create_booking_request RPC so a visitor never touches org_id or
                an amount (20260807000001). */}
            {isBookable && property.is_available && (
              <BookingRequestForm
                roomId={property.id}
                roomTitle={property.title}
                nightlyRate={property.price ?? 0}
              />
            )}

            {/* Owner card - Hidden as requested */}
            {/* <div className="p-5 rounded-2xl bg-card border border-border shadow-card space-y-4">
              <h3 className="font-heading font-bold text-foreground text-lg">Listed by</h3>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                  {owner?.avatar_url ? (
                    <img src={owner.avatar_url} alt={owner.full_name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="font-heading font-semibold text-foreground text-sm">
                    {owner?.full_name || "Property Owner"}
                  </p>
                  NOTE: never render an owner's phone number here. Requirement R4
                  and decision D2 say renters reach an owner through the inquiry
                  / "Contact Us on WhatsApp" flow below and never see a number;
                  numbers live in profile_contacts, which is readable only by
                  their owner or a platform admin.
                </div>
              </div>
            </div> */}
          </div>
        </div>

        {/* WhatsApp Contact Button */}
        <div className="mt-8 mb-4">
          <a
            href={`https://wa.me/252612679357?text=${encodeURIComponent(
              `Hi, I'm interested in this property on MogadishuRents:\n\n` +
              `🏠 *${property.title}*\n` +
              `📍 Location: ${property.location}\n` +
              `🏷️ Type: ${propertyTypeLabel(property.type)}\n` +
              `💰 Price: $${property.price.toLocaleString()}/${property.purpose === "sell" ? "one-time" : property.type === 'hotel' ? 'night' : 'mo'}\n` +
              `💵 Deposit: $${property.deposit.toLocaleString()}\n` +
              (property.bedrooms ? `🛏️ Bedrooms: ${property.bedrooms}\n` : '') +
              (property.toilets ? `🚿 Bathrooms: ${property.toilets}\n` : '') +
              `\n🔗 ${window.location.href}\n\nI'd like to know more about this property.`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full"
            onClick={() =>
              track(ANALYTICS_EVENTS.PROPERTY_CONTACT_CLICKED, {
                property_id: property.id,
                type: property.type,
                location: property.location,
                price: property.price,
              })
            }
          >
            <Button className="w-full bg-[#25D366] hover:bg-[#1da851] text-white font-semibold text-base py-6 rounded-2xl shadow-lg flex items-center justify-center gap-3">
              <MessageCircle className="w-5 h-5" />
              Contact Us on WhatsApp
            </Button>
          </a>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default PropertyDetail;
