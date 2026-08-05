import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import { PERMISSIONS } from '@/lib/permissions';

const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const useAppAuth = vi.fn();
vi.mock('@/hooks/use-auth', () => ({ useAppAuth: () => useAppAuth() }));

/**
 * Signed-in user with no agency and no permissions, unless overridden.
 *
 * Pass `platformRole` (a single string) — one role per user (user_id is UNIQUE).
 * The single-role model is what ProtectedRoute and has_role() both use.
 */
function auth(overrides: Record<string, unknown> = {}) {
  const base = {
    isLoaded: true,
    isSignedIn: true,
    platformRole: null as string | null,
    organization: null,
    can: () => false,
    ...overrides,
  };

  return {
    ...base,
    appRole: base.platformRole,
  };
}

function renderGuard(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ProtectedRoute {...props}>
        <div>secret content</div>
      </ProtectedRoute>
    </MemoryRouter>,
  );
}

const shown = () => screen.queryByText('secret content') !== null;

beforeEach(() => {
  navigate.mockClear();
  useAppAuth.mockReset();
});

describe('ProtectedRoute', () => {
  it('hides children and does not redirect while auth is still loading', () => {
    useAppAuth.mockReturnValue(auth({ isLoaded: false }));
    renderGuard();

    expect(shown()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends signed-out visitors to /signin', () => {
    useAppAuth.mockReturnValue(auth({ isSignedIn: false }));
    renderGuard();

    expect(shown()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/signin');
  });

  it('renders children for any signed-in user when no role is required', () => {
    useAppAuth.mockReturnValue(auth());
    renderGuard();

    expect(shown()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Regression: platform role used to be read from Clerk publicMetadata, which
  // nothing ever populates, so it was always 'user' and every one of these
  // routes bounced its own owners and admins to the home page.
  it.each([
    ['owner', ['owner', 'agent'], true],
    ['agent', ['owner', 'agent'], true],
    ['hotel_manager', ['owner', 'agent', 'hotel_manager'], true],
    ['admin', ['admin'], true],
    ['semi_admin', ['semi_admin', 'admin'], true],
    ['user', ['owner', 'agent'], false],
    ['user', ['admin'], false],
    ['agent', ['admin'], false],
  ])('role %s against %j renders: %s', (role, allowed, expected) => {
    useAppAuth.mockReturnValue(auth({ platformRole: role }));
    renderGuard({ allowedRoles: allowed });

    expect(shown()).toBe(expected);
    if (!expected) expect(navigate).toHaveBeenCalledWith('/');
  });

  it('blocks a user with no platform role at all from a role-gated route', () => {
    useAppAuth.mockReturnValue(auth({ platformRole: null }));
    renderGuard({ allowedRoles: ['owner'] });

    expect(shown()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  // Regression: user_id is now UNIQUE on user_roles (one role per user), so a
  // user's platformRole is a single value. The hook picks the most privileged
  // if legacy duplicate rows exist, but ProtectedRoute checks that single value.
  it('admits an admin who also has owner — platformRole is admin (most privileged)', () => {
    // The hook resolves to 'admin' via PLATFORM_ROLE_PRECEDENCE; ProtectedRoute
    // checks that single resolved value against allowedRoles.
    useAppAuth.mockReturnValue(auth({ platformRole: 'admin' }));
    renderGuard({ allowedRoles: ['owner', 'agent'] });

    // admin is NOT in the allowed list — this correctly denies access unless
    // 'admin' is explicitly allowed.
    expect(shown()).toBe(false);
  });

  it('grants access when the single platformRole is in allowedRoles', () => {
    useAppAuth.mockReturnValue(auth({ platformRole: 'hotel_manager' }));
    renderGuard({ allowedRoles: ['hotel_manager'] });

    expect(shown()).toBe(true);
  });

  // A role-lookup error no longer exists as a concept — the query either
  // resolves to a role or returns null. isLoaded stays false until it resolves,
  // so ProtectedRoute never evaluates allowedRoles against an unresolved state.
  it('does not expose children when the role has not resolved yet', () => {
    useAppAuth.mockReturnValue(auth({ isLoaded: false }));
    renderGuard({ allowedRoles: ['owner'] });

    expect(shown()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('requires an active organization when requireOrg is set', () => {
    useAppAuth.mockReturnValue(auth({ organization: null }));
    renderGuard({ requireOrg: true });

    expect(shown()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('admits a user who has an active organization', () => {
    useAppAuth.mockReturnValue(auth({ organization: { id: 'org_123' } }));
    renderGuard({ requireOrg: true });

    expect(shown()).toBe(true);
  });

  it('blocks org members lacking the required permission', () => {
    useAppAuth.mockReturnValue(
      auth({ organization: { id: 'org_123' }, can: () => false }),
    );
    renderGuard({ requireOrg: true, requirePermission: PERMISSIONS.STAFF_MANAGE });

    expect(shown()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('admits org members holding the required permission', () => {
    useAppAuth.mockReturnValue(
      auth({
        organization: { id: 'org_123' },
        can: (p: string) => p === PERMISSIONS.STAFF_MANAGE,
      }),
    );
    renderGuard({ requireOrg: true, requirePermission: PERMISSIONS.STAFF_MANAGE });

    expect(shown()).toBe(true);
  });

  it('enforces role, org and permission together', () => {
    // Right permission, but the wrong platform role must still lose.
    useAppAuth.mockReturnValue(
      auth({
        appRole: 'user',
        platformRole: 'user',
        organization: { id: 'org_123' },
        can: () => true,
      }),
    );
    renderGuard({
      allowedRoles: ['owner'],
      requireOrg: true,
      requirePermission: PERMISSIONS.STAFF_MANAGE,
    });

    expect(shown()).toBe(false);
  });
});
