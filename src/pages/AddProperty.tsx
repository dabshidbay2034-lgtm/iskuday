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
  ArrowLeft, ArrowRight, Home, Building2, Hotel, Briefcase,
  Bed, Sofa, CookingPot, Bath, Cctv, Car, Layers, Waves,
  MapPin, DollarSign, FileText, Image as ImageIcon, Check, AlertCircle, Armchair,
  Lock, Globe, UserRound,
} from "lucide-react";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import { motion, AnimatePresence } from "framer-motion";
import { useAppAuth } from "@/hooks/use-auth";
import {
  allowedPropertyTypes, canCreatePropertyType, wrongAccountTypeMessage,
} from "@/lib/account-type";
import type { UserRole } from "@/lib/types";
import { useSavePropertyNotes } from "@/hooks/use-property-notes";

type PropertyType = "villa" | "apartment" | "hotel" | "commercial";
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
    if (!form.price) return "Price is required to list your property";
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

      const isHotel = form.type === "hotel";
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
          is_daily_rate: isHotel,
          bedrooms: Number(form.bedrooms),
          living_rooms: Number(form.living_rooms),
          kitchens: Number(form.kitchens),
          toilets: Number(form.toilets),
          occupancy_status: form.occupancy_status,
          is_listed: form.is_listed,
          // Kept in agreement with the split above so the existing marketplace
          // queries stay correct: only a vacant, listed unit is available.
          is_available: isVacant && form.is_listed,
          has_cctv: form.has_cctv,
          has_parking: form.has_parking,
          floor_number: form.type === "apartment" ? Number(form.floor_number) || null : null,
          has_balcony: form.type === "apartment" ? form.has_balcony : false,
          is_furnished: form.is_furnished,
          has_elevator: form.has_elevator,
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

      toast.success("Property listed successfully!");
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      queryClient.invalidateQueries({ queryKey: ["my-properties"] });
      navigate("/properties");
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
        <button onClick={() => (step > 0 ? setStep(step - 1) : navigate(-1))} className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
          <ArrowLeft className="w-4 h-4" /> {step > 0 ? "Back" : "Cancel"}
        </button>

        <h1 className="text-xl font-heading font-bold text-foreground mb-1">List Your Property</h1>
        <p className="text-muted-foreground text-sm mb-6">Step {step + 1} of {steps.length}: {steps[step]}</p>

        {/* Progress bar */}
        <div className="flex gap-1.5 mb-8">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-border"}`} />
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
                  <Label className="text-xs font-medium text-muted-foreground">Property Title</Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="e.g. Modern 3-Bedroom House" value={form.title} onChange={(e) => updateForm("title", e.target.value)} className="pl-10 h-12 rounded-xl" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Description</Label>
                  <Textarea 
                    placeholder="Describe your property..." 
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Price ({form.type === "hotel" ? "per night" : "per month"}) *
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
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Type</span>
                    <span className="text-sm font-semibold text-foreground capitalize">{form.type}</span>
                  </div>
                  <h3 className="font-heading font-bold text-foreground">{form.title}</h3>
                  <p className="text-muted-foreground text-sm flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {form.location}</p>
                  <div className="flex gap-4 pt-2 border-t border-border">
                    <div>
                      <p className="text-xs text-muted-foreground">Price</p>
                      <p className="font-heading font-bold text-foreground">${form.price}<span className="text-xs text-muted-foreground">/{form.type === "hotel" ? "night" : "mo"}</span></p>
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
          {step > 0 && (
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
              {loading ? "Publishing..." : <><Check className="w-4 h-4" /> Publish Listing</>}
            </Button>
          )}
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default AddProperty;
