import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppAuth } from '@/hooks/use-auth';
import type { UserRole } from '@/lib/types';
import type { Permission } from '@/lib/permissions';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
  requirePermission?: Permission;
  requireOrg?: boolean;
}

/**
 * Route guard.
 *
 * It used to bounce people to `/` without a word, which made "why can't I open
 * the dashboard?" essentially undebuggable — a missing row in public.user_roles,
 * a failed role lookup and a genuine permission denial all looked identical.
 * Every rejection now names its reason: a toast for the user, a console line
 * with the specifics for whoever is debugging.
 */
const ProtectedRoute = ({ children, allowedRoles, requirePermission, requireOrg }: ProtectedRouteProps) => {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn, platformRole, can, organization } = useAppAuth();

  // A single source of truth for the verdict, so the redirect effect and the
  // render path can never disagree about whether access is allowed.
  //
  // Memoised deliberately: this object is a dependency of the redirect effect
  // below, and a fresh literal on every render re-ran that effect on every
  // render, firing a duplicate toast each time. `allowedRoles` is keyed by its
  // contents rather than its identity because callers pass an inline array
  // literal, which is a new reference on each parent render.
  const allowedRolesKey = allowedRoles?.join(',');
  const denial = useMemo<{ toast: string; detail: Record<string, unknown> } | null>(() => {
    if (!isLoaded || !isSignedIn) return null;

    if (allowedRoles && (!platformRole || !allowedRoles.includes(platformRole))) {
      return {
        toast:
          platformRole == null
            ? 'Your account has no role yet. Finish setting up your profile first.'
            : "Your account doesn't have access to that page.",
        detail: {
          reason: 'insufficient-platform-role',
          needsOneOf: allowedRoles,
          youHave: platformRole,
        },
      };
    }
    if (requireOrg && !organization) {
      return {
        toast: 'Create or select an agency to open that page.',
        detail: { reason: 'no-active-organization' },
      };
    }
    if (requirePermission && !can(requirePermission)) {
      return {
        toast: "Your role in this agency doesn't allow that.",
        detail: { reason: 'missing-permission', needs: requirePermission, platformRole },
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, allowedRolesKey, platformRole, requireOrg, organization, requirePermission, can]);

  useEffect(() => {
    if (!isLoaded) return;

    // `replace` on both redirects: pushing would leave the guarded path in
    // history, so Back returns to it, the guard bounces forward again, and the
    // user is trapped on the destination with no way out.
    if (!isSignedIn) {
      navigate('/signin', { replace: true });
      return;
    }

    if (denial) {
      console.warn('[ProtectedRoute] access denied', denial.detail);
      toast.error(denial.toast);
      navigate('/', { replace: true });
    }
  }, [isLoaded, isSignedIn, denial, navigate]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isSignedIn || denial) return null;

  return <>{children}</>;
};

export default ProtectedRoute;
