import React from "react";
import { type Service } from "@/hooks/use-services";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  Shield,
  Sparkles,
  Truck,
  Key,
  Hammer,
  Home,
  Briefcase,
  Building,
  Zap,
  Droplet,
  Paintbrush,
  ArrowRight,
} from "lucide-react";

interface ServiceCardProps {
  service: Service;
  onEnquire: (service: Service) => void;
}

const ICON_MAP: Record<string, React.ElementType> = {
  wrench: Wrench,
  shield: Shield,
  sparkles: Sparkles,
  truck: Truck,
  key: Key,
  hammer: Hammer,
  home: Home,
  briefcase: Briefcase,
  building: Building,
  zap: Zap,
  droplet: Droplet,
  paintbrush: Paintbrush,
};

export function getServiceIcon(iconName: string | null | undefined): React.ElementType {
  if (!iconName) return Wrench;
  const key = iconName.toLowerCase().trim();
  return ICON_MAP[key] || Wrench;
}

export function ServiceCard({ service, onEnquire }: ServiceCardProps) {
  const IconComponent = getServiceIcon(service.icon);

  return (
    <div className="group flex flex-col justify-between rounded-3xl bg-card border border-border/70 shadow-card hover:shadow-elevated transition-all duration-300 overflow-hidden">
      <div>
        {/* Service Image / Header Banner */}
        {service.image_url ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
            <img
              src={service.image_url}
              alt={service.title}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute top-3 left-3 w-10 h-10 rounded-2xl bg-card/90 backdrop-blur-md border border-border/50 flex items-center justify-center shadow-sm">
              <IconComponent className="w-5 h-5 text-primary" />
            </div>
          </div>
        ) : (
          <div className="p-6 pb-2">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
              <IconComponent className="w-6 h-6" />
            </div>
          </div>
        )}

        {/* Details */}
        <div className="p-6 space-y-3">
          <h3 className="font-heading font-extrabold text-foreground text-lg md:text-xl leading-snug group-hover:text-primary transition-colors">
            {service.title}
          </h3>

          {service.description && (
            <p className="text-muted-foreground text-sm leading-relaxed line-clamp-3">
              {service.description}
            </p>
          )}

          {/* Pricing */}
          {(service.price_from != null || service.price_note) && (
            <div className="pt-2 flex items-baseline gap-2">
              {service.price_from != null && (
                <div className="flex items-baseline gap-1">
                  <span className="text-xs text-muted-foreground font-medium">From</span>
                  <span className="font-heading font-extrabold text-foreground text-lg">
                    ${service.price_from.toLocaleString()}
                  </span>
                </div>
              )}
              {service.price_note && (
                <Badge variant="secondary" className="text-[11px] font-medium rounded-full">
                  {service.price_note}
                </Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Action */}
      <div className="p-6 pt-0">
        <Button
          onClick={() => onEnquire(service)}
          className="w-full rounded-full font-bold shadow-card gap-2 group-hover:bg-primary/90"
        >
          Enquire Now
          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </div>
    </div>
  );
}
