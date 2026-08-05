import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAppAuth } from '@/hooks/use-auth';
import { PERMISSIONS, STAFF_ROLES } from '@/lib/permissions';

const state = vi.hoisted(() => ({
  isSignedIn: true,
  userId: 'user_2abcDEF' as string | null,
  orgRole: null as string | null,
  organization: null as { id: string; slug: string } | null,
  clerkHasResult: false,
  // user_roles.user_id is UNIQUE (one role per user), but legacy duplicate
  // rows from the old CompleteProfile bug are mocked here as an array so the
  // regression tests can prove the hook degrades gracefully on >1 row.
  roleRows: [] as { role: string }[],
}));

const maybeSingle = vi.hoisted(() => vi.fn());
const eqSpy = vi.hoisted(() => vi.fn());
const fromSpy = vi.hoisted(() => vi.fn());

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: state.isSignedIn,
    userId: state.userId,
    has: () => state.clerkHasResult,
    getToken: vi.fn(),
  }),
  useUser: () => ({
    isLoaded: true,
    // Deliberately populated with a conflicting role: the hook must ignore it
    // and trust the database instead.
    user: { id: state.userId, publicMetadata: { role: 'admin' } },
  }),
  useOrganization: () => ({
    isLoaded: true,
    organization: state.organization,
    membership: state.orgRole ? { role: state.orgRole } : null,
  }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      fromSpy(table);
      return {
        select: () => ({
          // The query terminates at .eq() and is awaited directly — no
          // .maybeSingle(), because that throws when a user holds more than
          // one role. `maybeSingle` is reused here purely as the controllable
          // promise the tests drive.
          eq: (col: string, val: unknown) => {
            eqSpy(col, val);
            return maybeSingle();
          },
        }),
      };
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.isSignedIn = true;
  state.userId = 'user_2abcDEF';
  state.orgRole = null;
  state.organization = null;
  state.clerkHasResult = false;
  state.roleRows = [];

  fromSpy.mockClear();
  eqSpy.mockClear();
  maybeSingle.mockReset();
  maybeSingle.mockImplementation(async () => ({
    data: state.roleRows,
    error: null,
  }));
});

describe('useAppAuth', () => {
  it('reads the platform role from public.user_roles, not Clerk metadata', async () => {
    state.roleRows = [{ role: 'owner' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // publicMetadata says 'admin'; the database says 'owner'. Database wins,
    // because that is the same table the has_role() RLS helper reads.
    expect(result.current.platformRole).toBe('owner');
    expect(fromSpy).toHaveBeenCalledWith('user_roles');
  });

  it('queries user_roles keyed on the Clerk user id', async () => {
    state.roleRows = [{ role: 'agent' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'user_2abcDEF');
  });

  it('keeps appRole as an alias of platformRole', async () => {
    state.roleRows = [{ role: 'admin' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.appRole).toBe(result.current.platformRole);
  });

  it('reports null rather than a default role when the user has no row', async () => {
    state.roleRows = [];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.platformRole).toBeNull();
  });

  // Regression: this lookup used to call maybeSingle(), which throws on a
  // second row. A user who somehow ended up with two role rows (the old
  // CompleteProfile bug, since fixed by making user_id UNIQUE) therefore lost
  // all access instead of keeping the highest. The hook now reads every row
  // and reports the most privileged, never throwing.
  it('does not throw when more than one role row exists', async () => {
    state.roleRows = [{ role: 'owner' }, { role: 'admin' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.platformRole).toBe('admin');
  });

  it('reports the most privileged role as the primary one', async () => {
    // Row order from Postgres is not guaranteed, so the primary role must come
    // from an explicit precedence list, not from whichever row arrived first.
    state.roleRows = [{ role: 'owner' }, { role: 'admin' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.platformRole).toBe('admin');
  });

  it('honours an allowedRoles check against the resolved role', async () => {
    state.roleRows = [{ role: 'hotel_manager' }];
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    const role = result.current.platformRole;
    expect(['hotel_manager', 'user'].includes(role ?? '')).toBe(true);
    expect(['owner'].includes(role ?? '')).toBe(false);
  });

  it('is not "loaded" until the role query resolves', async () => {
    let release: (v: unknown) => void = () => {};
    maybeSingle.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const { result } = renderHook(() => useAppAuth(), { wrapper });

    // Guard against ProtectedRoute evaluating allowedRoles too early and
    // bouncing a legitimate owner mid-flight.
    expect(result.current.isLoaded).toBe(false);

    release({ data: [{ role: 'owner' }], error: null });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.platformRole).toBe('owner');
  });

  it('does not query user_roles for signed-out visitors', async () => {
    state.isSignedIn = false;
    state.userId = null;
    const { result } = renderHook(() => useAppAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(fromSpy).not.toHaveBeenCalled();
    expect(result.current.platformRole).toBeNull();
  });

  it('falls back to the local role map when Clerk has() says no', async () => {
    state.clerkHasResult = false;
    state.orgRole = STAFF_ROLES.MANAGER;
    state.organization = { id: 'org_1', slug: 'acme' };

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.can(PERMISSIONS.STAFF_INVITE)).toBe(true);
    expect(result.current.can(PERMISSIONS.STAFF_MANAGE)).toBe(false);
    expect(result.current.can(PERMISSIONS.BILLING_MANAGE)).toBe(false);
  });

  it('honours Clerk custom permissions when has() says yes', async () => {
    state.clerkHasResult = true;
    state.orgRole = STAFF_ROLES.VIEWER;
    state.organization = { id: 'org_1', slug: 'acme' };

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    // Viewer grants nothing locally, but Clerk is authoritative when it allows.
    expect(result.current.can(PERMISSIONS.BILLING_MANAGE)).toBe(true);
  });

  it('grants no permissions to signed-out visitors', async () => {
    state.isSignedIn = false;
    state.userId = null;
    state.clerkHasResult = true;

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.can(PERMISSIONS.PROPERTY_CREATE)).toBe(false);
  });

  it('exposes the active organization id, slug and role', async () => {
    state.organization = { id: 'org_42', slug: 'mogadishu-homes' };
    state.orgRole = STAFF_ROLES.ADMIN;

    const { result } = renderHook(() => useAppAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.orgId).toBe('org_42');
    expect(result.current.orgSlug).toBe('mogadishu-homes');
    expect(result.current.orgRole).toBe(STAFF_ROLES.ADMIN);
    expect(result.current.hasRole(STAFF_ROLES.ADMIN)).toBe(true);
    expect(result.current.hasRole(STAFF_ROLES.VIEWER)).toBe(false);
  });

  it('returns null org fields when no agency is active', async () => {
    const { result } = renderHook(() => useAppAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.orgId).toBeNull();
    expect(result.current.orgSlug).toBeNull();
    expect(result.current.orgRole).toBeNull();
  });
});
