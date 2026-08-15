import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError } from "@/hooks/use-rent";
import { HOTEL_ROLES, hotelMembersKey, type HotelRole } from "@/hooks/use-hotel-members";
import { myHotelsKey } from "@/hooks/use-hotels";

/**
 * Hotel invitations by EMAIL — the missing half of `hotel_members`.
 *
 * A membership row is keyed on a Clerk user id, which the person doing the
 * inviting does not have and cannot look up: you know your night manager's
 * email, not their `user_2abc…`. `hotel_invites` closes that gap. An admin
 * writes a pending row against an email address; when that person next signs
 * in, `accept_hotel_invites()` matches the address on their JWT and converts
 * every pending row into a real `hotel_members` row.
 *
 * This is deliberately NOT Clerk Organizations. A hotel team is per-hotel and
 * has no org context — the hotelier who invites a manager onto one property
 * must not thereby create an agency, and the manager must not gain anything
 * beyond that one hotel.
 *
 * Neither the table nor the RPCs are in the generated Supabase types until
 * `supabase gen types` runs, so both go through the loose accessors that
 * use-hotels.ts and use-hotel-staff.ts already use.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type HotelInvite = {
  id: string;
  hotelId: string;
  email: string;
  role: HotelRole;
  /** Task permissions carried into membership upon acceptance (20260830000001) */
  permissions: string[];
  invitedBy: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  acceptedAt: string | null;
  /**
   * The invite secret, and therefore the ONLY way to deliver an invitation.
   *
   * The JWT carries no `email` claim (verified against a live session), so
   * authorization is the token, not the address — the address is a label. RLS
   * only exposes this to a hotel admin, i.e. the person doing the inviting.
   * Without it on the client there is no way to hand someone an invite unless
   * the Resend pipeline is deployed, which would make this feature depend on
   * infrastructure that is not up yet.
   */
  token: string | null;
};

type RawHotelInvite = {
  id: string;
  hotel_id: string;
  email: string;
  role: string | null;
  permissions: string[] | null;
  invited_by: string | null;
  created_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  token: string | null;
};

/** The URL to hand someone. Most of this market receives it over WhatsApp. */
export function inviteJoinUrl(token: string | null | undefined): string | null {
  if (!token) return null;
  return `${window.location.origin}/join/${token}`;
}

function toInvite(row: RawHotelInvite): HotelInvite {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    email: row.email,
    // Same reasoning as use-hotel-members: the CHECK constraint guarantees one
    // of the four, and the fallback is the harmless one.
    role: (row.role as HotelRole) ?? "viewer",
    permissions: row.permissions ?? [],
    invitedBy: row.invited_by ?? null,
    createdAt: row.created_at ?? null,
    expiresAt: row.expires_at ?? null,
    acceptedAt: row.accepted_at ?? null,
    token: row.token ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (supabase as unknown as LooseClient).from(table);

const looseRpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(fn, args);

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Called WITHOUT a hotel id this must return a 2-element PREFIX, never
 * `["hotel-invites", undefined]`.
 *
 * TanStack matches partially by walking the filter key, so a third slot holding
 * `undefined` is compared against the live key's real id, mismatches, and
 * invalidates NOTHING — the mutation toasts success while the list keeps
 * showing the invite that was just revoked. This exact bug shipped in
 * use-hotel-staff.ts's payrollKey and had to be fixed there.
 */
export const hotelInvitesKey = (hotelId?: string) =>
  hotelId
    ? (["hotel-invites", "hotel", hotelId] as const)
    : (["hotel-invites"] as const);

/** Every hotel the caller can reach, via `my_hotel_ids()`. */
export const myHotelIdsKey = (userId?: string | null) =>
  userId ? (["hotel-ids", "mine", userId] as const) : (["hotel-ids", "mine"] as const);

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Pending invitations on this hotel.
 *
 * RLS shows the full list to the hotel's admins and only their own row to an
 * invitee, so — exactly like useHotelMembers — a short list here is not proof
 * that the list is short. Accepted rows are filtered out client-side so the
 * card only ever shows what is still outstanding.
 */
export function useHotelInvites(hotelId?: string) {
  const { isSignedIn } = useAppAuth();
  return useQuery({
    queryKey: hotelInvitesKey(hotelId),
    enabled: Boolean(hotelId && isSignedIn),
    queryFn: async (): Promise<HotelInvite[]> => {
      const { data, error } = await looseFrom("hotel_invites")
        .select("*")
        .eq("hotel_id", hotelId)
        .is("accepted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data as RawHotelInvite[]) ?? []).map(toInvite);
    },
  });
}

/**
 * The ids of every hotel the caller can reach — owned, via their agency, or via
 * a `hotel_members` row.
 *
 * An invited team member owns no properties, so their portfolio is empty and
 * nothing in `useMyHotels()` finds them. This RPC is the only thing that knows
 * they have somewhere to go.
 */
export function useMyHotelIds() {
  const { isSignedIn, userId } = useAppAuth();
  return useQuery({
    queryKey: myHotelIdsKey(userId),
    enabled: Boolean(isSignedIn && userId),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await looseRpc("my_hotel_ids");
      if (error) throw error;
      // A `setof uuid` comes back as bare strings, but PostgREST wraps scalar
      // set-returning functions in `{ my_hotel_ids: "…" }` on some versions.
      // Accept both rather than betting on one and shipping an empty list.
      return ((data as unknown[]) ?? [])
        .map((row) =>
          typeof row === "string"
            ? row
            : ((row as Record<string, unknown> | null)?.my_hotel_ids as string | undefined) ?? null,
        )
        .filter((id): id is string => Boolean(id));
    },
  });
}

// ── Errors ───────────────────────────────────────────────────────────────────

function describeInviteError(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (/duplicate key|hotel_invites_.*_key/i.test(message)) {
    return "That email already has a pending invitation to this hotel.";
  }
  if (/hotel_invites_role_check/i.test(message)) {
    return "That isn't a valid hotel role.";
  }
  if (/row-level security|violates row-level|permission denied/i.test(message)) {
    // More specific than the shared translator: the gate on this table is the
    // hotel's own admin list, not an agency role.
    return "Only a hotel admin or the hotel's owner can invite people.";
  }
  return describeWriteError(error, fallback);
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type HotelInviteInput = {
  email: string;
  role: HotelRole;
  /** Explicit task permissions beyond role defaults (optional). */
  permissions?: string[];
};

/** Invite someone onto this hotel's team by email address. */
export function useInviteToHotel(hotelId?: string) {
  const queryClient = useQueryClient();
  const { userId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: HotelInviteInput): Promise<HotelInvite> => {
      if (!hotelId) throw new Error("No hotel selected.");
      // Lower-cased on the way in because acceptance matches the address on the
      // JWT exactly — an invite typed as "Name@Example.com" would sit pending
      // forever against a session that reports "name@example.com".
      const email = input.email.trim().toLowerCase();
      if (!email) throw new Error("Enter an email address.");

      const { data, error } = await looseFrom("hotel_invites")
              .insert({
                hotel_id: hotelId,
                email,
                role: input.role,
                permissions: input.permissions ?? [],
                invited_by: userId ?? null,
              })
              .select("*")
              .single();
      if (error) throw error;
      return toInvite(data as RawHotelInvite);
    },
    onSuccess: (invite) => {
      toast.success(
        `${invite.email} invited as ${HOTEL_ROLES[invite.role].label.toLowerCase()}`,
      );
      queryClient.invalidateQueries({ queryKey: hotelInvitesKey(hotelId) });
    },
    onError: (error: unknown) =>
      toast.error(describeInviteError(error, "Couldn't send the invitation")),
  });
}

/** Withdraw a pending invitation. */
export function useRevokeHotelInvite(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inviteId: string): Promise<string> => {
      const { error } = await looseFrom("hotel_invites").delete().eq("id", inviteId);
      if (error) throw error;
      return inviteId;
    },
    onSuccess: () => {
      toast.success("Invitation revoked");
      queryClient.invalidateQueries({ queryKey: hotelInvitesKey(hotelId) });
    },
    onError: (error: unknown) =>
      toast.error(describeInviteError(error, "Couldn't revoke the invitation")),
  });
}

/**
 * Claim every pending invitation matching the signed-in user's email.
 *
 * Returns how many were claimed. Mounted once per session by
 * AcceptInvitesOnSignIn — this hook does no firing of its own, deliberately, so
 * the "when" stays in one component instead of being smeared across every
 * screen that happens to import it.
 */
export function useAcceptMyInvites() {
  const queryClient = useQueryClient();
  const { userId } = useAppAuth();

  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await looseRpc("accept_hotel_invites");
      if (error) throw error;
      return Number(data) || 0;
    },
    onSuccess: (count) => {
      if (count <= 0) return; // silent no-op: the common case is zero
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
      queryClient.invalidateQueries({ queryKey: myHotelIdsKey(userId) });
      queryClient.invalidateQueries({ queryKey: hotelMembersKey() });
      queryClient.invalidateQueries({ queryKey: hotelInvitesKey() });
    },
    // No toast on failure. This runs unprompted on sign-in, and a user who was
    // never invited to anything should not be shown an error about invitations
    // they don't know exist.
  });
}
