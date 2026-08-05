import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/lib/permissions";

/**
 * Color-mapped role badge. Colors are derived from the StaffRole, not hardcoded
 * per-feature, so adding a role only needs a new entry here + STAFF_ROLES.
 */
const ROLE_STYLES: Record<StaffRole, string> = {
  "org:admin": "bg-primary/10 text-primary border-primary/20",
  "org:manager": "bg-accent/10 text-accent border-accent/20",
  "org:agent": "bg-info/10 text-info border-info/20",
  "org:viewer": "bg-secondary text-secondary-foreground border-border",
};

const ROLE_LABELS: Record<StaffRole, string> = {
  "org:admin": "Admin",
  "org:manager": "Manager",
  "org:agent": "Agent",
  "org:viewer": "Viewer",
};

export function RoleBadge({ role }: { role: StaffRole }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full capitalize", ROLE_STYLES[role])}
    >
      {ROLE_LABELS[role]}
    </Badge>
  );
}
