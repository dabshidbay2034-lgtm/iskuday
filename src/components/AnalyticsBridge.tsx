import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useAppAuth } from "@/hooks/use-auth";
import { identifyUser, resetUser, trackPageview } from "@/lib/analytics";

/**
 * Connects the router and the auth session to PostHog. Renders nothing.
 *
 * Mounted inside `<BrowserRouter>` in App.tsx because it needs `useLocation()`,
 * and below `<ClerkProvider>` (main.tsx) because it needs `useAppAuth()` —
 * that intersection is the only place both hooks are legal.
 *
 * Everything it calls is a no-op when `VITE_POSTHOG_KEY` is unset, so this
 * component is harmless in a checkout with no analytics configured.
 */
const AnalyticsBridge = () => {
  const { pathname } = useLocation();
  const { isLoaded, isSignedIn, userId, platformRole, orgId, orgRole } = useAppAuth();

  // One pageview per navigation. Keyed on pathname only: the search string
  // carries filter state that changes on every keystroke-driven URL update,
  // and counting those as separate pageviews would drown the real ones.
  useEffect(() => {
    trackPageview(pathname);
  }, [pathname]);

  // Tracks whether the previous render had a signed-in user, so sign-out can be
  // told apart from "not signed in yet" — only the former should reset(), and
  // resetting on first paint would throw away the anonymous id that links a
  // visitor's pre-signup browsing to the account they go on to create.
  const wasSignedIn = useRef(false);

  useEffect(() => {
    // Wait for the platform role to resolve. `isLoaded` stays false for a
    // signed-in user until user_roles comes back (see use-auth.ts), so acting
    // early would identify them with platformRole: undefined and leave that
    // stale until their next sign-in.
    if (!isLoaded) return;

    if (isSignedIn && userId) {
      identifyUser(userId, {
        platform_role: platformRole,
        org_id: orgId,
        org_role: orgRole,
      });
      wasSignedIn.current = true;
      return;
    }

    if (wasSignedIn.current) {
      resetUser();
      wasSignedIn.current = false;
    }
  }, [isLoaded, isSignedIn, userId, platformRole, orgId, orgRole]);

  return null;
};

export default AnalyticsBridge;
