import { Link } from "react-router-dom";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Clock, Loader2, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEntitlement, useStartTrial, type SubscriptionState } from "@/hooks/use-subscription";
import { PLANS, TRIAL_DAYS, formatPlanPrice, planById, type PlanId } from "@/lib/plans";

/**
 * Paywall wrapper for a paid surface (migration 20260816000001).
 *
 * âš  NOT MOUNTED ANYWHERE YET, ON PURPOSE. Where the paywall lands is the
 * owner's call: gate the wrong surface and a landlord is locked out of their
 * own rent records. See the report accompanying this work for the candidate
 * mount points. Do not wire this into a route on a hunch.
 *
 * â”€â”€ Behaviour by state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *   loading            children. See below â€” this one is load-bearing.
 *   active             children.
 *   trialing           children + a quiet "N days left" strip above them.
 *   everything else    HARD LOCK: the upgrade panel INSTEAD of the children.
 *
 * â”€â”€ WHY LOADING RENDERS THE CHILDREN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Entitlement is unknown for the first few hundred milliseconds of every
 * navigation. Rendering a paywall during that window would flash "your access
 * has ended" at a fully paid-up customer several times a day, and there is no
 * amount of correctness afterwards that undoes that impression. The failure
 * modes are not symmetric: showing the page for 300ms to someone who turns out
 * to be expired costs nothing, and they get locked the moment the answer
 * arrives. So `isPending` renders children, always.
 *
 * â”€â”€ WHY THE LOCK IS HARD, NOT READ-ONLY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * The owner chose a hard lock over a read-only fallback. So an unentitled
 * surface renders NOTHING of its children â€” not a dimmed table, not a
 * disabled-button version of the page. A read-only fallback would mean every
 * gated page needs a second, permanently-untested rendering path, and "mostly
 * blocked" is the kind of paywall people find a way around.
 *
 * That makes the copy part of the product, not decoration. A screen that
 * abruptly hides a landlord's rent ledger reads as "they deleted my records"
 * unless it says otherwise in plain words â€” so the panel states that the data
 * is safe and untouched, prominently, every time. Someone who believes we are
 * holding their books hostage does not come back and pay; they call a lawyer.
 */

type BillingGateProps = {
  plan: PlanId;
  children: React.ReactNode;
};

export function BillingGate({ plan, children }: BillingGateProps) {
  const { isPending, isEntitled, isTrialing, state, daysLeftInTrial } = useEntitlement(plan);

  // Unknown â‰  unentitled. Never a paywall on a pending query.
  if (isPending) return <>{children}</>;

  if (isTrialing) {
    return (
      <>
        <TrialBanner plan={plan} daysLeft={daysLeftInTrial} />
        {children}
      </>
    );
  }

  if (isEntitled) return <>{children}</>;

  // Hard lock. The children are not rendered at all.
  return <UpgradePanel plan={plan} state={state} />;
}

/**
 * The trialing strip: one line, above the page, not a modal and not a colour
 * that shouts. Someone on day 2 of 14 is doing exactly what we want them to do
 * and should barely notice this.
 *
 * It sharpens in the last three days, when the message stops being ambient
 * information and starts being something they need to act on.
 */
function TrialBanner({ plan, daysLeft }: { plan: PlanId; daysLeft: number | null }) {
  const urgent = daysLeft !== null && daysLeft <= 3;

  const message =
    daysLeft === null
      ? "You're on a free trial."
      : daysLeft <= 0
        ? "Your free trial ends today."
        : daysLeft === 1
          ? "1 day left in your free trial."
          : `${daysLeft} days left in your free trial.`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-sm",
        // Full class strings per branch â€” never assembled from fragments, so
        // Tailwind's scanner can actually see them.
        urgent
          ? "border-destructive/30 bg-destructive/10 text-foreground"
          : "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      <Clock className={cn("h-4 w-4 shrink-0", urgent ? "text-destructive" : "text-muted-foreground")} />
      <span className="min-w-0">
        {message}{" "}
        <span className="text-muted-foreground">
          {planById(plan).label} plan is {formatPlanPrice(plan)}/month after that.
        </span>
      </span>
      <Button variant="link" size="sm" className="h-auto p-0 ml-auto" asChild>
        <Link to="/billing">See plans</Link>
      </Button>
    </div>
  );
}

/** What each unentitled state should actually say to the person reading it. */
function headlineFor(state: SubscriptionState, planLabel: string): string {
  switch (state) {
    case "expired":
      return `Your ${planLabel} trial has ended`;
    case "past_due":
      return "Your subscription payment is overdue";
    case "canceled":
      return `Your ${planLabel} subscription is cancelled`;
    default:
      return `${planLabel} is a paid plan`;
  }
}

function explanationFor(state: SubscriptionState): string {
  switch (state) {
    case "past_due":
      return "We haven't been able to confirm this month's payment yet. Send it over EVC, Zaad or Sifalo Pay and an admin will unlock everything as soon as it lands â€” usually the same day.";
    case "canceled":
      return "This subscription was cancelled. Start it again whenever you're ready and everything comes straight back.";
    case "expired":
      return "Subscribe to carry on where you left off. Payment is by EVC, Zaad or Sifalo Pay, and an admin confirms it â€” usually the same day.";
    default:
      return `Try it free for ${TRIAL_DAYS} days. No card, no payment details â€” start now and decide later.`;
  }
}

function UpgradePanel({ plan, state }: { plan: PlanId; state: SubscriptionState }) {
  const details = planById(plan);
  const startTrial = useStartTrial(plan);

  /**
   * "Never subscribed" is the one state with a one-click way out, so it gets a
   * button instead of a price tag.
   *
   * Deliberately a BUTTON and not an automatic start-on-mount, even though the
   * product line is "the trial starts when the account first reaches the paid
   * surface". This component's mount point is still undecided â€” a side effect
   * that fires on render would mean a single mis-placed <BillingGate> silently
   * starts the 14-day clock for every user who so much as loads that route,
   * including people who were never going to use the feature. One click is a
   * cheap price for that not being possible.
   */
  const canStartTrial = state === "none";

  return (
    /**
     * The locked panel carries its own chrome.
     *
     * It REPLACES the page, and every gated page renders its own <Header/>, so
     * without this a locked operator loses the nav bar entirely â€” no way to
     * reach /billing, no org switcher, no sign-out. Someone gated on the wrong
     * Clerk org would be stuck with no route out but the browser's back button.
     * Carrying the chrome here is what makes it safe to mount this at the route
     * level instead of threading it through six page bodies.
     */
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container mx-auto w-full max-w-lg py-8 md:py-12">
      <div className="rounded-2xl border border-border bg-card p-5 md:p-7 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-7 w-7 text-primary" />
        </div>

        <h2 className="font-heading text-lg md:text-xl font-bold text-foreground">
          {headlineFor(state, details.label)}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {explanationFor(state)}
        </p>

        {/* The reassurance is not fine print. A screen that suddenly hides a
            landlord's ledger reads as data loss, and that misreading is far
            more expensive than the subscription itself. */}
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3 text-left">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm text-foreground">
            <span className="font-semibold">Your data is safe and untouched.</span>{" "}
            <span className="text-muted-foreground">
              Nothing has been deleted â€” every property, tenant, rent record and
              document is exactly where you left it, and all of it comes back the
              moment your subscription is active.
            </span>
          </p>
        </div>

        <div className="mt-5 text-left">
          <p className="text-sm font-semibold text-foreground">
            What&rsquo;s locked right now
          </p>
          <ul className="mt-2 space-y-1.5">
            {details.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {canStartTrial ? (
            <Button
              variant="hero"
              onClick={() => startTrial.mutate()}
              disabled={startTrial.isPending}
            >
              {startTrial.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Start {TRIAL_DAYS}-day free trial
            </Button>
          ) : (
            <Button variant="hero" asChild>
              <Link to="/billing">
                {details.label} &mdash; {formatPlanPrice(details)}/month
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/billing">Billing &amp; plans</Link>
          </Button>
        </div>

        {/* Both plans exist and people land on the wrong one. Cheaper to say so
            here than to have them conclude the product doesn't do what they
            need and leave. */}
        {PLANS.length > 1 && (
          <p className="mt-4 text-xs text-muted-foreground">
            Running a different kind of business?{" "}
            <Link to="/billing" className="text-primary underline-offset-4 hover:underline">
              Compare both plans
            </Link>
            .
          </p>
        )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

export default BillingGate;

