import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Bed, Bath, Car, Cctv, Building2, MapPin, Heart, Armchair, Building } from "lucide-react";
import { toast } from "sonner";
import type { Property } from "@/lib/types";

interface PropertyCardProps {
  property: Property;
  onClick?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  isAuthenticated?: boolean;
}

const PropertyCard = ({ property, onClick, isFavorite, onToggleFavorite, isAuthenticated }: PropertyCardProps) => {
  const navigate = useNavigate();
  const typeColors: Record<string, string> = {
    villa: "bg-success text-success-foreground",
    apartment: "bg-info text-info-foreground",
    hotel: "bg-hotel text-hotel-foreground",
    commercial: "bg-warning text-warning-foreground",
  };
  const typeLabels: Record<string, string> = {
    villa: "House",
    apartment: "Apartment",
    hotel: "Hotel",
    commercial: "Commercial",
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      toast.error("Sign in to save properties");
      navigate("/signin");
      return;
    }
    onToggleFavorite?.(property.id);
  };

  const handleAgencyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const extendedProp = property as Property & { org_id?: string };
    const agencyId = extendedProp.org_id || property.owner_id;
    if (agencyId) {
      navigate(`/agency/${agencyId}`);
    }
  };

  return (
    <div
      onClick={() => { onClick?.(); navigate(`/property/${property.id}`); }}
      className="group cursor-pointer"
    >
      {/* Image */}
      <div className="relative aspect-square sm:aspect-[4/3.4] overflow-hidden rounded-2xl shadow-card group-hover:shadow-elevated transition-shadow duration-300">
        <img
          src={property.images?.[0] || "/placeholder.svg"}
          alt={property.title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <Badge className={`${typeColors[property.type]} border-0 text-[10px] uppercase tracking-wider font-bold rounded-full px-2.5 shadow-sm`}>
            {typeLabels[property.type] || property.type}
          </Badge>
          {property.is_furnished && (
            <Badge className="bg-card/90 backdrop-blur-sm text-foreground border-0 text-[10px] uppercase tracking-wider font-bold rounded-full px-2.5 shadow-sm flex items-center gap-1">
              <Armchair className="w-3 h-3" /> Furnished
            </Badge>
          )}
        </div>

        {/* Heart button — Airbnb-style minimal icon overlay */}
        <button
          onClick={handleFavorite}
          aria-label={isFavorite ? "Remove from saved" : "Save property"}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
        >
          <Heart
            className={`w-6 h-6 drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-colors ${
              isFavorite ? "fill-primary text-primary" : "fill-foreground/30 text-white"
            }`}
            strokeWidth={1.75}
          />
        </button>
      </div>

      {/* Content — clean Airbnb-style info block beneath the image */}
      <div className="pt-3 px-0.5 space-y-1">
        <h3 className="font-heading font-bold text-foreground text-[15px] leading-snug truncate">
          {property.title}
        </h3>
        <div className="flex items-center justify-between text-muted-foreground text-sm">
          <div className="flex items-center gap-1 truncate">
            <MapPin className="w-3.5 h-3.5 shrink-0 text-primary" />
            <span className="truncate">{property.location}</span>
          </div>

          {/* Link to Agency / Owner Profile */}
          {((property as Property & { org_id?: string }).org_id || property.owner_id) && (
            <button
              onClick={handleAgencyClick}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline shrink-0 ml-2"
              title="View Agency / Owner Profile"
            >
              <Building className="w-3 h-3" /> Agency
            </button>
          )}
        </div>

        {/* Features */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
          {property.bedrooms != null && (
            <span className="flex items-center gap-1">
              <Bed className="w-3.5 h-3.5" /> {property.bedrooms}
            </span>
          )}
          {property.toilets != null && (
            <span className="flex items-center gap-1">
              <Bath className="w-3.5 h-3.5" /> {property.toilets}
            </span>
          )}
          {property.has_parking && (
            <span className="flex items-center gap-1">
              <Car className="w-3.5 h-3.5" /> Parking
            </span>
          )}
          {property.has_cctv && (
            <span className="flex items-center gap-1">
              <Cctv className="w-3.5 h-3.5" /> CCTV
            </span>
          )}
          {property.floor_number != null && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" /> Floor {property.floor_number}
            </span>
          )}
        </div>

        {/* Price */}
        <div className="pt-1 flex items-baseline gap-1">
          <span className="font-heading font-extrabold text-foreground text-base">
            ${property.price.toLocaleString()}
          </span>
          <span className="text-muted-foreground text-xs">
            / {property.is_daily_rate ? "night" : "month"}
          </span>
          <span className="text-muted-foreground text-xs ml-auto">
            Deposit ${property.deposit.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default PropertyCard;
