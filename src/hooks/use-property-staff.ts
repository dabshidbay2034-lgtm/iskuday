import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import {
  describeWriteError,
  pmsDb,
  useErrorToast,
  useManageScope,
  type ManagedProperty,
} from "@/hooks/use-rent";

/**
 * Per-property staff roster (20260806000001).
 *
 * A unit's own caretaker/supervisor. Being assigned to a property is what lets a
 * member — often with no Clerk organisation of their own — open and manage that
 * one unit's profile (expenses, maintenance, leases, and read access to rent and
 * utility records via the RLS branches in the migration).
 *
 * Assigning is a manager-level action (org admin/manager) or the unit owner's
 * own to take on their unit.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `property_staff` isn't in the generated types until `supabase gen types` runs
// against a database with the 20260806000001 migration applied, so this module
// reads/writes it through a loose accessor and narrows rows itself.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (pmsDb as unknown as LooseClient).from(table);

export type PropertyStaffMember = {
  propertyId: string;
  userId: string;
  role: string | null;
  createdAt: string;
};

type RawStaffRow = {
  property_id: string;
  user_id: string;
  role?: string | null;
  created_at?: string | null;
};

function toStaffMember(row: RawStaffRow): PropertyStaffMember {
  return {
    propertyId: row.property_id,
    userId: row.user_id,
    role: row.role ?? null,
    createdAt: row.created_at ?? "",
  };
}

export const propertyStaffKey = (propertyId?: string) =>
  ["manage", "property-staff", propertyId] as const;

/** The staff assigned to one unit. */
export function usePropertyStaff(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const propertyId = property?.id;

  const query = useQuery({
    queryKey: propertyStaffKey(propertyId),
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<PropertyStaffMember[]> => {
      const { data, error } = await looseFrom("property_staff")
                .select("*")
                .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toStaffMember);
    },
  });

  useErrorToast(query.error, "Couldn't load the property staff");
  return query;
}

/** Assign a user to manage this unit. */
export function useAddPropertyStaff(property?: ManagedProperty | null) {
  const { orgId } = useAppAuth();
  const queryClient = useQueryClient();
  const propertyId = property?.id;

  return useMutation({
    mutationFn: async (input: { userId: string; role?: string }) => {
      if (!propertyId) throw new Error("No property selected.");
      if (!input.userId.trim()) throw new Error("Enter a staff member to assign.");

      const { error } = await looseFrom("property_staff").upsert(
        {
          property_id: propertyId,
          user_id: input.userId.trim(),
          org_id: orgId ?? null,
          role: input.role?.trim() || null,
        },
        { onConflict: "property_id,user_id" },
      );
      if (error) throw error;
      return input;
    },
    onSuccess: () => {
      toast.success("Staff member assigned to this property");
      queryClient.invalidateQueries({ queryKey: propertyStaffKey(propertyId) });
      // Their portfolio must include this unit now, if it didn't before.
      queryClient.invalidateQueries({ queryKey: ["manage", "properties"] });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't assign staff")),
  });
}

/** Remove a user's assignment to this unit. */
export function useRemovePropertyStaff(property?: ManagedProperty | null) {
  const queryClient = useQueryClient();
  const propertyId = property?.id;

  return useMutation({
    mutationFn: async (userId: string) => {
      if (!propertyId) throw new Error("No property selected.");
      const { error } = await looseFrom("property_staff")
        .delete()
        .eq("property_id", propertyId)
        .eq("user_id", userId);
      if (error) throw error;
      return userId;
    },
    onSuccess: () => {
      toast.success("Staff member unassigned");
      queryClient.invalidateQueries({ queryKey: propertyStaffKey(propertyId) });
      queryClient.invalidateQueries({ queryKey: ["manage", "properties"] });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't unassign staff")),
  });
}