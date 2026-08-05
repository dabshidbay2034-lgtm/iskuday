import { useAuth, useUser, useOrganization, useClerk } from '@clerk/clerk-react';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Permission, hasPermission, StaffRole } from '@/lib/permissions';
import type { UserRole } from '@/lib/types';

/**
 * Single source of auth truth for the app.
 *
 * Two distinct role concepts live here, and they are NOT interchangeable:
 *
 *  - `platformRole` — the marketplace-wide role (user / owner / agent / admin / …)
 *    stored in `public.user_roles`. This is the same table the `has_role()` RLS
 *    helper reads, so what the UI allows and what the database allows stay in
 *    agreement. Do not move this to Clerk publicMetadata without also rewriting
 *    has_role() — two sources of truth will silently disagree.
 *
 *    One role per user. user_roles.user_id is UNIQUE (migration
 *    20260805000003_fix_admin_services.sql); CompleteProfile, the webhook and
 *    the Admin panel all upsert/update a single row. has_role() and
 *    ProtectedRoute's allowedRoles assume that singular model.
 *
 *  - `orgRole` — the staff role inside the active agency (Clerk organization),
 *    which drives the per-permission checks in `can()`.
 */
// Most privileged first. Used only to pick the single role to report if a user
// somehow still has more than one row (legacy duplicates the migration dedupes,
// but we read defensively rather than with .maybeSingle()).
const PLATFORM_ROLE_PRECEDENCE: UserRole[] = [
  'admin', 'semi_admin', 'owner', 'hotel_manager', 'agent', 'user',
];

export function useAppAuth() {
  const { isLoaded: isAuthLoaded, isSignedIn, userId, has, getToken } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const { isLoaded: isOrgLoaded, organization, membership } = useOrganization();
  const { signOut } = useClerk();

  const clerkLoaded = isAuthLoaded && isUserLoaded && isOrgLoaded;

  // The role of the user in the currently active organization.
  const orgRole = (membership?.role as StaffRole) ?? null;

  const { data: platformRole, isPending: isRolePending } = useQuery({
    queryKey: ['user-role', userId],
    enabled: Boolean(clerkLoaded && isSignedIn && userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<UserRole | null> => {
      // Fetch WITHOUT .maybeSingle(). user_roles.user_id is UNIQUE, but rows
      // left paired by the old CompleteProfile bug could still be in the table
      // before the 20260805000003 dedup runs; .maybeSingle() THROWS on multiple
      // rows (PostgREST 406), which resolved the role to null and locked users
      // out of every role-gated page. Reading all rows and picking the most
      // privileged degrades gracefully instead.
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) throw error;
      if (!data || data.length === 0) return null;
      if (data.length === 1) return data[0].role as UserRole;
      return (
        PLATFORM_ROLE_PRECEDENCE.find((r) =>
          data.some((row) => (row.role as UserRole) === r),
        ) ?? (data[0].role as UserRole)
      );
    },
  });

  // Signed-in users aren't "loaded" until their platform role has resolved,
  // otherwise ProtectedRoute evaluates allowedRoles against an undefined role
  // and bounces the user before the answer arrives.
  const isLoaded = clerkLoaded && !(isSignedIn && isRolePending);

  const can = useCallback(
    (permission: Permission) => {
      if (!clerkLoaded || !isSignedIn) return false;

      // Clerk's native check first — it honours custom permissions configured
      // in the dashboard.
      if (has?.({ permission })) return true;

      // Fall back to the local role→permission map so the app still behaves
      // correctly before those custom permissions are set up in Clerk.
      return hasPermission(orgRole, permission);
    },
    [clerkLoaded, isSignedIn, has, orgRole],
  );

  const hasRole = useCallback((role: StaffRole) => orgRole === role, [orgRole]);

  const resolvedRole = platformRole ?? null;

  return {
    isLoaded,
    isSignedIn,
    userId,
    user,
    organization,
    orgId: organization?.id ?? null,
    orgSlug: organization?.slug ?? null,
    orgRole,
    platformRole: resolvedRole,
    /** @deprecated alias for `platformRole`, kept for existing call sites. */
    appRole: resolvedRole,
    can,
    hasRole,
    getToken,
    signOut,
  };
}
