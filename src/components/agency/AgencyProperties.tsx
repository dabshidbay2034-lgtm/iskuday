import type { Property } from "@/lib/types";
import PropertyCard from "@/components/PropertyCard";
import { useFavorites } from "@/hooks/use-favorites";
import { Building2, Search } from "lucide-react";
import { motion } from "framer-motion";

interface AgencyPropertiesProps {
  properties: Property[];
  isLoading?: boolean;
}

export function AgencyProperties({ properties, isLoading }: AgencyPropertiesProps) {
  const { isFavorite, toggleFavorite, isAuthenticated } = useFavorites();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square bg-muted rounded-2xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="text-center py-16 bg-card rounded-3xl border border-border shadow-card space-y-3">
        <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
          <Building2 className="w-7 h-7" />
        </div>
        <h3 className="font-heading font-bold text-lg">No active listings available</h3>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto">
          This agency or property manager currently has no vacant properties available to rent.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl md:text-2xl font-heading font-extrabold text-foreground">
          Available Listings ({properties.length})
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-8 md:gap-x-6">
        {properties.map((property, i) => (
          <motion.div
            key={property.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.05, 0.4) }}
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
    </div>
  );
}
