import { useState, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import PhotoUploader from "@/components/PhotoUploader";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import {
  ArrowLeft, ArrowRight, Home, Building2, Hotel, Briefcase, BedDouble,
  Bed, Sofa, CookingPot, Bath, Cctv, Car, Layers, Waves,
  MapPin, DollarSign, FileText, Image as ImageIcon, Check, AlertCircle, Armchair,
  Lock, Globe, UserRound, Laptop,
  Wifi, Coffee, PlaneTakeoff, Users, ShieldCheck, CarFront, Utensils, Sun,
  UtensilsCrossed, Bus, Landmark, Clock, CheckCircle2, Wind, Shirt, Sparkles,
  Snowflake, ConciergeBell, Refrigerator, Tv, MonitorPlay, ShowerHead, Vault,
  Phone, Crown, GlassWater, Droplets, SprayCan,
} from "lucide-react";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import { motion, AnimatePresence } from "framer-motion";
import { useAppAuth } from "@/hooks/use-auth";
import {
  accountKind, allowedPropertyTypes, canCreatePropertyType, wrongAccountTypeMessage,
} from "@/lib/account-type";
import type { UserRole, ListingPurpose } from "@/lib/types";
import { useSavePropertyNotes } from "@/hooks/use-property-notes";
import { useAttachHotelRoom, useMyHotels } from "@/hooks/use-hotels";
import { isNightlyRateType } from "@/lib/property-kind";

type PropertyType = "villa" | "apartment" | "hotel" | "bnb" | "commercial";
type OccupancyStatus = "vacant" | "occupied";

const steps = ["Type", "Details", "Amenities", "Photos", "Review"];

/**
 * Room counts are required for every unit (R2) — an owner should be able to
 * register a unit fully in one pass, and the management side needs these to
 * describe what's actually being let. Ranges are deliberately generous; the
 * point is to reject nonsense, not to police unusual buildings.
 */
const ROOM_FIELDS = [
  { key: "bedrooms",     label: "Bedrooms",           icon: Bed,        min: 1, max: 20, options: [1,2,3,4,5,6,7,8,9,10] },
  { key: "toilets",      label: "Toilets/Bathrooms",  icon: Bath,       min: 1, max: 20, options: [1,2,3,4,5,6,7,8] },
  { key: "living_rooms", label: "Living Rooms",       icon: Sofa,       min: 0, max: 10, options: [0,1,2,3,4,5] },
  { key: "kitchens",     label: "Kitchens",           icon: CookingPot, min: 0, max: 10, options: [0,1,2,3,4] },
] as const;

type RoomKey = (typeof ROOM_FIELDS)[number]["key"];

const AddProperty = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  const { isSignedIn, userId, user, appRole, orgId } = useAppAuth();
  const savePropertyNotes = useSavePropertyNotes();

  const allowedTypes = allowedPropertyTypes(appRole as UserRole);

  /**
   * ── A HOTEL ADDS ROOMS, NOT PROPERTIES ────────────────────────────────────
   *
   * For a hotel account this wizard is a different thing wearing the same
   * clothes. A letting agency registers scattered units, each with its own
   * district. A hotel is ONE building: the type is always "hotel", and the
   * district is a fact about the building, not a question about the room.
   *
   * So for a hotel account the flow:
   *   • skips the type step (it had exactly one answer),
   *   • takes the district from the hotel instead of asking,
   *   • and says "room" everywhere it used to say "property".
   *
   * Everything below derives from `isHotelAccount`; nothing changes for
   * agencies or solo landlords.
   */
  const isHotelAccount = accountKind(appRole as UserRole) === "hotel";
  const { data: myHotels, isPending: hotelsPending } = useMyHotels();
  const attachRoom = useAttachHotelRoom();

  /** Which hotel this room is being filed under. Auto-picked when there's one. */
  const [hotelId, setHotelId] = useState<string>("");
  const hotels = myHotels ?? [];
  const hotel = hotels.find((h) => h.id === hotelId) ?? null;

  useEffect(() => {
    if (!isHotelAccount || hotelId) return;
    if (hotels.length >= 1) setHotelId(hotels[0].id);
  }, [isHotelAccount, hotelId, hotels]);

  /** The word this account uses for the thing being created. */
  const noun = isHotelAccount ? "room" : "property";
  const Noun = isHotelAccount ? "Room" : "Property";

  /**
   * A hotel account starts on Details — the type step is skipped entirely
   * rather than shown with a single card. Step INDICES are unchanged so every
   * `step === n` branch below still means what it says; only the entry point
   * and the progress display move.
   */
  const firstStep = isHotelAccount ? 1 : 0;
  const visibleSteps = steps.slice(firstStep);
  useEffect(() => {
    if (isHotelAccount && step === 0) setStep(1);
  }, [isHotelAccount, step]);

  useEffect(() => {
    if (!isSignedIn) {
      navigate("/signin");
      return;
    }

    if (!["owner", "agent", "hotel_manager"].includes(appRole)) {
      navigate("/dashboard");
      return;
    }
    setCheckingAccess(false);
  }, [isSignedIn, appRole, navigate]);

  const [photos, setPhotos] = useState<File[]>([]);

  // Form state
  const [form, setForm] = useState({
    type: "" as PropertyType | "",
    title: "",
    description: "",
    location: "",
    price: "",
    deposit: "",
    purpose: "rent" as ListingPurpose,
    // Room counts start empty so the owner has to answer them — they're
    // required now (R2) rather than silently defaulted to 1.
    bedrooms: "",
    living_rooms: "",
    kitchens: "",
    toilets: "",
    // Occupancy and listing are two different things (plan §2 R-3): an
    // occupied unit stays in the owner's ledger while leaving the marketplace.
    occupancy_status: "vacant" as OccupancyStatus,
    is_listed: true,
    private_notes: "",
    has_cctv: false,
    has_parking: false,
    floor_number: "1",
    has_balcony: false,
    is_furnished: false,
    has_elevator: false,
    // Hotel amenities (20260902000002)
    has_free_wifi: false,
    has_coffee_shop: false,
    has_airport_transport: false,
    has_business_center: false,
    has_banquet_room: false,
    is_all_inclusive: false,
    has_24h_security: false,
    has_secured_parking: false,
    has_restaurant: false,
    has_breakfast: false,
    has_breakfast_buffet: false,
    has_shuttle: false,
    has_car_hire: false,
    has_meeting_rooms: false,
    has_24h_front_desk: false,
    has_express_checkout: false,
    has_clothes_dryer: false,
    has_laundry: false,
    // In-room features (20260902000003)
    has_air_conditioning: false,
    has_desk: false,
    has_housekeeping: false,
    has_room_service: false,
    has_refrigerator: false,
    has_cable_tv: false,
    has_flatscreen_tv: false,
    has_bath_shower: false,
    has_safe: false,
    has_telephone: false,
    has_vip_facilities: false,
    has_bottled_water: false,
    has_iron: false,
    has_toiletries: false,
  });

  const updateForm = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // A hotel account has exactly one option, so choosing it for them removes a
  // step that only ever had one answer. Declared after `form`/`updateForm` so
  // it isn't reading bindings that don't exist yet.
  useEffect(() => {
    if (allowedTypes.length === 1 && !form.type) updateForm("type", allowedTypes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTypes.length]);

  // The room's district IS the hotel's district. Mirrored into `location` so
  // the insert, the analytics call and the review card all keep reading one
  // field — this is the only place the two are connected.
  useEffect(() => {
    if (!isHotelAccount) return;
    const d = hotel?.district ?? "";
    setForm((prev) => (prev.location === d ? prev : { ...prev, location: d }));
  }, [isHotelAccount, hotel?.district]);

  const canNext = () => {
    switch (step) {
      case 0: return !!form.type;
      case 1: {
        return (
          !!form.title.trim() &&
          !!form.location.trim() &&
          !getPriceError() &&
          !getDepositError()
        );
      }
      case 2: return ROOM_FIELDS.every((f) => !getRoomError(f.key));
      case 3: return true;
      default: return true;
    }
  };

  const getPriceError = () => {
    if (!form.price) return `Price is required to list your ${noun}`;
    if (Number(form.price) <= 0) return "Price must be greater than zero";
    return "";
  };

  // The platform collects nothing (plan §8 D1) — the deposit is simply the
  // figure the owner records, but it has to be recorded.
  const getDepositError = () => {
    if (form.deposit === "") return "Deposit is required — enter 0 if you take none";
    const value = Number(form.deposit);
    if (Number.isNaN(value) || value < 0) return "Deposit can't be negative";
    return "";
  };

  const getRoomError = (key: RoomKey) => {
    const field = ROOM_FIELDS.find((f) => f.key === key)!;
    const raw = form[key];
    if (raw === "") return `${field.label} is required`;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      return `Enter a whole number between ${field.min} and ${field.max}`;
    }
    return "";
  };

  const handleSubmit = async () => {
    if (photos.length < 2) {
      toast.error("Please upload at least 2 photos for your listing");
      return;
    }
    if (!canCreatePropertyType(appRole as UserRole, form.type)) {
      toast.error(wrongAccountTypeMessage(appRole as UserRole));
      return;
    }
    setLoading(true);
    try {
      if (!isSignedIn || !userId) {
        toast.error("Please sign in first");
        navigate("/signin");
        return;
      }

      // Hotels AND BnBs bill by the night. `is_daily_rate` is the column the
      // price display, the marketplace filter and the booking guard all read,
      // so it must follow the type rather than being asked for separately.
      const isNightly = isNightlyRateType(form.type);
      const isVacant = form.occupancy_status === "vacant";

      const { data: property, error } = await supabase
        .from("properties")
        .insert({
          owner_id: userId,
          // Staff acting inside an agency file the unit under that agency, so
          // the whole team can manage it.
          org_id: orgId ?? null,
          title: form.title.trim(),
          description: form.description.trim() || null,
          type: form.type as PropertyType,
          price: Number(form.price),
          deposit: Number(form.deposit) || 0,
          location: form.location.trim(),
          is_daily_rate: isNightly,
          purpose: form.purpose,
          bedrooms: Number(form.bedrooms),
          living_rooms: Number(form.living_rooms),
          kitchens: Number(form.kitchens),
          toilets: Number(form.toilets),
          occupancy_status: form.occupancy_status,
          is_listed: form.is_listed,
          // Kept in agreement with the split above so the existing marketplace
          // queries stay correct: only a vacant, listed unit is available.
          // For-sale properties are always available (not rented).
          is_available: form.purpose === "sell" ? form.is_listed : isVacant && form.is_listed,
          has_cctv: form.has_cctv,
          has_parking: form.has_parking,
          floor_number: form.type === "apartment" ? Number(form.floor_number) || null : null,
          has_balcony: form.type === "apartment" ? form.has_balcony : false,
          is_furnished: form.is_furnished,
          has_elevator: form.has_elevator,
          // Hotel amenities (20260902000002)
          has_free_wifi: form.has_free_wifi,
          has_coffee_shop: form.has_coffee_shop,
          has_airport_transport: form.has_airport_transport,
          has_business_center: form.has_business_center,
          has_banquet_room: form.has_banquet_room,
          is_all_inclusive: form.is_all_inclusive,
          has_24h_security: form.has_24h_security,
          has_secured_parking: form.has_secured_parking,
          has_restaurant: form.has_restaurant,
          has_breakfast: form.has_breakfast,
          has_breakfast_buffet: form.has_breakfast_buffet,
          has_shuttle: form.has_shuttle,
          has_car_hire: form.has_car_hire,
          has_meeting_rooms: form.has_meeting_rooms,
          has_24h_front_desk: form.has_24h_front_desk,
          has_express_checkout: form.has_express_checkout,
          has_clothes_dryer: form.has_clothes_dryer,
          has_laundry: form.has_laundry,
          // In-room features (20260902000003)
          has_air_conditioning: form.has_air_conditioning,
          has_desk: form.has_desk,
          has_housekeeping: form.has_housekeeping,
          has_room_service: form.has_room_service,
          has_refrigerator: form.has_refrigerator,
          has_cable_tv: form.has_cable_tv,
          has_flatscreen_tv: form.has_flatscreen_tv,
          has_bath_shower: form.has_bath_shower,
          has_safe: form.has_safe,
          has_telephone: form.has_telephone,
          has_vip_facilities: form.has_vip_facilities,
          has_bottled_water: form.has_bottled_water,
          has_iron: form.has_iron,
          has_toiletries: form.has_toiletries,
        })
        .select("id")
        .single();

      if (error) throw error;

      // Private notes go to `property_private`, never onto the property row —
      // they must not be reachable from the public feed (plan §2 R-2).
      if (property && form.private_notes.trim()) {
        try {
          await savePropertyNotes.mutateAsync({
            propertyId: property.id,
            orgId,
            private_notes: form.private_notes,
          });
        } catch {
          // The listing itself succeeded; don't fail the whole flow over notes.
          toast.warning("Listing created, but your private notes couldn't be saved. Add them from Manage.");
        }
      }

      // Upload photos
      if (photos.length > 0 && property) {
        const uploadPromises = photos.map(async (file, index) => {
          const ext = file.name.split(".").pop();
          const path = `${userId}/${property.id}/${index}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("property-images")
            .upload(path, file, { upsert: true });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from("property-images")
            .getPublicUrl(path);

          return supabase.from("property_images").insert({
            property_id: property.id,
            image_url: urlData.publicUrl,
            sort_order: index,
          });
        });

        await Promise.all(uploadPromises);
      }

      track(ANALYTICS_EVENTS.PROPERTY_LISTED, {
        property_id: property.id,
        type: form.type,
        location: form.location,
        price: Number(form.price) || 0,
        photo_count: photos.length,
        listed_by_role: appRole,
        has_org: Boolean(orgId),
      });

      // A room added by a hotel belongs to that hotel's page — otherwise the
      // owner has to go and tick it on in the builder before anyone can see
      // it, which is not what "add a room" means. Appended, never replacing.
      if (isHotelAccount && hotelId && property) {
        try {
          await attachRoom.mutateAsync({ hotelId, propertyId: property.id });
        } catch {
          toast.warning(
            "Room created, but it couldn't be added to your hotel page. Add it from the page builder.",
          );
        }
      }

      toast.success(isHotelAccount ? "Room added!" : "Property listed successfully!");
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["my-properties"] });
      navigate(isHotelAccount ? "/manage" : "/properties");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create listing";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (checkingAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <div className="container max-w-lg py-6">
        {/* Back + title */}
        <button onClick={() => (step > firstStep ? setStep(step - 1) : navigate(-1))} className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
          <ArrowLeft className="w-4 h-4" /> {step > firstStep ? "Back" : "Cancel"}
        </button>

        <h1 className="text-xl font-heading font-bold text-foreground mb-1">
          {isHotelAccount ? "Add a Room" : "List Your Property"}
        </h1>
        <p className="text-muted-foreground text-sm mb-6">
          Step {step - firstStep + 1} of {visibleSteps.length}: {steps[step]}
        </p>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-8">
          {visibleSteps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i + firstStep <= step ? "bg-accent" : "bg-border"}`} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Step 0: Property Type */}
            {step === 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground mb-4">
                  {allowedTypes.length === 1
                    ? "You're listing a hotel room"
                    : "What type of property are you listing?"}
                </p>
                {/* An agency lists rentals, a hotel lists rooms. Filtering here
                    keeps the wrong option from ever being clickable; the submit
                    handler re-checks because step state is client-side. */}
                {allowedTypes.length === 1 && (
                  <p className="text-xs text-muted-foreground mb-4">
                    {wrongAccountTypeMessage(appRole as UserRole)}{" "}
                    <Link to="/profile" className="text-primary underline underline-offset-2">
                      Account settings
                    </Link>
                  </p>
                )}
                {([
                  { value: "villa", label: "House", icon: Home, desc: "Full home with rooms & amenities — monthly rent" },
                  { value: "apartment", label: "Apartment", icon: Building2, desc: "Apartment unit with floor & balcony — monthly rent" },
                  { value: "hotel", label: "Hotel", icon: Hotel, desc: "Hotel room or suite — daily rate" },
                  { value: "bnb", label: "BnB", icon: BedDouble, desc: "Short-let unit — nightly rate, takes bookings" },
                  { value: "commercial", label: "Commercial", icon: Briefcase, desc: "Office, shop or business space — monthly rent" },
                ] as const).filter((opt) => allowedTypes.includes(opt.value)).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateForm("type", opt.value)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left ${
                      form.type === opt.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                      <opt.icon className="w-5 h-5 text-foreground" />
                    </div>
                    <div>
                      <p className="font-heading font-semibold text-foreground text-sm">{opt.label}</p>
                      <p className="text-muted-foreground text-xs">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 1: Basic Details */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">{Noun} Title</Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder={isHotelAccount ? "e.g. Deluxe Sea-View Double" : "e.g. Modern 3-Bedroom House"} value={form.title} onChange={(e) => updateForm("title", e.target.value)} className="pl-10 h-12 rounded-xl" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Description</Label>
                  <Textarea 
                    placeholder={isHotelAccount ? "Describe this room..." : "Describe your property..."}
                    value={form.description} 
                    onChange={(e) => {
                      const value = e.target.value;
                      // Check for phone number patterns (7+ consecutive digits)
                      if (/\d{7,}/.test(value)) {
                        toast.error("Phone numbers are not allowed in property descriptions. Please use our messaging system for contact.");
                        return;
                      }
                      updateForm("description", value);
                    }} 
                    className="rounded-xl min-h-[100px]" 
                  />
                </div>
                {/* ── District ────────────────────────────────────────────────
                    An agency picks one per unit. A hotel doesn't get asked:
                    the building has a district, so the room inherits it and
                    this becomes a read-only statement of where it is. */}
                {isHotelAccount ? (
                  <div className="space-y-2">
                    {hotels.length > 1 && (
                      <>
                        <Label className="text-xs font-medium text-muted-foreground">Hotel</Label>
                        <Select value={hotelId} onValueChange={setHotelId}>
                          <SelectTrigger className="h-12 rounded-xl">
                            <div className="flex items-center gap-2">
                              <Hotel className="w-4 h-4 text-muted-foreground" />
                              <SelectValue placeholder="Which hotel?" />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            {hotels.map((h) => (
                              <SelectItem key={h.id} value={h.id}>
                                {h.name}{h.district ? ` — ${h.district}` : " — no district set"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </>
                    )}

                    <Label className="text-xs font-medium text-muted-foreground">District</Label>
                    {hotelsPending ? (
                      // Don't accuse the owner of a missing district before the
                      // hotels have even loaded.
                      <div className="h-12 rounded-xl border border-border bg-muted/40 px-3 flex items-center">
                        <span className="text-sm text-muted-foreground">Loading your hotel…</span>
                      </div>
                    ) : form.location ? (
                      <div className="h-12 rounded-xl border border-border bg-muted/40 px-3 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground">{form.location}</span>
                        <span className="text-xs text-muted-foreground ml-auto truncate">
                          from {hotel?.name ?? "your hotel"}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                        <p className="text-xs text-foreground flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px text-amber-600" />
                          {hotels.length === 0
                            ? "You don't have a hotel page yet. Create one and choose its district — rooms are filed under it."
                            : `"${hotel?.name ?? "This hotel"}" has no district set yet. Choose it once in the page settings and every room inherits it.`}
                        </p>
                        <Link
                          to={hotels.length === 0 ? "/manage/hotels" : `/manage/hotels/${hotelId}`}
                          className="text-xs text-primary underline underline-offset-2"
                        >
                          {hotels.length === 0 ? "Create your hotel page" : "Open page settings"}
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">District</Label>
                    <Select value={form.location} onValueChange={(v) => updateForm("location", v)}>
                      <SelectTrigger className="h-12 rounded-xl">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          <SelectValue placeholder="Select district" />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {MOGADISHU_DISTRICTS.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Purpose toggle — only agencies/owners can list for sale */}
                {!isHotelAccount && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">Listing type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateForm("purpose", "rent")}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${
                          form.purpose === "rent"
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Home className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-heading font-semibold text-foreground text-xs">For Rent</p>
                          <p className="text-muted-foreground text-[10px]">Monthly or nightly</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateForm("purpose", "sell")}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${
                          form.purpose === "sell"
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                          <DollarSign className="w-4 h-4 text-warning" />
                        </div>
                        <div>
                          <p className="font-heading font-semibold text-foreground text-xs">For Sale</p>
                          <p className="text-muted-foreground text-[10px]">One-time price</p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Price {form.purpose === "sell" ? "(sale price)" : isNightlyRateType(form.type) ? "(per night)" : "(per month)"} *
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input 
                        type="number" 
                        min="1" 
                        placeholder="0" 
                        value={form.price} 
                        onChange={(e) => updateForm("price", e.target.value)} 
                        className={`pl-10 h-12 rounded-xl ${getPriceError() ? "border-destructive" : ""}`}
                      />
                    </div>
                    {getPriceError() && (
                      <div className="flex items-center gap-1.5 text-destructive text-xs">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{getPriceError()}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">Deposit *</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={form.deposit}
                        onChange={(e) => updateForm("deposit", e.target.value)}
                        className={`pl-10 h-12 rounded-xl ${getDepositError() ? "border-destructive" : ""}`}
                      />
                    </div>
                    {getDepositError() && (
                      <div className="flex items-center gap-1.5 text-destructive text-xs">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{getDepositError()}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Occupancy & listing — two separate decisions (plan §2 R-3) */}
                <div className="space-y-3 pt-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Availability</p>

                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { value: "vacant", label: "Free to rent", icon: Home, desc: "Empty and ready" },
                      { value: "occupied", label: "Occupied", icon: UserRound, desc: "Someone lives here" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          updateForm("occupancy_status", opt.value);
                          // An occupied unit can never be advertised; going
                          // back to vacant restores the advertised default.
                          updateForm("is_listed", opt.value === "vacant");
                        }}
                        className={`flex flex-col items-start gap-1 p-3 rounded-xl border-2 transition-all text-left ${
                          form.occupancy_status === opt.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/30"
                        }`}
                      >
                        <opt.icon className="w-4 h-4 text-foreground" />
                        <span className="text-sm font-medium text-foreground">{opt.label}</span>
                        <span className="text-[11px] text-muted-foreground">{opt.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-3 py-3 border-b border-border">
                    <div className="min-w-0">
                      <Label className="flex items-center gap-2 text-sm text-foreground">
                        <Globe className="w-4 h-4 text-muted-foreground" /> Show in the marketplace
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {form.occupancy_status === "occupied"
                          ? "Occupied units are still tracked in your dashboard — rent, bills and tenant — but they don't appear in the marketplace."
                          : "Turn this off to keep the unit in your dashboard without advertising it (renovation, held for someone)."}
                      </p>
                    </div>
                    <Switch
                      checked={form.is_listed && form.occupancy_status === "vacant"}
                      disabled={form.occupancy_status === "occupied"}
                      onCheckedChange={(v) => updateForm("is_listed", v)}
                    />
                  </div>
                </div>

                {/* Private notes — stored in property_private, never public */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Private notes (optional)
                  </Label>
                  <Textarea
                    placeholder="Landlord prefers cash on the 1st. Spare keys with the caretaker…"
                    value={form.private_notes}
                    onChange={(e) => updateForm("private_notes", e.target.value)}
                    className="rounded-xl min-h-[80px]"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Only you and your agency staff can see this. It never appears on the public listing.
                  </p>
                </div>
              </div>
            )}

            {/* Step 2: Amenities */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium text-foreground">Room details & amenities</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    All four counts are required — renters filter on them, and your
                    management dashboard uses them to describe the unit.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {ROOM_FIELDS.map((field) => {
                    const error = getRoomError(field.key);
                    return (
                      <div key={field.key} className="space-y-2">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1">
                          <field.icon className="w-3.5 h-3.5" /> {field.label} *
                        </Label>
                        <Select value={form[field.key]} onValueChange={(v) => updateForm(field.key, v)}>
                          <SelectTrigger className={`h-11 rounded-xl ${error ? "border-destructive" : ""}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((n) => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

                {ROOM_FIELDS.some((f) => !!getRoomError(f.key)) && (
                  <div className="flex items-center gap-1.5 text-destructive text-xs">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{ROOM_FIELDS.map((f) => getRoomError(f.key)).find(Boolean)}</span>
                  </div>
                )}

                {form.type === "apartment" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> Floor Number</Label>
                      <Input type="number" min="0" max="100" value={form.floor_number} onChange={(e) => updateForm("floor_number", e.target.value)} className="h-11 rounded-xl" />
                    </div>
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Features</p>
                  <div className="flex items-center justify-between py-3 border-b border-border">
                    <Label className="flex items-center gap-2 text-sm text-foreground"><Cctv className="w-4 h-4 text-muted-foreground" /> CCTV Camera</Label>
                    <Switch checked={form.has_cctv} onCheckedChange={(v) => updateForm("has_cctv", v)} />
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-border">
                    <Label className="flex items-center gap-2 text-sm text-foreground"><Car className="w-4 h-4 text-muted-foreground" /> Parking Available</Label>
                    <Switch checked={form.has_parking} onCheckedChange={(v) => updateForm("has_parking", v)} />
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-border">
                    <Label className="flex items-center gap-2 text-sm text-foreground"><Armchair className="w-4 h-4 text-muted-foreground" /> Furnished</Label>
                    <Switch checked={form.is_furnished} onCheckedChange={(v) => updateForm("is_furnished", v)} />
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-border">
                    <Label className="flex items-center gap-2 text-sm text-foreground"><span role="img" aria-label="Elevator" className="text-base leading-none">🛗</span> Elevator</Label>
                    <Switch checked={form.has_elevator} onCheckedChange={(v) => updateForm("has_elevator", v)} />
                  </div>
                </div>

                {/* Hotel amenities — shown for hotel rooms and nightly units */}
                {(isHotelAccount || isNightlyRateType(form.type)) && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Hotel amenities
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tell guests what your property offers — these appear on your room page and hotel website.
                    </p>
                    {[
                      { key: "has_free_wifi", label: "Free High-Speed Internet (WiFi)", icon: () => <Wifi className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_coffee_shop", label: "Coffee shop", icon: () => <Coffee className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_airport_transport", label: "Airport transportation", icon: () => <PlaneTakeoff className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_business_center", label: "Business Center with Internet Access", icon: () => <Briefcase className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_banquet_room", label: "Banquet room", icon: () => <Users className="w-4 h-4 text-muted-foreground" /> },
                      { key: "is_all_inclusive", label: "All Inclusive", icon: () => <Sparkles className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_24h_security", label: "24-hour security", icon: () => <ShieldCheck className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_secured_parking", label: "Secured parking", icon: () => <CarFront className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_restaurant", label: "Restaurant", icon: () => <Utensils className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_breakfast", label: "Breakfast available", icon: () => <Sun className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_breakfast_buffet", label: "Breakfast buffet", icon: () => <UtensilsCrossed className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_shuttle", label: "Shuttle bus service", icon: () => <Bus className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_car_hire", label: "Car hire", icon: () => <Car className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_meeting_rooms", label: "Meeting rooms", icon: () => <Landmark className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_24h_front_desk", label: "24-hour front desk", icon: () => <Clock className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_express_checkout", label: "Express check-in / check-out", icon: () => <CheckCircle2 className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_clothes_dryer", label: "Clothes dryer", icon: () => <Wind className="w-4 h-4 text-muted-foreground" /> },
                      { key: "has_laundry", label: "Laundry service", icon: () => <Shirt className="w-4 h-4 text-muted-foreground" /> },
                    ].map((a) => (
                      <div key={a.key} className="flex items-center justify-between py-3 border-b border-border">
                        <Label className="flex items-center gap-2 text-sm text-foreground">
                          <a.icon /> {a.label}
                        </Label>
                        <Switch
                          checked={Boolean(form[a.key as keyof typeof form])}
                          onCheckedChange={(v) => updateForm(a.key, v)}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* In-room features — apartments get air conditioning only;
                    hotel/bnb rooms get the full set. */}
                {(form.type === "apartment" || isHotelAccount || isNightlyRateType(form.type)) && (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Room features
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {form.type === "apartment" && !isHotelAccount
                        ? "Apartments offer air conditioning."
                        : "What's inside the room? These appear on your room page and hotel website."}
                    </p>
                    {[
                      // Air conditioning is available to apartments AND hotel/bnb rooms.
                      { key: "has_air_conditioning", label: "Air conditioning", icon: () => <Snowflake className="w-4 h-4 text-muted-foreground" /> },
                      // The rest are hotel/bnb room features only.
                      ...(form.type === "apartment" && !isHotelAccount ? [] : [
                        { key: "has_desk", label: "Desk", icon: () => <Laptop className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_housekeeping", label: "Housekeeping", icon: () => <Sparkles className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_room_service", label: "Room service", icon: () => <ConciergeBell className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_refrigerator", label: "Refrigerator", icon: () => <Refrigerator className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_cable_tv", label: "Cable / satellite TV", icon: () => <Tv className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_flatscreen_tv", label: "Flatscreen TV", icon: () => <MonitorPlay className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_bath_shower", label: "Bath / shower", icon: () => <ShowerHead className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_safe", label: "Safe", icon: () => <Vault className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_telephone", label: "Telephone", icon: () => <Phone className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_vip_facilities", label: "VIP room facilities", icon: () => <Crown className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_bottled_water", label: "Bottled water", icon: () => <GlassWater className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_iron", label: "Iron", icon: () => <Droplets className="w-4 h-4 text-muted-foreground" /> },
                        { key: "has_toiletries", label: "Complimentary toiletries", icon: () => <SprayCan className="w-4 h-4 text-muted-foreground" /> },
                      ]),
                    ].map((a) => (
                      <div key={a.key} className="flex items-center justify-between py-3 border-b border-border">
                        <Label className="flex items-center gap-2 text-sm text-foreground">
                          <a.icon /> {a.label}
                        </Label>
                        <Switch
                          checked={Boolean(form[a.key as keyof typeof form])}
                          onCheckedChange={(v) => updateForm(a.key, v)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Photos */}
            {step === 3 && (
              <PhotoUploader photos={photos} setPhotos={setPhotos} maxPhotos={35} />
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-card border border-border space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {isHotelAccount ? "Hotel" : "Type"}
                    </span>
                    <span className="text-sm font-semibold text-foreground capitalize">
                      {isHotelAccount ? (hotel?.name ?? "Room") : form.type}
                    </span>
                  </div>
                  {!isHotelAccount && form.purpose && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Purpose</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        form.purpose === "sell"
                          ? "bg-warning/15 text-warning"
                          : "bg-primary/10 text-primary"
                      }`}>
                        {form.purpose === "sell" ? "For Sale" : "For Rent"}
                      </span>
                    </div>
                  )}
                  <h3 className="font-heading font-bold text-foreground">{form.title}</h3>
                  <p className="text-muted-foreground text-sm flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {form.location}</p>
                  <div className="flex gap-4 pt-2 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground">Price</p>
                      <p className="font-heading font-bold text-foreground">${form.price}<span className="text-xs text-muted-foreground">/{form.purpose === "sell" ? "one-time" : isNightlyRateType(form.type) ? "night" : "mo"}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Deposit</p>
                      <p className="font-heading font-bold text-foreground">${form.deposit || "0"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Bed className="w-3.5 h-3.5" />{form.bedrooms} bed</span>
                    <span className="flex items-center gap-1"><Bath className="w-3.5 h-3.5" />{form.toilets} bath</span>
                    <span className="flex items-center gap-1"><Sofa className="w-3.5 h-3.5" />{form.living_rooms} living</span>
                    <span className="flex items-center gap-1"><CookingPot className="w-3.5 h-3.5" />{form.kitchens} kitchen</span>
                    {form.has_cctv && <span className="flex items-center gap-1"><Cctv className="w-3.5 h-3.5" />CCTV</span>}
                    {form.has_parking && <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" />Parking</span>}
                    {form.has_balcony && <span className="flex items-center gap-1"><Waves className="w-3.5 h-3.5" />Balcony</span>}
                    {form.has_elevator && <span className="flex items-center gap-1"><span role="img" aria-label="Elevator">🛗</span>Elevator</span>}
                    {form.has_free_wifi && <span className="flex items-center gap-1"><Wifi className="w-3.5 h-3.5" />WiFi</span>}
                    {form.has_coffee_shop && <span className="flex items-center gap-1"><Coffee className="w-3.5 h-3.5" />Coffee shop</span>}
                    {form.has_airport_transport && <span className="flex items-center gap-1"><PlaneTakeoff className="w-3.5 h-3.5" />Airport transport</span>}
                    {form.has_business_center && <span className="flex items-center gap-1"><Briefcase className="w-3.5 h-3.5" />Business center</span>}
                    {form.has_banquet_room && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Banquet room</span>}
                    {form.is_all_inclusive && <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />All inclusive</span>}
                    {form.has_24h_security && <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />24h security</span>}
                    {form.has_secured_parking && <span className="flex items-center gap-1"><CarFront className="w-3.5 h-3.5" />Secured parking</span>}
                    {form.has_restaurant && <span className="flex items-center gap-1"><Utensils className="w-3.5 h-3.5" />Restaurant</span>}
                    {form.has_breakfast && <span className="flex items-center gap-1"><Sun className="w-3.5 h-3.5" />Breakfast</span>}
                    {form.has_breakfast_buffet && <span className="flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5" />Breakfast buffet</span>}
                    {form.has_shuttle && <span className="flex items-center gap-1"><Bus className="w-3.5 h-3.5" />Shuttle</span>}
                    {form.has_car_hire && <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" />Car hire</span>}
                    {form.has_meeting_rooms && <span className="flex items-center gap-1"><Landmark className="w-3.5 h-3.5" />Meeting rooms</span>}
                    {form.has_24h_front_desk && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />24h front desk</span>}
                    {form.has_express_checkout && <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Express check-in/out</span>}
                    {form.has_clothes_dryer && <span className="flex items-center gap-1"><Wind className="w-3.5 h-3.5" />Clothes dryer</span>}
                    {form.has_laundry && <span className="flex items-center gap-1"><Shirt className="w-3.5 h-3.5" />Laundry</span>}
                    {form.has_air_conditioning && <span className="flex items-center gap-1"><Snowflake className="w-3.5 h-3.5" />Air conditioning</span>}
                    {form.has_desk && <span className="flex items-center gap-1"><Laptop className="w-3.5 h-3.5" />Desk</span>}
                    {form.has_housekeeping && <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" />Housekeeping</span>}
                    {form.has_room_service && <span className="flex items-center gap-1"><ConciergeBell className="w-3.5 h-3.5" />Room service</span>}
                    {form.has_refrigerator && <span className="flex items-center gap-1"><Refrigerator className="w-3.5 h-3.5" />Refrigerator</span>}
                    {form.has_cable_tv && <span className="flex items-center gap-1"><Tv className="w-3.5 h-3.5" />Cable TV</span>}
                    {form.has_flatscreen_tv && <span className="flex items-center gap-1"><MonitorPlay className="w-3.5 h-3.5" />Flatscreen TV</span>}
                    {form.has_bath_shower && <span className="flex items-center gap-1"><ShowerHead className="w-3.5 h-3.5" />Bath/shower</span>}
                    {form.has_safe && <span className="flex items-center gap-1"><Vault className="w-3.5 h-3.5" />Safe</span>}
                    {form.has_telephone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />Telephone</span>}
                    {form.has_vip_facilities && <span className="flex items-center gap-1"><Crown className="w-3.5 h-3.5" />VIP facilities</span>}
                    {form.has_bottled_water && <span className="flex items-center gap-1"><GlassWater className="w-3.5 h-3.5" />Bottled water</span>}
                    {form.has_iron && <span className="flex items-center gap-1"><Droplets className="w-3.5 h-3.5" />Iron</span>}
                    {form.has_toiletries && <span className="flex items-center gap-1"><SprayCan className="w-3.5 h-3.5" />Toiletries</span>}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> {photos.length} photo{photos.length !== 1 ? "s" : ""}</p>

                  <div className="pt-2 border-t border-border space-y-1.5">
                    <p className="text-xs text-foreground flex items-center gap-1.5">
                      {form.occupancy_status === "occupied" ? (
                        <><UserRound className="w-3.5 h-3.5 text-muted-foreground" /> Occupied — tracked in your dashboard, hidden from the marketplace</>
                      ) : form.is_listed ? (
                        <><Globe className="w-3.5 h-3.5 text-muted-foreground" /> Free to rent — will appear in the marketplace</>
                      ) : (
                        <><Globe className="w-3.5 h-3.5 text-muted-foreground" /> Free to rent — kept private, not advertised</>
                      )}
                    </p>
                    {form.private_notes.trim() && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> Private notes saved for your agency only
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex gap-3 mt-8">
          {/* `firstStep`, not 0 — for a hotel account step 0 doesn't exist, and
              a Back button that lands on a step the effect immediately bounces
              out of is a dead control that flickers. */}
          {step > firstStep && (
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button variant="hero" size="lg" className="flex-1" onClick={() => setStep(step + 1)} disabled={!canNext()}>
              Next <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button variant="hero" size="lg" className="flex-1" onClick={handleSubmit} disabled={loading}>
              {loading ? "Publishing..." : <><Check className="w-4 h-4" /> {isHotelAccount ? "Publish Room" : "Publish Listing"}</>}
            </Button>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default AddProperty;
