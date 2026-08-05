import { useEffect } from 'react';
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
  let denial: { toast: string; detail: Record<string, unknown> } | null = null;

  if (isLoaded && isSignedIn) {
    if (allowedRoles && (!platformRole || !allowedRoles.includes(platformRole))) {
      denial = {
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
    } else if (requireOrg && !organization) {
      denial = {
        toast: 'Create or select an agency to open that page.',
        detail: { reason: 'no-active-organization' },
      };
    } else if (requirePermission && !can(requirePermission)) {
      denial = {
        toast: "Your role in this agency doesn't allow that.",
        detail: { reason: 'missing-permission', needs: requirePermission, platformRole },
      };
    }
  }

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      navigate('/signin');
      return;
    }

    if (denial) {
      console.warn('[ProtectedRoute] access denied', denial.detail);
      toast.error(denial.toast);
      navigate('/');
    }
    // `denial` is derived from these; listing them keeps the effect honest.
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
