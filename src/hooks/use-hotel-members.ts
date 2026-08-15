import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError } from "@/hooks/use-rent";

/**
 * Per-hotel access control (migration 20260810000001).
 *
 * A THIRD trust path next to "owner" and "agency staff": a `hotel_members` row
 * grants rights to ONE hotel and carries no organization context, so a hotelier
 * with no Clerk Organization can still hand the keys to a manager.
 *
 * The split that matters:
 *   • admin and agent both pass `hotel_managed()` in the database, so both can
 *     edit and publish the hotel's pages.
 *   • ONLY admin (plus the hotel owner and platform admins) passes
 *     `hotel_member_admin()`, which is what the write policies on this table
 *     are written against. An agent cannot promote themselves. The guards in
 *     this file mirror that rule client-side; the database is what enforces it.
 *
 * These roles are PER-HOTEL. They are not platform roles and grant nothing
 * outside the one hotel the row names — an `admin` here is not an admin of the
 * marketplace, and shares no vocabulary with `user_roles` or the Clerk org.
 *
 * `hotel_members` isn't in the generated Supabase types until `supabase gen
 * types` runs, so reads/writes go through the same loose accessor
 * use-hotels.ts uses.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type HotelRole = "admin" | "manager" | "agent" | "viewer";

/** Most privileged first — also the order the role picker renders in. */
export const HOTEL_ROLE_ORDER: HotelRole[] = ["admin", "manager", "agent", "viewer"];

export const HOTEL_ROLES: Record<HotelRole, { label: string; description: string }> = {
  admin: {
    label: "Admin",
    description: "Full control: manage the team, edit and publish every page, manage bookings, staff, and task permissions.",
  },
  manager: {
    label: "Manager",
    description: "Manages operations: list/edit/publish rooms, manage bookings, staff, housekeeping and respond to inquiries. Cannot change team membership.",
  },
  agent: {
    label: "Agent",
    description: "Create and edit listings, publish rooms, respond to inquiries. Cannot manage staff, payroll or team membership.",
  },
  viewer: {
    label: "Viewer",
    description: "Can see the hotel's pages and data, including unpublished drafts. Cannot change anything.",
  },
};

export type HotelMember = {
  hotelId: string;
  /** Clerk user id. */
  userId: string;
  role: HotelRole;
  /** Explicit task permission grants beyond role defaults (e.g. ["list", "edit"]) */
  permissions: string[];
  invitedBy: string | null;
  createdAt: string | null;
};

type RawHotelMember = {
  hotel_id: string;
  user_id: string;
  role: string | null;
  permissions: string[] | null;
  invited_by: string | null;
  created_at: string | null;
};

function toHotelMember(row: RawHotelMember): HotelMember {
  return {
    hotelId: row.hotel_id,
    userId: row.user_id,
    // The DB CHECK constraint guarantees one of the four; the fallback only
    // matters if a future role is added to the constraint before this file.
    role: (row.role as HotelRole) ?? "viewer",
    permissions: row.permissions ?? [],
    invitedBy: row.invited_by ?? null,
    createdAt: row.created_at ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (supabase as unknown as LooseClient).from(table);

// ── Task permission catalog ──────────────────────────────────────────────────

export const HOTEL_TASKS = {
  list:        "list"        as const,
  edit:        "edit"        as const,
  publish:     "publish"     as const,
  bookings:    "bookings"    as const,
  inquiries:   "inquiries"   as const,
  staff:       "staff"       as const,
  housekeeping:"housekeeping"as const,
} as const;

export type HotelTask = (typeof HOTEL_TASKS)[keyof typeof HOTEL_TASKS];

export const HOTEL_TASK_LABELS: Record<HotelTask, string> = {
  [HOTEL_TASKS.list]:        "List new rooms / properties",
  [HOTEL_TASKS.edit]:        "Edit pages & listings",
  [HOTEL_TASKS.publish]:     "Publish / unpublish",
  [HOTEL_TASKS.bookings]:    "Manage bookings & front desk",
  [HOTEL_TASKS.inquiries]:   "Respond to inquiries",
  [HOTEL_TASKS.staff]:       "Manage staff & payroll",
  [HOTEL_TASKS.housekeeping]: "Manage housekeeping tasks",
};

/** Default task set each role implies. Keep in sync with the SQL helper hotel_member_allowed. */
export const HOTEL_ROLE_DEFAULT_TASKS: Record<HotelRole, HotelTask[]> = {
  admin:       Object.values(HOTEL_TASKS), // everything
  manager:     ["list", "edit", "publish", "bookings", "inquiries", "staff", "housekeeping"],
  agent:       ["list", "edit", "publish", "inquiries"],
  viewer:      [],
};

/**
 * Whether a member is allowed to do a given task.
 *
 * TRUE if the task is in the role's default set OR in the member's explicit
 * `permissions` array.
 */
export function hotelMemberCan(
  member: HotelMember | null | undefined,
  task: HotelTask,
): boolean {
  if (!member) return false;
  const defs = HOTEL_ROLE_DEFAULT_TASKS[member.role];
  if (defs && defs.includes(task)) return true;
  return member.permissions.includes(task);
}

// ── Role helpers ─────────────────────────────────────────────────────────────

/** Matches the `hotel_managed()` membership branch: admin, manager and agent can write. */
export function hotelRoleCanEdit(role: HotelRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "agent";
}

/** Matches `hotel_member_admin()`: only an admin may change membership. */
export function hotelRoleCanManageMembers(role: HotelRole | null | undefined): boolean {
  return role === "admin";
}

export function countHotelAdmins(members: HotelMember[] | undefined): number {
  return (members ?? []).filter((m) => m.role === "admin").length;
}

/** What tasks a member is explicitly granted beyond their role default. */
export function hotelMemberExtraTasks(member: HotelMember): HotelTask[] {
  const defaults = HOTEL_ROLE_DEFAULT_TASKS[member.role];
  return member.permissions.filter((t): t is HotelTask =>
    !defaults.includes(t as HotelTask) && t in HOTEL_TASKS
  );
}

/**
 * Last-admin guards, same semantics as src/components/team/members-table.tsx:
 * never demote your own admin role, and never leave the hotel with zero admins.
 *
 * Note the asymmetry with an agency: a hotel always has an owner who passes
 * `hotel_member_admin()` regardless of membership, so a hotel with no admin row
 * is recoverable. The guard still holds — an admin who demotes themselves by
 * accident loses the members screen until the owner comes back, which for a
 * delegated hotel can be days.
 */
export function canChangeHotelRole(
  members: HotelMember[] | undefined,
  member: HotelMember,
  target: HotelRole,
  currentUserId?: string | null,
): boolean {
  if (member.role !== "admin" || target === "admin") return true;
  if (member.userId === currentUserId) return false;
  return countHotelAdmins(members) > 1;
}

export function canRemoveHotelMember(
  members: HotelMember[] | undefined,
  member: HotelMember,
  currentUserId?: string | null,
): boolean {
  if (member.userId === currentUserId) return false; // never remove yourself here
  if (member.role === "admin" && countHotelAdmins(members) <= 1) return false;
  return true;
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Called WITHOUT a hotel id this returns a 1-element PREFIX that matches every
 * hotel's member list (and, being a prefix of it, every myHotelRoleKey too).
 *
 * `["hotel-members", undefined]` would NOT do that: TanStack compares the
 * filter key slot by slot, `undefined` fails the type check against a real id,
 * and the invalidation silently matches nothing.
 */
export const hotelMembersKey = (hotelId?: string) =>
  hotelId ? (["hotel-members", hotelId] as const) : (["hotel-members"] as const);
export const myHotelRoleKey = (hotelId?: string, userId?: string | null) =>
  ["hotel-members", hotelId, "me", userId] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Everyone with a membership row on this hotel.
 *
 * RLS returns the full list to anyone who manages the hotel and just your own
 * row otherwise — so a viewer sees a one-entry list rather than an error, and
 * the caller must not assume this is the whole list unless the user can manage
 * members.
 */
export function useHotelMembers(hotelId?: string) {
  return useQuery({
    queryKey: hotelMembersKey(hotelId),
    enabled: Boolean(hotelId),
    queryFn: async (): Promise<HotelMember[]> => {
      const { data, error } = await looseFrom("hotel_members")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data as RawHotelMember[]) ?? []).map(toHotelMember);
    },
  });
}

/**
 * The signed-in user's own role on this hotel, or null when they have no
 * membership row.
 *
 * null does NOT mean "no access": the owner, their agency staff and platform
 * admins all manage the hotel without a membership row. Use this to decide what
 * the MEMBERSHIP ui offers, not whether the user can edit.
 */
export function useMyHotelRole(hotelId?: string) {
  const { isSignedIn, userId } = useAppAuth();
  return useQuery({
    queryKey: myHotelRoleKey(hotelId, userId),
    enabled: Boolean(hotelId && isSignedIn && userId),
    queryFn: async (): Promise<HotelRole | null> => {
      const { data, error } = await looseFrom("hotel_members")
        .select("role")
        .eq("hotel_id", hotelId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data ? ((data.role as HotelRole) ?? null) : null;
    },
  });
}

// ── Errors ───────────────────────────────────────────────────────────────────

function describeMemberError(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (/hotel_members_pkey|duplicate key/i.test(message)) {
    return "That person already has access to this hotel. Change their role instead.";
  }
  if (/hotel_members_role_check/i.test(message)) {
    return "That isn't a valid hotel role.";
  }
  if (/row-level security|violates row-level|permission denied/i.test(message)) {
    // More specific than the shared translator: on this table the gate is the
    // hotel's own admin list, not an agency role.
    return "Only a hotel admin or the hotel's owner can change who has access.";
  }
  return describeWriteError(error, fallback);
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type AddHotelMemberInput = {
  /** Clerk user id of the person being given access. */
  userId: string;
  role: HotelRole;
};

/** Give a Clerk user a role on this hotel. */
export function useAddHotelMember(hotelId?: string) {
  const queryClient = useQueryClient();
  const { userId: currentUserId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: AddHotelMemberInput): Promise<HotelMember> => {
      if (!hotelId) throw new Error("No hotel selected.");
      const invitee = input.userId.trim();
      if (!invitee) throw new Error("Enter the user's id.");

      const { data, error } = await looseFrom("hotel_members")
        .insert({
          hotel_id: hotelId,
          user_id: invitee,
          role: input.role,
          invited_by: currentUserId ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toHotelMember(data as RawHotelMember);
    },
    onSuccess: (member) => {
      toast.success(`Access granted as ${HOTEL_ROLES[member.role].label.toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: hotelMembersKey(hotelId) });
      queryClient.invalidateQueries({ queryKey: myHotelRoleKey(hotelId, member.userId) });
    },
    onError: (error: unknown) =>
      toast.error(describeMemberError(error, "Couldn't grant access")),
  });
}

/**
 * Change someone's role.
 *
 * The last-admin guard is repeated here rather than left to the UI: a screen
 * that forgets to disable the option would otherwise be one click away from a
 * hotel whose only admin is a viewer. The database cannot express "keep at
 * least one admin" in a policy, so this is the only place it can live.
 */
export function useUpdateHotelMemberRole(hotelId?: string) {
  const queryClient = useQueryClient();
  const { userId: currentUserId } = useAppAuth();
  const { data: members } = useHotelMembers(hotelId);

  return useMutation({
    mutationFn: async (args: { userId: string; role: HotelRole }): Promise<HotelMember> => {
      if (!hotelId) throw new Error("No hotel selected.");
      const member = (members ?? []).find((m) => m.userId === args.userId);
      if (member && !canChangeHotelRole(members, member, args.role, currentUserId)) {
        throw new Error(
          member.userId === currentUserId
            ? "You can't remove your own admin role. Ask another admin to do it."
            : "This hotel needs at least one admin. Promote someone else first.",
        );
      }

      const { data, error } = await looseFrom("hotel_members")
        .update({ role: args.role })
        .eq("hotel_id", hotelId)
        .eq("user_id", args.userId)
        .select("*")
        .single();
      if (error) throw error;
      return toHotelMember(data as RawHotelMember);
    },
    onSuccess: (member) => {
      toast.success(`Role changed to ${HOTEL_ROLES[member.role].label.toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: hotelMembersKey(hotelId) });
      queryClient.invalidateQueries({ queryKey: myHotelRoleKey(hotelId, member.userId) });
    },
    onError: (error: unknown) =>
      toast.error(describeMemberError(error, "Couldn't change the role")),
  });
}

/** Revoke someone's access. Same last-admin guard as the role change. */
export function useRemoveHotelMember(hotelId?: string) {
  const queryClient = useQueryClient();
  const { userId: currentUserId } = useAppAuth();
  const { data: members } = useHotelMembers(hotelId);

  return useMutation({
    mutationFn: async (memberUserId: string): Promise<string> => {
      if (!hotelId) throw new Error("No hotel selected.");
      const member = (members ?? []).find((m) => m.userId === memberUserId);
      if (member && !canRemoveHotelMember(members, member, currentUserId)) {
        throw new Error(
          member.userId === currentUserId
            ? "You can't remove your own access. Ask another admin to do it."
            : "This hotel needs at least one admin. Promote someone else first.",
        );
      }

      const { error } = await looseFrom("hotel_members")
        .delete()
        .eq("hotel_id", hotelId)
        .eq("user_id", memberUserId);
      if (error) throw error;
      return memberUserId;
    },
    onSuccess: (memberUserId) => {
      toast.success("Access removed");
      queryClient.invalidateQueries({ queryKey: hotelMembersKey(hotelId) });
      queryClient.invalidateQueries({ queryKey: myHotelRoleKey(hotelId, memberUserId) });
    },
    onError: (error: unknown) =>
      toast.error(describeMemberError(error, "Couldn't remove access")),
  });
}
