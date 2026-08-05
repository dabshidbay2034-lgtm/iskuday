import { useState } from "react";
import {
  UserPlus, UserRound, Phone, CalendarRange, Wallet, Pencil,
  LogOut, Lock, AlertTriangle, History,
} from "lucide-react";

import {
  getLeaseStatus,
  useTenants,
  type LeaseStatus,
  type Tenant,
} from "@/hooks/use-tenants";
import { useAppAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TenantDialog } from "./tenant-dialog";

/**
 * The tenant panel for one property: who is in the unit, on what lease, and how
 * close that lease is to running out — the thing staff actually watch for.
 *
 * Managing tenants is Admin + Manager only (PERMISSIONS.TENANTS_MANAGE, plan
 * §5). Agents and Viewers see the record but get no controls.
 *
 * `contact_phone` is rendered here because this is a management surface. It is
 * org-private (plan §4) and must not be copied into any public component.
 *
 * Tenants have no logins (plan §8 D2) — nothing here invites or authenticates
 * anyone.
 */

interface TenantCardProps {
  propertyId: string;
  className?: string;
}

const LEASE_STYLES: Record<LeaseStatus["state"], string> = {
  active: "bg-success/10 text-success border-success/20",
  expiring: "bg-warning/10 text-warning border-warning/20",
  expired: "bg-destructive/10 text-destructive border-destructive/20",
  upcoming: "bg-info/10 text-info border-info/20",
  unknown: "bg-secondary text-muted-foreground border-border",
  inactive: "bg-secondary text-muted-foreground border-border",
};

export function LeaseBadge({ status }: { status: LeaseStatus }) {
  const needsAttention = status.state === "expiring" || status.state === "expired";
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full text-[11px] font-normal gap-1", LEASE_STYLES[status.state])}
    >
      {needsAttention && <AlertTriangle className="w-3 h-3" />}
      {status.label}
    </Badge>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatMoney(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return `$${Number(amount).toLocaleString()}`;
}

export function TenantCard({ propertyId, className }: TenantCardProps) {
  const { can } = useAppAuth();
  const canManage = can(PERMISSIONS.TENANTS_MANAGE);

  const {
    isLoading, isError, currentTenant, pastTenants, leaseStatus, deactivateTenant,
  } = useTenants(propertyId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Tenant | null>(null);
  const [endTarget, setEndTarget] = useState<Tenant | null>(null);

  const openAdd = () => {
    setEditTarget(null);
    setDialogOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditTarget(tenant);
    setDialogOpen(true);
  };

  const confirmEnd = () => {
    if (!endTarget) return;
    deactivateTenant.mutate(endTarget.id);
    setEndTarget(null);
  };

  if (isLoading) return <TenantCardSkeleton className={className} />;

  return (
    <Card className={className}>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
              Tenant
            </CardTitle>
            <CardDescription className="text-xs">
              Kept by your team. Tenants don't have accounts on the platform.
            </CardDescription>
          </div>
          {currentTenant && <LeaseBadge status={leaseStatus} />}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isError && (
          <p className="text-xs text-destructive">
            Couldn't load the tenant record for this property.
          </p>
        )}

        {!currentTenant ? (
          <div className="text-center py-6 rounded-xl border border-dashed border-border">
            <UserRound className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No tenant on record</p>
            <p className="text-xs text-muted-foreground mb-4">
              {canManage
                ? "Add one when the unit is let, to track the lease and deposit."
                : "Only an admin or manager can add a tenant."}
            </p>
            {canManage && (
              <Button variant="hero" size="sm" onClick={openAdd}>
                <UserPlus className="w-4 h-4" /> Add tenant
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading font-semibold text-foreground truncate">
                  {currentTenant.full_name}
                </p>
                {currentTenant.contact_phone ? (
                  <a
                    href={`tel:${currentTenant.contact_phone}`}
                    className="text-sm text-muted-foreground flex items-center gap-1.5 hover:text-foreground transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    {currentTenant.contact_phone}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 shrink-0" /> No phone recorded
                  </p>
                )}
              </div>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(currentTenant)}
                    aria-label="Edit tenant"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEndTarget(currentTenant)}
                    aria-label="End tenancy"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">End</span>
                  </Button>
                </div>
              )}
            </div>

            {currentTenant.contact_phone && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3 shrink-0" />
                This number is visible to your agency only.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
              <div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarRange className="w-3 h-3" /> Lease start
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(currentTenant.lease_start)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <CalendarRange className="w-3 h-3" /> Lease end
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formatDate(currentTenant.lease_end)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Deposit held
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formatMoney(currentTenant.deposit_held)}
                </p>
              </div>
            </div>

            {(leaseStatus.state === "expiring" || leaseStatus.state === "expired") && (
              <div className="flex items-start gap-2 rounded-xl bg-warning/10 border border-warning/20 p-3">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-foreground">
                  {leaseStatus.state === "expired"
                    ? "This lease has run out. Renew it or end the tenancy so the unit can go back on the market."
                    : "This lease ends soon. Agree a renewal now, or plan to re-list the unit."}
                </p>
              </div>
            )}
          </div>
        )}

        {pastTenants.length > 0 && (
          <div className="pt-3 border-t border-border space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-3 h-3" /> Previous tenants
            </p>
            <ul className="space-y-1.5">
              {pastTenants.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                >
                  <span className="truncate text-foreground">{t.full_name}</span>
                  <span className="shrink-0">
                    {formatDate(t.lease_start)} – {formatDate(t.lease_end)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {currentTenant && canManage && (
          <Button variant="outline" size="sm" className="w-full" onClick={openAdd}>
            <UserPlus className="w-4 h-4" /> Record a different tenant
          </Button>
        )}
      </CardContent>

      {canManage && (
        <TenantDialog
          propertyId={propertyId}
          tenant={editTarget}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}

      <AlertDialog open={!!endTarget} onOpenChange={(o) => !o && setEndTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this tenancy?</AlertDialogTitle>
            <AlertDialogDescription>
              {endTarget?.full_name} will be marked as a previous tenant. The record
              is kept for your history and any rent already logged stays intact.
              Remember to set the unit back to vacant if it's ready to re-list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmEnd}
              disabled={deactivateTenant.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deactivateTenant.isPending ? "Ending..." : "End tenancy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function TenantCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-52" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-28" />
          </div>
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
