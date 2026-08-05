import { Building2, Users } from "lucide-react";
import type { useStaff } from "@/hooks/use-staff";

type Staff = ReturnType<typeof useStaff>;

/**
 * Agency header — organization avatar/name + member + invitation counts.
 * Purely presentational; everything is read from the `useStaff()` result.
 */
export function AgencyHeader({ staff }: { staff: Staff }) {
  const { organization, members, invitations } = staff;
  if (!organization) return null;

  const name = organization.name ?? "My Agency";
  const imageUrl = organization.imageUrl;
  const slug = organization.slug;

  return (
    <div className="flex items-center gap-4 p-4 bg-card rounded-2xl border border-border shadow-card">
      <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl overflow-hidden bg-secondary flex items-center justify-center shrink-0">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Building2 className="w-7 h-7 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-heading font-bold text-lg md:text-xl text-foreground truncate">
          {name}
        </h1>
        {slug && (
          <p className="text-xs text-muted-foreground truncate">@{slug}</p>
        )}
      </div>
      <div className="flex gap-4 md:gap-6 shrink-0">
        <div className="text-center">
          <p className="text-xl md:text-2xl font-heading font-bold text-foreground flex items-center gap-1">
            <Users className="w-4 h-4 text-muted-foreground md:hidden" />
            {members.length}
          </p>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Members</p>
        </div>
        <div className="text-center">
          <p className="text-xl md:text-2xl font-heading font-bold text-foreground">{invitations.length}</p>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Pending</p>
        </div>
      </div>
    </div>
  );
}
