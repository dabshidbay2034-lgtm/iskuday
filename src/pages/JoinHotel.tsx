import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, ShieldCheck, XCircle } from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { useAppAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * `/join/:token` — redeem a hotel team invitation.
 *
 * Authorization is the TOKEN in the URL, not the visitor's email: this
 * project's Clerk JWT carries no `email` claim (verified by decoding a live
 * session — it has sub, o, role, sid and nothing else), so an email-matching
 * invite can never resolve to a user. The link is the credential.
 *
 * Signed out, we hold the token and bounce through sign-in rather than
 * redeeming — otherwise the invite burns against nobody and the person who
 * clicked it is left with an "already used" error.
 */
const JoinHotel = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isLoaded, isSignedIn } = useAppAuth();

  const [error, setError] = useState<string | null>(null);
  // An invite is single-use, so a double-invoke (StrictMode, a re-render mid
  // request) would spend it and then report "already used" to its rightful
  // owner. Claim the attempt before awaiting anything.
  const attempted = useRef(false);

  useEffect(() => {
    if (!isLoaded || !token) return;

    if (!isSignedIn) {
      // Come back here after sign-in instead of dropping them on the home page.
      navigate(`/signin?redirect_url=${encodeURIComponent(`/join/${token}`)}`, { replace: true });
      return;
    }

    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      const { data, error: rpcError } = await supabase.rpc(
        // Not in the generated types yet (20260813000001).
        "accept_hotel_invite_by_token" as never,
        { _token: token } as never,
      );

      if (rpcError) {
        setError(rpcError.message || "This invitation could not be accepted.");
        return;
      }

      toast.success("You're on the team");
      const hotelId = data as unknown as string | null;
      navigate(hotelId ? `/manage/hotels/${hotelId}` : "/manage", { replace: true });
    })();
  }, [isLoaded, isSignedIn, token, navigate]);

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-md py-24 text-center">
        {error ? (
          <>
            <XCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <h1 className="font-heading font-bold text-xl text-foreground mb-2">
              Invitation not accepted
            </h1>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <Button variant="hero" onClick={() => navigate("/manage")}>
              Go to Manage
            </Button>
          </>
        ) : (
          <>
            <div className="relative w-10 h-10 mx-auto mb-3">
              <ShieldCheck className="w-10 h-10 text-primary/30" />
              <Loader2 className="w-10 h-10 animate-spin text-primary absolute inset-0" />
            </div>
            <h1 className="font-heading font-bold text-xl text-foreground mb-2">
              Joining the team…
            </h1>
            <p className="text-sm text-muted-foreground">One moment.</p>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
};

export default JoinHotel;
