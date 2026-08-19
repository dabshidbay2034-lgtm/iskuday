import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { looseFrom } from "@/lib/supabase-loose";
import {
  describeWriteError,
  formatMoney,
  pmsDb,
  useErrorToast,
  useManageScope,
  type ManagedProperty,
} from "@/hooks/use-rent";

/**
 * Maintenance / work-order ticketing for a property (20260806000001).
 *
 * A job moves open → in_progress → resolved (or cancelled). Recording a job is
 * data entry, so the unit's staff (org agents or the assigned caretaker) can log
 * and update them, and everyone who can see the unit sees the queue.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `maintenance_requests` isn't in the generated types until `supabase gen
// types` runs against a database with the 20260806000001 migration applied, so
// this module reads/writes it through a loose accessor and narrows rows itself.

// ── Domain types ─────────────────────────────────────────────────────────────

export type MaintenanceStatus = "open" | "in_progress" | "resolved" | "cancelled";
export type MaintenanceCategory =
  | "plumbing"
  | "electrical"
  | "structural"
  | "appliance"
  | "cleaning"
  | "other";
export type MaintenancePriority = "low" | "medium" | "high" | "urgent";

export const MAINTENANCE_STATUSES: { value: MaintenanceStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "cancelled", label: "Cancelled" },
];

export const MAINTENANCE_CATEGORIES: { value: MaintenanceCategory; label: string }[] = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "structural", label: "Structural" },
  { value: "appliance", label: "Appliance" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
];

export const MAINTENANCE_PRIORITIES: { value: MaintenancePriority; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

export type MaintenanceRow = {
  id: string;
  propertyId: string;
  title: string;
  description: string | null;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  estimatedCost: number | null;
  actualCost: number | null;
  reportedBy: string | null;
  assignedTo: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

// ── Row mapper ───────────────────────────────────────────────────────────────

type RawMaintenance = {
  id: string;
  property_id: string;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  priority?: string | null;
  status?: string | null;
  estimated_cost?: number | null;
  actual_cost?: number | null;
  reported_by?: string | null;
  assigned_to?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
};

function toMaintenance(row: RawMaintenance): MaintenanceRow {
  return {
    id: row.id,
    propertyId: row.property_id,
    title: row.title ?? "Maintenance job",
    description: row.description ?? null,
    category: (row.category as MaintenanceCategory) ?? "other",
    priority: (row.priority as MaintenancePriority) ?? "medium",
    status: (row.status as MaintenanceStatus) ?? "open",
    estimatedCost: nullIfNum(row.estimated_cost),
    actualCost: nullIfNum(row.actual_cost),
    reportedBy: row.reported_by ?? null,
    assignedTo: row.assigned_to ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at ?? "",
  };
}

function nullIfNum(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

// ── Query ────────────────────────────────────────────────────────────────────

export const maintenanceKey = (propertyId?: string) =>
  ["manage", "maintenance", "property", propertyId] as const;

/** Maintenance jobs for one property, newest first. */
export function usePropertyMaintenance(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const propertyId = property?.id;

  const query = useQuery({
    queryKey: maintenanceKey(propertyId),
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<MaintenanceRow[]> => {
      const { data, error } = await looseFrom("maintenance_requests")
                .select("*")
                .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toMaintenance);
    },
  });

  useErrorToast(query.error, "Couldn't load maintenance jobs");

  const openCount = useMemo(
    () =>
      (query.data ?? []).filter((m) => m.status === "open" || m.status === "in_progress")
        .length,
    [query.data],
  );

  return { ...query, openCount };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type SaveMaintenanceInput = {
  id?: string;
  title: string;
  description?: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  estimatedCost: number | null;
  actualCost: number | null;
  assignedTo?: string | null;
};

/** Create or update a maintenance job. */
export function useSaveMaintenance(property?: ManagedProperty | null) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveMaintenanceInput) => {
      if (!property) throw new Error("No property selected.");

      const status = input.status;
      const payload = {
        property_id: property.id,
        org_id: orgId ?? null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        category: input.category,
        priority: input.priority,
        status,
        estimated_cost: input.estimatedCost,
        actual_cost: input.actualCost,
        assigned_to: input.assignedTo?.trim() || null,
        // Resolved/cancelled stamps resolved_at; reopening clears it.
        resolved_at:
          status === "resolved" || status === "cancelled"
            ? new Date().toISOString()
            : null,
      };

      const { error } = input.id
        ? await looseFrom("maintenance_requests").update(payload).eq("id", input.id)
        : await looseFrom("maintenance_requests").insert({ ...payload, reported_by: userId });

      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      toast.success(input.id ? "Maintenance job updated" : "Maintenance job logged");
      queryClient.invalidateQueries({ queryKey: maintenanceKey(property?.id) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't save the maintenance job")),
  });
}

/** Delete a maintenance job. Gated on org admin/manager or the unit owner in RLS. */
export function useDeleteMaintenance(property?: ManagedProperty | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await looseFrom("maintenance_requests").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Maintenance job removed");
      queryClient.invalidateQueries({ queryKey: maintenanceKey(property?.id) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't delete the maintenance job")),
  });
}

/** Re-export money formatter so the maintenance UI stays consistent. */
export { formatMoney };