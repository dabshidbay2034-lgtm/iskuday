import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { useAcceptMyInvites } from "@/hooks/use-hotel-invites";

/** One key per user, so switching accounts on a shared device still claims. */
const storageKey = (userId: string) => `hotel-invites-claimed:${userId}`;

/**
 * Claims any hotel invitations addressed to the signed-in user's email.
 * Renders nothing.
 *
 * Invitations are written against an EMAIL, because that is all the inviter
 * knows. Turning one into a real membership needs the invitee's own session, so
 * something has to run the RPC on their behalf the first time they show up —
 * this is that something.
 *
 * It must fire ONCE per session, not once per navigation. Two guards, because
 * neither is sufficient alone:
 *   • a ref, which stops the double-invoke of React StrictMode and any re-render
 *     that happens before sessionStorage is written;
 *   • sessionStorage, which survives the remounts a route change causes and
 *     scopes the memory to this tab — a new tab or a fresh sign-in claims again,
 *     which is exactly right for someone invited while already signed in.
 *
 * Mounted next to AnalyticsBridge in App.tsx: inside the router and below
 * ClerkProvider, the only place useAppAuth() is legal.
 */
const AcceptInvitesOnSignIn = () => {
  const { isLoaded, isSignedIn, userId } = useAppAuth();
  const accept = useAcceptMyInvites();

  const claimedRef = useRef<string | null>(null);
  // The mutation object is a new identity on every render, so it cannot be an
  // effect dependency without re-firing the effect it guards.
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    // Wait for auth to settle: firing while the Clerk token is still resolving
    // sends the RPC anonymously and it claims nothing.
    if (!isLoaded || !isSignedIn || !userId) return;
    if (claimedRef.current === userId) return;

    const key = storageKey(userId);
    let alreadyClaimed = false;
    try {
      alreadyClaimed = sessionStorage.getItem(key) === "1";
    } catch {
      // Private-mode Safari throws on sessionStorage. The ref alone still keeps
      // this to once per mounted session, which is the case that matters.
    }
    if (alreadyClaimed) {
      claimedRef.current = userId;
      return;
    }

    // Marked BEFORE the request, not in its callback: an in-flight RPC must not
    // be started twice by a navigation that lands mid-request.
    claimedRef.current = userId;
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* see above */
    }

    acceptRef.current.mutate(undefined, {
      onSuccess: (count) => {
        // The hook already invalidates the hotel queries; all that is left is
        // telling the user why a hotel they have never seen just appeared.
        if (count > 0) {
          toast.success(
            `You've been added to ${count} hotel ${count === 1 ? "team" : "teams"}`,
          );
        }
      },
      onError: () => {
        // Silent by design, and the flag stays set: a user who was never invited
        // to anything should not be told that claiming invitations failed. A
        // reload retries.
      },
    });
  }, [isLoaded, isSignedIn, userId]);

  return null;
};

export default AcceptInvitesOnSignIn;
