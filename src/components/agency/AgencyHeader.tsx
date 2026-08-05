import { Building2, Hotel, MapPin, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AgencyHeaderProps {
  title: string;
  avatarUrl?: string | null;
  propertyCount: number;
  location?: string;
  isVerified?: boolean;
}

export function AgencyHeader({
  title,
  avatarUrl,
  propertyCount,
  location = "Mogadishu",
  isVerified = true,
}: AgencyHeaderProps) {
  const initials = title
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "AG";

  return (
    <div className="rounded-3xl bg-card border border-border/70 p-6 md:p-8 shadow-card space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <Avatar className="w-20 h-20 rounded-2xl border-2 border-primary/20 shadow-md">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt={title} className="object-cover" /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground text-xl font-extrabold rounded-2xl">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-heading font-extrabold text-foreground truncate">
              {title}
            </h1>
            {isVerified && (
              <Badge className="bg-success/15 text-success border-success/30 text-xs font-bold rounded-full gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Verified Partner
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs md:text-sm text-muted-foreground font-medium">
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4 text-primary" /> {location}
            </span>
            <span className="flex items-center gap-1">
              <Building2 className="w-4 h-4 text-accent" /> {propertyCount} active {propertyCount === 1 ? "listing" : "listings"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border/50 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 font-semibold">
          <ShieldCheck className="w-4 h-4 text-primary" /> Secure Marketplace Member
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/60 font-semibold">
          <Hotel className="w-4 h-4 text-accent" /> Direct Owner / Agency Portfolio
        </span>
      </div>
    </div>
  );
}
