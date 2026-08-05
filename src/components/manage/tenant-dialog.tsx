import { useEffect, useMemo, useState } from "react";
import { Lock, UserPlus } from "lucide-react";

import {
  EMPTY_TENANT_FORM,
  getLeaseStatus,
  tenantFormSchema,
  tenantToFormValues,
  useTenants,
  type Tenant,
  type TenantFormValues,
} from "@/hooks/use-tenants";
import { useAppAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/permissions";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Add / edit a tenant record.
 *
 * Fully controlled — `tenant-card.tsx` owns `open`. Pass `tenant` to edit,
 * omit it to add.
 *
 * Gated on PERMISSIONS.TENANTS_MANAGE: Admin and Manager only. Agents and
 * Viewers must never reach this dialog (plan §5), so it refuses to render for
 * them even if a caller forgets the check.
 *
 * Per plan §8 D2 this creates a *record*, not an account — there is no invite,
 * no email, no tenant login anywhere in this flow.
 */

type FieldErrors = Partial<Record<keyof TenantFormValues, string>>;

interface TenantDialogProps {
  propertyId: string;
  /** Existing record to edit; omit or pass null to add a new tenant. */
  tenant?: Tenant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TenantDialog({ propertyId, tenant, open, onOpenChange }: TenantDialogProps) {
  const { can } = useAppAuth();
  const canManage = can(PERMISSIONS.TENANTS_MANAGE);

  const { saveTenant } = useTenants(propertyId);
  const [values, setValues] = useState<TenantFormValues>(EMPTY_TENANT_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isEditing = Boolean(tenant?.id);

  // Reset the form each time the dialog opens so a cancelled edit doesn't leak
  // into the next add.
  useEffect(() => {
    if (!open) return;
    setValues(tenant ? tenantToFormValues(tenant) : EMPTY_TENANT_FORM);
    setErrors({});
  }, [open, tenant]);

  const setField = <K extends keyof TenantFormValues>(key: K, value: TenantFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /** Live preview of what staff will see on the card once this is saved. */
  const previewStatus = useMemo(
    () =>
      getLeaseStatus({
        is_active: values.is_active,
        lease_start: values.lease_start || null,
        lease_end: values.lease_end || null,
      }),
    [values.is_active, values.lease_start, values.lease_end],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = tenantFormSchema.safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof TenantFormValues | undefined;
        if (field && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }

    saveTenant.mutate(
      { ...parsed.data, id: tenant?.id },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  if (!canManage) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            {isEditing ? "Edit tenant" : "Add a tenant"}
          </DialogTitle>
          <DialogDescription>
            A record kept by your team — tenants don't get an account or a login.
            Mark the unit occupied separately so it leaves the marketplace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenant-name" className="text-xs text-muted-foreground">
              Full name
            </Label>
            <Input
              id="tenant-name"
              value={values.full_name}
              onChange={(e) => setField("full_name", e.target.value)}
              placeholder="e.g. Aisha Warsame"
              className="h-11 rounded-xl"
              aria-invalid={!!errors.full_name}
            />
            {errors.full_name && (
              <p className="text-xs text-destructive">{errors.full_name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenant-phone" className="text-xs text-muted-foreground">
              Contact phone
            </Label>
            <Input
              id="tenant-phone"
              type="tel"
              inputMode="tel"
              value={values.contact_phone}
              onChange={(e) => setField("contact_phone", e.target.value)}
              placeholder="+252 61 000 0000"
              className="h-11 rounded-xl"
              aria-invalid={!!errors.contact_phone}
            />
            {errors.contact_phone ? (
              <p className="text-xs text-destructive">{errors.contact_phone}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Visible to your agency only — never shown on the public site.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lease-start" className="text-xs text-muted-foreground">
                Lease start
              </Label>
              <Input
                id="lease-start"
                type="date"
                value={values.lease_start}
                onChange={(e) => setField("lease_start", e.target.value)}
                className="h-11 rounded-xl"
                aria-invalid={!!errors.lease_start}
              />
              {errors.lease_start && (
                <p className="text-xs text-destructive">{errors.lease_start}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lease-end" className="text-xs text-muted-foreground">
                Lease end
              </Label>
              <Input
                id="lease-end"
                type="date"
                value={values.lease_end}
                min={values.lease_start || undefined}
                onChange={(e) => setField("lease_end", e.target.value)}
                className="h-11 rounded-xl"
                aria-invalid={!!errors.lease_end}
              />
              {errors.lease_end && (
                <p className="text-xs text-destructive">{errors.lease_end}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit-held" className="text-xs text-muted-foreground">
              Deposit held ($)
            </Label>
            <Input
              id="deposit-held"
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={values.deposit_held}
              onChange={(e) => setField("deposit_held", e.target.value)}
              placeholder="0"
              className="h-11 rounded-xl"
              aria-invalid={!!errors.deposit_held}
            />
            {errors.deposit_held ? (
              <p className="text-xs text-destructive">{errors.deposit_held}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                What you're holding for this tenant. The platform never collects it.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 p-3">
            <div className="min-w-0">
              <Label htmlFor="tenant-active" className="text-sm text-foreground">
                Current tenant
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Turn off to keep the record as history without an active tenancy.
              </p>
            </div>
            <Switch
              id="tenant-active"
              checked={values.is_active}
              onCheckedChange={(v) => setField("is_active", v)}
            />
          </div>

          {/* Plain text rather than the card's badge — tenant-card imports this
              dialog, so importing back the other way would be a cycle. */}
          {values.is_active && (values.lease_start || values.lease_end) && (
            <p className="text-[11px] text-muted-foreground">
              Lease status:{" "}
              <span
                className={
                  previewStatus.state === "expired" || previewStatus.state === "expiring"
                    ? "text-warning font-medium"
                    : "text-foreground font-medium"
                }
              >
                {previewStatus.label}
              </span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="hero" disabled={saveTenant.isPending}>
              {saveTenant.isPending
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Add tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
