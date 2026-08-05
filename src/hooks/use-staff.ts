import { useMemo } from "react";
import {
  useOrganization,
  useOrganizationList,
  useUser,
} from "@clerk/clerk-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import type { StaffRole } from "@/lib/permissions";
import { STAFF_ROLES } from "@/lib/permissions";

/**
 * Thin wrapper around Clerk's organization hooks so Team.tsx and its subcomponents
 * stay declarative. Clerk owns auth + org state; this hook just normalizes the
 * membership/invitation shapes into the project's `StaffRole` vocabulary and
 * exposes mutation helpers with sonner toasts.
 *
 * Agencies === Clerk Organizations. The custom roles (`org:admin`, `org:manager`,
 * `org:agent`, `org:viewer`) are created in the Clerk dashboard (see
 * docs/CLERK_SETUP.md) and must match `STAFF_ROLES` exactly.
 */

export type StaffMember = {
  /** Clerk OrganizationMembership id */
  id: string;
  /** Clerk user id (TEXT in Postgres, e.g. "user_2abc...") */
  userId: string;
  fullName: string;
  /** Clerk username / identifier — shown when no full name is present */
  identifier: string;
  imageUrl?: string;
  role: StaffRole;
  createdAt?: Date;
  isCurrentUser: boolean;
};

export type StaffInvitation = {
  id: string;
  email: string;
  role: StaffRole;
  createdAt?: Date;
  status?: string;
  /** Clerk OrganizationInvitationResource — call .revoke() on it */
  _revoke?: () => Promise<unknown>;
};

/** Clerk exposes the org role as a string; narrow it to our StaffRole union. */
const STAFF_ROLE_VALUES = Object.values(STAFF_ROLES);
function isStaffRole(role: string | undefined | null): role is StaffRole {
  return !!role && (STAFF_ROLE_VALUES as readonly string[]).includes(role);
}

/**
 * `useStaff` reads the active organization's members + invitations and exposes
 * mutation helpers. Returns `hasOrg: false` when the user has no active org —
 * callers render the "Create your agency" empty state in that case.
 */
export function useStaff() {
  const { user } = useUser();
  const {
    isLoaded,
    organization,
    memberships,
    invitations,
  } = useOrganization({
    memberships: { pageSize: 100 },
    invitations: { pageSize: 100 },
  });

  const {
    createOrganization,
    setActive,
    userMemberships,
  } = useOrganizationList();

  const members = useMemo<StaffMember[]>(() => {
    if (!memberships?.data) return [];
    return memberships.data
      .filter((m) => isStaffRole(m.role))
      .map((m) => {
        const first = m.publicUserData?.firstName ?? "";
        const last = m.publicUserData?.lastName ?? "";
        const joined = [first, last].filter(Boolean).join(" ");
        return {
          id: m.id,
          userId: m.publicUserData?.userId ?? "",
          fullName: joined || m.publicUserData?.identifier || "Member",
          identifier: m.publicUserData?.identifier ?? "",
          imageUrl: m.publicUserData?.imageUrl ?? undefined,
          role: m.role as StaffRole,
          createdAt: m.createdAt,
          isCurrentUser: m.publicUserData?.userId === user?.id,
        };
      });
  }, [memberships, user?.id]);

  const invitationRecords = useMemo<StaffInvitation[]>(() => {
    if (!invitations?.data) return [];
    return invitations.data
      .filter((inv) => isStaffRole(inv.role))
      .map((inv) => ({
        id: inv.id,
        email: inv.emailAddress,
        role: inv.role as StaffRole,
        createdAt: inv.createdAt,
        status: inv.status,
        _revoke: () => inv.revoke(),
      }));
  }, [invitations]);

  const adminCount = useMemo(
    () => members.filter((m) => m.role === "org:admin").length,
    [members],
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  // Clerk keeps its own org cache in sync after these calls resolve, so the
  // useOrganization() lists re-render automatically — no manual invalidation.

  const inviteMember = useMutation({
    mutationFn: async (args: { emailAddress: string; role: StaffRole }) => {
      if (!organization) throw new Error("No active organization.");
      await organization.inviteMember(args);
      return args;
    },
    onSuccess: ({ emailAddress }) =>
      toast.success(`Invitation sent to ${emailAddress}`),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to send invitation"),
  });

  const updateMemberRole = useMutation({
    mutationFn: async (args: { userId: string; role: StaffRole }) => {
      if (!organization) throw new Error("No active organization.");
      await organization.updateMember(args);
      return args;
    },
    onSuccess: (_v, { role }) => toast.success(`Role updated to ${role}`),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to update role"),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      if (!organization) throw new Error("No active organization.");
      await organization.removeMember(userId);
      return userId;
    },
    onSuccess: () => toast.success("Member removed"),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to remove member"),
  });

  const revokeInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      // Look up the Clerk resource so we can call its .revoke() method.
      const inv = invitationRecords.find((i) => i.id === invitationId);
      if (!inv?._revoke) throw new Error("Invitation not found.");
      await inv._revoke();
      return invitationId;
    },
    onSuccess: () => toast.success("Invitation revoked"),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to revoke invitation"),
  });

  const createAgency = useMutation({
    mutationFn: async (args: { name: string }) => {
      if (!createOrganization) throw new Error("Organizations not enabled.");
      const created = await createOrganization(args);
      await setActive?.({ organization: created });
      return created;
    },
    onSuccess: (created) => toast.success(`Agency "${created.name}" created`),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to create agency"),
  });

  return {
    isLoaded,
    organization,
    hasOrg: !!organization,
    members,
    invitations: invitationRecords,
    adminCount,
    currentUserId: user?.id,
    // mutations
    inviteMember,
    updateMemberRole,
    removeMember,
    revokeInvitation,
    createAgency,
    // agency switching (for the empty state)
    setActive,
    userMemberships,
  };
}
