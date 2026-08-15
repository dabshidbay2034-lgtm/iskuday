import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, Eye, MapPin } from "lucide-react";

import { useAppAuth } from "@/hooks/use-auth";
import {
  formatMoney,
  useManagedProperty,
  usePropertyAccess,
  useSetOccupancy,
  useSetListed,
  type ManagedProperty as ManagedPropertyRecord,
} from "@/hooks/use-rent";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { OccupancyBadge } from "@/components/manage/portfolio-summary";
import { RentLedgerTable } from "@/components/manage/rent-ledger-table";
import { UtilityBillsTable } from "@/components/manage/utility-bills-table";
import { ExpensesTable } from "@/components/manage/expenses-table";
import { MaintenanceCard } from "@/components/manage/maintenance-card";
import { LeaseDocumentsCard } from "@/components/manage/lease-documents-card";
import { PropertyStaffCard } from "@/components/manage/property-staff-card";
import { isNightlyRateType } from "@/lib/property-kind";
import { HotelBookingsCard } from "@/components/manage/hotel-bookings-card";
import { HousekeepingCard } from "@/components/manage/housekeeping-card";
import { TenantCard } from "@/components/manage/tenant-card";
import { PrivateNotesCard } from "@/components/manage/private-notes-card";

/**
 * /manage/property/:id â€” everything the agency tracks about one unit
 * (docs/PLAN_PMS_SERVICES.md Â§6).
 *
 * Works for both kinds of landlord: an agency's staff, and a solo owner who
 * never created an organization. Each section resolves its own rights through
 * `usePropertyAccess(property)` rather than the org matrix alone.
 *
 * The body is a flat stack of independent sections, each taking the loaded
 * `property` and owning its own data + permission gating:
 *
 *   1. unit header + occupancy toggle   (PROPERTY_OCCUPANCY / owner)
 *   2. rent ledger                      (RENT_VIEW / RENT_MARK_PAID / owner)
 *   3. utility bills                    (UTILITIES_VIEW / UTILITIES_RECORD / owner)
 *   â€¦ private notes and the tenant record land here as further siblings.
 *
 * Nothing in the stack reads from anything above it, so a new section drops in
 * without touching the ones already here.
 */
const ManageProperty = () => {
  const { id } = useParams<{ id: string }>();
  const { isLoaded } = useAppAuth();
  const { data: property, isPending, isError } = useManagedProperty(id);

  // `isPending` stays true while the query is disabled, so a missing :id falls
  // through to the not-found branch below instead of a skeleton that never ends.
  if (id && (!isLoaded || isPending)) {
    return (
      <PropertyShell>
        <div className="p-4 md:p-5 bg-card rounded-2xl border border-border shadow-card space-y-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </PropertyShell>
    );
  }

  if (isError || !property) {
    return (
      <PropertyShell>
        <div className="text-center py-16 bg-card rounded-2xl border border-border">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Building2 className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-heading font-semibold text-foreground mb-1">
            Property not found
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
            It may have been deleted, or it belongs to someone else â€” you can only
            manage your own units and those of the agency you're signed in to.
          </p>
          <Button variant="hero" asChild>
            <Link to="/manage">Back to portfolio</Link>
          </Button>
        </div>
      </PropertyShell>
    );
  }

  return (
    <PropertyShell>
          <PropertyHeaderCard property={property} />

          <RentLedgerTable property={property} />

          <UtilityBillsTable property={property} />

          <ExpensesTable property={property} />

          <MaintenanceCard property={property} />

          <LeaseDocumentsCard property={property} />

          <PropertyStaffCard property={property} />

          {/* Hotel management â€” a hotel room gets its booking + housekeeping
              surfaces here. Each card self-gates on type='hotel' and rights. */}
          <HotelBookingsCard property={property} />

          <HousekeepingCard property={property} />

          {/* Who is in the unit and on what lease. */}
          <TenantCard property={property} />

          {/* The agency-private scratchpad. AddProperty has always WRITTEN
              these notes; until this was mounted nothing could read them back,
              so anything typed in the wizard was invisible forever. */}
          <PrivateNotesCard property={property} />
        </PropertyShell>
      );
    };

/** Page chrome shared by every state of this route. */
function PropertyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-4xl py-6 space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/manage">
            <ArrowLeft className="w-4 h-4" /> Portfolio
          </Link>
        </Button>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}

/**
 * Unit identity plus the occupancy toggle.
 *
 * Occupancy is a staff-level control (admin, manager, agent) â€” or the solo
 * owner's, on their own unit. The switch is hidden entirely without it and the
 * badge alone is shown instead. Marking a unit occupied also pulls it out of the
 * marketplace; freeing it up does not re-advertise it automatically (plan R-3).
 */
function PropertyHeaderCard({ property }: { property: ManagedPropertyRecord }) {
  const { canSetOccupancy } = usePropertyAccess(property);
  const setOccupancy = useSetOccupancy(property);
  const setListed = useSetListed(property);
  const isOccupied = property.occupancyStatus === "occupied";
  // For a hotel room or BnB, occupancy no longer decides marketplace
  // visibility — confirmed bookings do. The copy has to say so, or the owner
  // reasonably assumes marking it occupied hid it (which it used to).
  const nightly = isNightlyRateType(property.type);

  return (
    <div className="p-4 md:p-5 bg-card rounded-2xl border border-border shadow-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="secondary" className="text-[9px] uppercase tracking-wider rounded-full">
              {property.type}
            </Badge>
            <OccupancyBadge status={property.occupancyStatus} />
            {property.isListed && (
              <Badge variant="outline" className="text-[10px] rounded-full">
                Listed
              </Badge>
            )}
          </div>
          <h1 className="font-heading font-bold text-lg md:text-xl text-foreground truncate">
            {property.title}
          </h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" /> {property.location}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="font-heading font-bold text-lg text-accent">
            {formatMoney(property.monthlyRent)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            per {property.isDailyRate ? "night" : "month"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/60">
        <div className="min-w-0">
          {canSetOccupancy ? (
            <>
              <Label htmlFor="occupancy-toggle" className="text-sm text-foreground">
                Occupied
              </Label>
              <p className="text-xs text-muted-foreground">
                {nightly
                  ? "For your records only. Guests still see this room — confirmed bookings decide the nights it shows as taken."
                  : "Occupied units stay in the ledger but leave the public listings."}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isOccupied
                ? "This unit is tenanted â€” only staff with occupancy access can change that."
                : "This unit is vacant â€” only staff with occupancy access can change that."}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canSetOccupancy && (
            <Switch
              id="occupancy-toggle"
              checked={isOccupied}
              disabled={setOccupancy.isPending}
              onCheckedChange={(checked) =>
                setOccupancy.mutate(checked ? "occupied" : "vacant")
              }
            />
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/property/${property.id}`}>
              <Eye className="w-4 h-4" /> View listing
            </Link>
          </Button>
        </div>
      </div>

      {/* â”€â”€ Marketplace listing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          The other half of the occupancy toggle. Marking a unit occupied sets
          is_listed = false, and until this existed nothing could set it back â€”
          so a unit that was tenanted once was gone from the marketplace for
          good, with nothing on screen to explain why or undo it. */}
      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/60">
        <div className="min-w-0">
          {canSetOccupancy ? (
            <>
              <Label htmlFor="listed-toggle" className="text-sm text-foreground">
                Listed on the marketplace
              </Label>
              <p className="text-xs text-muted-foreground">
                {!property.isListed
                  ? "Hidden from search. Turn this on to advertise it."
                  : nightly
                    ? "Guests can find and book this room. It stays listed even on nights it's taken."
                    : isOccupied
                      ? "Queued until you mark it vacant."
                      : "Renters can find this unit in search."}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {property.isListed
                ? "This unit is advertised publicly."
                : "This unit is not advertised publicly."}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canSetOccupancy && (
            <Switch
              id="listed-toggle"
              checked={property.isListed}
              disabled={setListed.isPending}
              onCheckedChange={(checked) => setListed.mutate(checked)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default ManageProperty;

