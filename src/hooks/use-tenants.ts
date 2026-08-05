import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAppAuth } from "@/hooks/use-auth";

/**
 * Tenant records for a property.
 *
 * Per plan §8 D2 tenants DO NOT have logins — these are records maintained by
 * staff, never an account. There is no tenant portal and no tenant auth.
 *
 * `contact_phone` is org-private (plan §4). It may be rendered inside the
 * management UI only; it must never reach a public component, a marketplace
 * card or an inquiry response.
 *
 * Writes are gated on `PERMISSIONS.TENANTS_MANAGE` (Admin + Manager only —
 * Agents and Viewers cannot manage tenants, plan §5). RLS enforces it for real;
 * the UI checks are there so nobody is shown a control that will fail.
 *
 * The row shape comes straight from the generated Supabase types, so a schema
 * change surfaces here as a type error rather than as a runtime surprise.
 * `lease_start` / `lease_end` are DATE columns and arrive as `yyyy-mm-dd`.
 */

export type Tenant = Database["public"]["Tables"]["tenants"]["Row"];

const TENANT_COLUMNS =
  "id, org_id, property_id, full_name, contact_phone, lease_start, lease_end, deposit_held, is_active, created_at" as const;

export const tenantsKey = (propertyId?: string) => ["tenants", propertyId] as const;

// ── Validation ───────────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || ISO_DATE.test(v), "Enter a valid date.");

/**
 * The dialog keeps every field as a string (native inputs give us strings), so
 * the schema validates strings and `toTenantPayload` does the coercion. Keeping
 * both in this file means the form and the write agree on one definition.
 */
export const tenantFormSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, "Enter the tenant's full name.")
      .max(120, "Name is too long."),
    contact_phone: z
      .string()
      .trim()
      .max(32, "Phone number is too long.")
      .refine(
        (v) => v === "" || /^[0-9+()\s-]{7,}$/.test(v),
        "Enter a valid phone number, or leave it blank.",
      ),
    lease_start: optionalDate,
    lease_end: optionalDate,
    deposit_held: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0),
        "Deposit must be a number of zero or more.",
      ),
    is_active: z.boolean(),
  })
  .refine(
    (v) => !(v.lease_start && v.lease_end) || v.lease_end >= v.lease_start,
    { message: "The lease must end after it starts.", path: ["lease_end"] },
  );

export type TenantFormValues = z.infer<typeof tenantFormSchema>;

export const EMPTY_TENANT_FORM: TenantFormValues = {
  full_name: "",
  contact_phone: "",
  lease_start: "",
  lease_end: "",
  deposit_held: "",
  is_active: true,
};

/** Hydrate the form from an existing record. */
export function tenantToFormValues(tenant: Tenant): TenantFormValues {
  return {
    full_name: tenant.full_name ?? "",
    contact_phone: tenant.contact_phone ?? "",
    lease_start: tenant.lease_start ?? "",
    lease_end: tenant.lease_end ?? "",
    deposit_held: tenant.deposit_held === null || tenant.deposit_held === undefined
      ? ""
      : String(tenant.deposit_held),
    is_active: tenant.is_active ?? true,
  };
}

// ── Lease expiry ─────────────────────────────────────────────────────────────

/** Staff watch for leases running out — this is the window we warn inside. */
export const LEASE_EXPIRY_WARNING_DAYS = 30;

export type LeaseState =
  | "inactive"   // tenancy ended
  | "unknown"    // no end date recorded
  | "upcoming"   // lease hasn't started yet
  | "expired"    // end date is in the past
  | "expiring"   // ends within LEASE_EXPIRY_WARNING_DAYS
  | "active";

export interface LeaseStatus {
  state: LeaseState;
  /** Negative once the lease has run out. `null` when no end date is set. */
  daysRemaining: number | null;
  label: string;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between today and an ISO date, both normalised to local midnight. */
function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function getLeaseStatus(
  tenant: Pick<Tenant, "is_active" | "lease_start" | "lease_end"> | null | undefined,
): LeaseStatus {
  if (!tenant) return { state: "unknown", daysRemaining: null, label: "No tenant" };
  if (!tenant.is_active) {
    return { state: "inactive", daysRemaining: null, label: "Tenancy ended" };
  }

  if (tenant.lease_start && ISO_DATE.test(tenant.lease_start)) {
    const startsIn = daysUntil(tenant.lease_start);
    if (startsIn > 0) {
      return {
        state: "upcoming",
        daysRemaining: null,
        label: startsIn === 1 ? "Starts tomorrow" : `Starts in ${startsIn} days`,
      };
    }
  }

  if (!tenant.lease_end || !ISO_DATE.test(tenant.lease_end)) {
    return { state: "unknown", daysRemaining: null, label: "No lease end recorded" };
  }

  const days = daysUntil(tenant.lease_end);

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      state: "expired",
      daysRemaining: days,
      label: overdue === 1 ? "Expired yesterday" : `Expired ${overdue} days ago`,
    };
  }
  if (days <= LEASE_EXPIRY_WARNING_DAYS) {
    return {
      state: "expiring",
      daysRemaining: days,
      label:
        days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`,
    };
  }
  return { state: "active", daysRemaining: days, label: `${days} days remaining` };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface SaveTenantInput extends TenantFormValues {
  /** Omit to create, pass to update. */
  id?: string;
}

/** Strings in, database columns out. `deposit_held` is NOT NULL — blank is 0. */
function toTenantPayload(values: TenantFormValues) {
  return {
    full_name: values.full_name.trim(),
    contact_phone: values.contact_phone.trim() || null,
    lease_start: values.lease_start || null,
    lease_end: values.lease_end || null,
    deposit_held: values.deposit_held === "" ? 0 : Number(values.deposit_held),
    is_active: values.is_active,
  };
}

/**
 * Tenants for one property, plus the mutations that maintain them.
 *
 * Shaped like `useStaff()` — a single call returns the derived data and the
 * mutation handles, so the card and dialog stay declarative.
 */
export function useTenants(propertyId?: string) {
  const queryClient = useQueryClient();
  const { orgId } = useAppAuth();

  const query = useQuery({
    queryKey: tenantsKey(propertyId),
    enabled: Boolean(propertyId),
    queryFn: async (): Promise<Tenant[]> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(TENANT_COLUMNS)
        .eq("property_id", propertyId)
        .order("is_active", { ascending: false })
        .order("lease_start", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as Tenant[]) ?? [];
    },
  });

  const tenants = useMemo(() => query.data ?? [], [query.data]);

  /** One active tenancy at a time is the norm; the newest wins if data drifts. */
  const currentTenant = useMemo(
    () => tenants.find((t) => t.is_active) ?? null,
    [tenants],
  );

  const pastTenants = useMemo(() => tenants.filter((t) => !t.is_active), [tenants]);

  const leaseStatus = useMemo(() => getLeaseStatus(currentTenant), [currentTenant]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: tenantsKey(propertyId) });
  };

  const saveTenant = useMutation({
    mutationFn: async (input: SaveTenantInput): Promise<Tenant> => {
      if (!propertyId) throw new Error("No property selected.");

      const parsed = tenantFormSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Please check the tenant details.");
      }

      const payload = toTenantPayload(parsed.data);

      // `tenants.org_id` is NOT NULL — tenancies belong to an agency, so an
      // owner with no active organisation can't record one yet.
      if (!input.id && !orgId) {
        throw new Error(
          "Tenants are kept against an agency. Create or switch to your agency first.",
        );
      }

      const { data, error } = input.id
        ? await supabase
            .from("tenants")
            .update(payload)
            .eq("id", input.id)
            .select(TENANT_COLUMNS)
            .single()
        : await supabase
            .from("tenants")
            .insert({ ...payload, property_id: propertyId, org_id: orgId })
            .select(TENANT_COLUMNS)
            .single();

      if (error) throw error;
      const saved = data as Tenant;

      // One active tenancy per unit. Recording a new tenant ends the previous
      // one rather than leaving "who is in this unit?" ambiguous; the old row
      // survives as history.
      if (saved.is_active) {
        const { error: supersedeError } = await supabase
          .from("tenants")
          .update({ is_active: false })
          .eq("property_id", propertyId)
          .eq("is_active", true)
          .neq("id", saved.id);
        if (supersedeError) throw supersedeError;
      }

      return saved;
    },
    onSuccess: (tenant, input) => {
      invalidate();
      toast.success(input.id ? "Tenant details updated" : `${tenant.full_name} added as tenant`);
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to save tenant"),
  });

  /**
   * Deactivating keeps the history — we never delete a tenancy, because the
   * rent ledger references it.
   */
  const deactivateTenant = useMutation({
    mutationFn: async (tenantId: string) => {
      const { error } = await supabase
        .from("tenants")
        .update({ is_active: false })
        .eq("id", tenantId);
      if (error) throw error;
      return tenantId;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Tenancy ended — the record is kept for your history");
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to end tenancy"),
  });

  return {
    isLoading: query.isPending && Boolean(propertyId),
    isError: query.isError,
    error: query.error,
    tenants,
    currentTenant,
    pastTenants,
    leaseStatus,
    saveTenant,
    deactivateTenant,
  };
}
