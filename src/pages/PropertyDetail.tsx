import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import ImageGallery from "@/components/ImageGallery";
import { BookingRequestForm } from "@/components/BookingRequestForm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MapPin, Bed, Bath, Car, Cctv, Building2, Waves,
  Sofa, CookingPot, DollarSign, Shield, User, Phone, Mail, Calendar, Home, Hotel, Eye, MessageCircle, Armchair
} from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { useAppAuth } from "@/hooks/use-auth";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";
import { propertyTypeClass, propertyTypeLabel } from "@/lib/property-display";

const PropertyDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userId: currentUserId, appRole } = useAppAuth();
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
  const isHotel = property.type === "hotel";

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
    property.has_elevator && { icon: () => <span role="img" aria-label="Elevator">🛗</span>, label: "Elevator", color: "bg-primary/10 text-primary" },
  ].filter(Boolean) as { icon: React.ElementType; label: string; color: string }[];

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header />

      {/* Back button overlaid on gallery (mobile) */}
      <div className="relative">
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
                  {isHotel ? "Nightly Rate" : "Monthly Rent"}
                </p>
                <p className="text-3xl font-heading font-bold text-foreground">
                  <span className="text-primary">${property.price.toLocaleString()}</span>
                  <span className="text-base font-normal text-muted-foreground">/{isHotel ? "night" : "mo"}</span>
                </p>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Deposit
                </p>
                <p className="text-xl font-heading font-bold text-foreground">
                  ${property.deposit.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Description */}
            {property.description && (
              <div>
                <h2 className="font-heading font-semibold text-foreground mb-2">About this property</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">{property.description}</p>
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

            {/* Posted date and views */}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-6 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" />
                Listed {new Date(property.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </div>
              {currentUserId && (currentUserId === property.owner_id || isAdmin || isSemiAdmin) && (
                <div className="flex items-center gap-2">
                  <Eye className="w-3.5 h-3.5" />
                  {property.views || 0} views
                </div>
              )}
            </div>
          </div>

                    {/* Sidebar */}
          <div className="space-y-6">
            {/* Public booking request — only nightly-rate hotel rooms are
                bookable, and only while the unit is available. Uses the secure
                create_booking_request RPC so a visitor never touches org_id or
                an amount (20260807000001). */}
            {isHotel && property.is_available && (
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
              `💰 Price: $${property.price.toLocaleString()}/${property.type === 'hotel' ? 'night' : 'mo'}\n` +
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
