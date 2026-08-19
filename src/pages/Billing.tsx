import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck, Check, Clock, Loader2, Phone, Receipt, ShieldCheck, Smartphone,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { useAppAuth } from "@/hooks/use-auth";
import { formatDay } from "@/hooks/use-rent";
import { accountKind } from "@/lib/account-type";
import { SubscriptionCheckout } from "@/components/SubscriptionCheckout";
import {
  PLANS, TRIAL_DAYS, formatPlanPrice, planById, planForAccountKind,
  type Plan, type PlanId,
} from "@/lib/plans";
import {
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  useEntitlement,
  useStartTrial,
  useSubscriptionPayments,
  type Entitlement,
  type SubscriptionPayment,
  type SubscriptionState,
} from "@/hooks/use-subscription";

/**
 * /billing — plans, current status, and how to actually pay.
 *
 * Signed-in only (the route wraps this in <ProtectedRoute>), with NO role
 * restriction: an agency staff member, a solo landlord and a hotelier all need
 * to see what their account is on. Deciding here that only owners may look at
 * the price list would hide it from the person who ends up making the transfer.
 *
 * ── THIS PAGE HAS NO CHECKOUT BUTTON, AND THAT IS THE DESIGN ────────────────
 * Stripe does not support Somalia as a business location and this market pays
 * by mobile money, so there is nothing to redirect to. Payment is a human
 * exchange: the operator sends the money over EVC, Zaad or Sifalo Pay, and a
 * platform admin confirms it landed and switches the subscription on. The page
 * therefore has to TELL people that, clearly, or they will sit waiting for a
 * card form that is never coming.
 */

/**
 * Where an operator arranges payment.
 *
 * ⚠ These are the platform's published CONTACT details (same as /about) — they
 * are NOT merchant numbers, and the copy below is careful never to tell anyone
 * to send money to them. When the owner settles the actual EVC / Zaad / Sifalo
 * Pay merchant accounts, add them here and rewrite step 1 to name them. Do not
 * guess a payment number into this file: money sent to a wrong number in this
 * market does not come back.
 */
const BILLING_CONTACT = {
  phone: "+252 612 679 357",
  /** `tel:` needs the bare digits. */
  phoneHref: "+252612679357",
  email: "info@mogadishurents.com",
};

const Billing = () => {
  const { isLoaded, isSignedIn, platformRole, organization } = useAppAuth();

  // Two plans, two fixed hook calls. Not a loop over PLANS — hooks can't be
  // called from one, and hard-coding the pair keeps the render order stable.
  const hotel = useEntitlement("hotel");
  const pms = useEntitlement("pms");

  const hotelPayments = useSubscriptionPayments(hotel.subscription?.id);
  const pmsPayments = useSubscriptionPayments(pms.subscription?.id);

  const entitlements = useMemo<Record<PlanId, Entitlement>>(
    () => ({ hotel, pms }),
    [hotel, pms],
  );

  /** The plan this account would buy, from its platform role. May be null. */
  const suggested = planForAccountKind(accountKind(platformRole));

  /** Every receipt across both plans, newest first, tagged with its plan. */
  const payments = useMemo(() => {
    const rows: { plan: PlanId; payment: SubscriptionPayment }[] = [
      ...(hotelPayments.data ?? []).map((payment) => ({ plan: "hotel" as PlanId, payment })),
      ...(pmsPayments.data ?? []).map((payment) => ({ plan: "pms" as PlanId, payment })),
    ];
    return rows.sort((a, b) => (b.payment.paidAt ?? "").localeCompare(a.payment.paidAt ?? ""));
  }, [hotelPayments.data, pmsPayments.data]);

  const isPending = !isLoaded || hotel.isPending || pms.isPending;

  // The route guard bounces signed-out visitors; don't flash a price list.
  if (isLoaded && !isSignedIn) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-4xl py-6 space-y-8">
        <header>
          <h1 className="font-heading text-xl md:text-2xl font-bold text-foreground">
            Billing
          </h1>
          <p className="text-sm text-muted-foreground">
            {organization
              ? `Plans and payments for ${organization.name}.`
              : "Your plan, your trial and everything you've paid."}
          </p>
        </header>

        {/* ── Current status ─────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="font-heading font-semibold text-foreground">Your subscription</h2>
          {isPending ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {PLANS.map((plan) => (
                <StatusCard
                  key={plan.id}
                  plan={plan}
                  entitlement={entitlements[plan.id]}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Plans ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div>
            <h2 className="font-heading font-semibold text-foreground">Plans</h2>
            <p className="text-sm text-muted-foreground">
              Every plan opens with {TRIAL_DAYS} free days. No card, no payment
              details up front.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {PLANS.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                entitlement={entitlements[plan.id]}
                isSuggested={suggested === plan.id}
                isPending={isPending}
                suggestedPlanId={suggested}
              />
            ))}
          </div>
          {suggested === null && (
            <p className="text-xs text-muted-foreground">
              Your account type doesn&rsquo;t map to a plan yet. Choose one in{" "}
              <Link to="/profile" className="text-primary underline-offset-4 hover:underline">
                Settings
              </Link>{" "}
              and the right plan will be highlighted here.
            </p>
          )}
        </section>

        {/* ── Pay now ────────────────────────────────────────────────────────
            Renders only for a plan this account actually has a subscription
            row for; both are null otherwise. HowToPay stays directly beneath,
            because a merchant account can be down and "call us" must never
            stop being an answer. */}
        <SubscriptionCheckout plan="hotel" subscriptionId={hotel.subscription?.id} />
        <SubscriptionCheckout plan="pms" subscriptionId={pms.subscription?.id} />

        <HowToPay />

        {/* ── History ────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="font-heading font-semibold text-foreground">Payment history</h2>
          {payments.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-4 py-8 text-center">
              <Receipt className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No payments recorded yet. Anything you send appears here once an
                admin has confirmed it.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[110px]">Date</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="min-w-[130px]">Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map(({ plan, payment }) => (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap text-sm text-foreground">
                        {formatDay(payment.paidAt)}
                        {payment.coversPeriodStart && payment.coversPeriodEnd && (
                          <span className="block text-[11px] text-muted-foreground">
                            covers {formatDay(payment.coversPeriodStart)} &ndash;{" "}
                            {formatDay(payment.coversPeriodEnd)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {planById(plan).label}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {SUBSCRIPTION_PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground break-all">
                        {payment.externalRef || "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium text-foreground whitespace-nowrap">
                        {formatPaidAmount(payment)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
      <BottomNav />
    </div>
  );
};

// ── Status ───────────────────────────────────────────────────────────────────

const STATE_LABEL: Record<SubscriptionState, string> = {
  none: "Not started",
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment due",
  canceled: "Cancelled",
  expired: "Ended",
};

/**
 * Full class strings per state, never assembled from fragments — Tailwind only
 * emits classes it can literally see in the source.
 */
function stateClasses(state: SubscriptionState): string {
  switch (state) {
    case "active":
      return "border-transparent bg-success/15 text-success";
    case "trialing":
      return "border-transparent bg-primary/15 text-primary";
    case "past_due":
    case "expired":
      return "border-transparent bg-destructive/15 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function StateBadge({ state }: { state: SubscriptionState }) {
  return (
    <Badge variant="outline" className={cn("shrink-0", stateClasses(state))}>
      {STATE_LABEL[state]}
    </Badge>
  );
}

function StatusCard({ plan, entitlement }: { plan: Plan; entitlement: Entitlement }) {
  const { state, daysLeftInTrial, subscription } = entitlement;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm text-foreground">{plan.label}</p>
          <p className="text-xs text-muted-foreground">
            {formatPlanPrice(plan)}/month
          </p>
        </div>
        <StateBadge state={state} />
      </div>

      <div className="mt-3 text-sm">
        {state === "trialing" && (
          <p className="flex items-center gap-2 text-foreground">
            <Clock className="h-4 w-4 shrink-0 text-primary" />
            {daysLeftInTrial === null
              ? "Trial running."
              : daysLeftInTrial <= 0
                ? "Your trial ends today."
                : daysLeftInTrial === 1
                  ? "1 day left."
                  : `${daysLeftInTrial} days left.`}
          </p>
        )}
        {state === "active" && (
          <p className="text-muted-foreground">
            {subscription?.currentPeriodEnd
              ? `Paid through ${formatDay(subscription.currentPeriodEnd)}.`
              : "Your subscription is active."}
          </p>
        )}
        {state === "expired" && (
          <p className="text-muted-foreground">
            The free trial ended{" "}
            {subscription?.trialEndsAt ? formatDay(subscription.trialEndsAt) : ""}. Your
            data is safe — subscribe to open it again.
          </p>
        )}
        {state === "past_due" && (
          <p className="text-muted-foreground">
            We haven&rsquo;t confirmed this month&rsquo;s payment yet. Send it and
            tell us — an admin unlocks it the same day.
          </p>
        )}
        {state === "canceled" && (
          <p className="text-muted-foreground">
            Cancelled. Nothing has been deleted; start again whenever you want.
          </p>
        )}
        {state === "none" && (
          <p className="text-muted-foreground">
            You haven&rsquo;t started this plan. {TRIAL_DAYS} days free when you do.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Plans ────────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  entitlement,
  isSuggested,
  isPending,
  suggestedPlanId,
}: {
  plan: Plan;
  entitlement: Entitlement;
  isSuggested: boolean;
  isPending: boolean;
  suggestedPlanId: PlanId | null;
}) {
  const startTrial = useStartTrial(plan.id);
  const { state, isEntitled } = entitlement;
  const canStartTrial = !isPending && state === "none" && suggestedPlanId === plan.id;

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card p-5",
        // Two complete strings, chosen — not concatenated together.
        isSuggested ? "border-primary shadow-card" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-heading font-semibold text-foreground">{plan.label}</h3>
        {isSuggested && (
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            For your account
          </Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <p className="mt-4">
        <span className="font-heading text-2xl md:text-3xl font-bold text-foreground">
          {formatPlanPrice(plan)}
        </span>
        <span className="text-sm text-muted-foreground"> /month</span>
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        {isPending ? (
          <Skeleton className="h-10 w-full rounded-md" />
        ) : isEntitled ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <BadgeCheck className="h-4 w-4 text-success" />
            {state === "trialing" ? "On free trial" : "Your current plan"}
          </div>
        ) : canStartTrial ? (
          <Button
            variant="hero"
            className="w-full"
            onClick={() => startTrial.mutate()}
            disabled={startTrial.isPending}
          >
            {startTrial.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Start {TRIAL_DAYS} free days
          </Button>
        ) : state === "none" ? (
          // The plan doesn't match this account's type
          <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground text-center">
            <span>Switch your account type in Settings to access this plan</span>
          </div>
        ) : (
          // Trial already used. No checkout to send them to, so the honest CTA
          // points at the instructions further down this same page.
          <Button variant="outline" className="w-full" asChild>
            <a href="#how-to-pay">How to subscribe</a>
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Paying ───────────────────────────────────────────────────────────────────

/**
 * The manual rail, spelled out.
 *
 * People will otherwise hunt for a card form, not find one, and assume the
 * product is broken. Three numbered steps, the honest turnaround time, and no
 * invented merchant number — see BILLING_CONTACT above.
 */
function HowToPay() {
  return (
    <section id="how-to-pay" className="space-y-3 scroll-mt-20">
      <h2 className="font-heading font-semibold text-foreground">How to pay</h2>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Smartphone className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm text-foreground">
              We take EVC Plus, Zaad and Sifalo Pay
            </p>
            <p className="text-sm text-muted-foreground">
              There is no card form here on purpose — you pay the way everyone in
              Mogadishu pays, by mobile money, and a person on our side confirms it.
            </p>
          </div>
        </div>

        <ol className="mt-5 space-y-4">
          <PayStep n={1} title="Ask us for the payment details">
            Call or WhatsApp{" "}
            <a
              href={`tel:${BILLING_CONTACT.phoneHref}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {BILLING_CONTACT.phone}
            </a>{" "}
            or email{" "}
            <a
              href={`mailto:${BILLING_CONTACT.email}`}
              className="text-primary underline-offset-4 hover:underline break-all"
            >
              {BILLING_CONTACT.email}
            </a>
            , and say which plan you want. We send you the EVC Plus, Zaad or
            Sifalo Pay account to transfer to.
          </PayStep>

          <PayStep n={2} title="Send the transfer and keep the reference">
            Transfer the monthly amount and hold on to the transaction ID your
            provider sends back. It is what matches your money to your account,
            so send it to us with your business name.
          </PayStep>

          <PayStep n={3} title="An admin confirms it and unlocks your plan">
            Once we can see the transfer has landed, a platform admin records it
            against your subscription and switches it to active. It shows up in
            your payment history above. This is usually same-day.
          </PayStep>
        </ol>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              Nothing is ever deleted while you sort out payment.
            </span>{" "}
            Your properties, tenants, rent records and documents stay exactly as
            they are, and everything reopens the moment your subscription is
            active again.
          </p>
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" />
          Never send money to a number you were given anywhere other than by us
          directly.
        </p>
      </div>
    </section>
  );
}

function PayStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * A recorded payment, in the currency it was recorded in.
 *
 * Always two decimals — this is a receipt, and "$60" where the ledger says
 * "60.00" invites someone to wonder which one is right. Falls back to a plain
 * prefix if the stored currency isn't one Intl recognises, rather than throwing
 * and taking the whole history table down with it.
 */
function formatPaidAmount(payment: SubscriptionPayment): string {
  const amount = Number.isFinite(payment.amount) ? payment.amount : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: payment.currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${payment.currency} ${amount.toFixed(2)}`;
  }
}

export default Billing;
