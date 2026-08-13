import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban, Building2, CalendarClock, ChevronDown, ChevronUp, CircleAlert,
  ClipboardCopy, CreditCard, Plus, Receipt, Search, ShieldAlert, TriangleAlert,
  UserRound, Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError, formatDay, pmsDb } from "@/hooks/use-rent";
import { roundCents } from "@/hooks/use-hotel-staff";
import { PLANS, TRIAL_DAYS, planById, type PlanId } from "@/lib/plans";
import {
  SUBSCRIPTION_PAYMENT_METHODS,
  SUBSCRIPTION_PAYMENT_METHOD_LABELS,
  TRIAL_ENDING_SOON_DAYS,
  effectiveSubscriptionState,
  subscriptionKey,
  subscriptionUrgency,
  useAllSubscriptions,
  useRecordSubscriptionPayment,
  useSubscriptionPayments,
  useSubscriptionSearch,
  type Subscription,
  type SubscriptionPaymentMethod,
  type SubscriptionState,
  type SubjectType,
} from "@/hooks/use-subscription";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The platform billing desk (migration 20260816000001).
 *
 * There is no payment processor and there is not going to be one soon — Stripe
 * does not support Somalia as a business location, and this market pays by EVC
 * Plus, Zaad and Sifalo Pay. So the rail is a human: an operator sends the
 * money, the admin sees it land in their own mobile-money app, and confirms it
 * HERE. Without this screen a customer who has paid can only be unlocked with
 * hand-written SQL.
 *
 * That shapes every decision below. The admin doing this is on a phone, at
 * night, holding a transfer notification in the other hand — so the covered
 * period defaults itself, activation rides along with the receipt instead of
 * being a second step to forget, and the rows that need money chasing sort to
 * the top.
 *
 * ── WHAT THIS SCREEN CANNOT DO ───────────────────────────────────────────────
 * Nothing here is the security boundary. `subscriptions` and
 * `subscription_payments` have NO subscriber-facing write policy at all; every
 * write below is admin-only in Postgres and will be refused for anyone else
 * whatever this component renders. The `platformRole` check is an affordance —
 * a visible control that then fails is a worse experience than no control.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `subscriptions` post-dates the generated types, so writes go through a loose
// accessor and narrow themselves — the same pattern use-subscription.ts uses.
// Redeclared here rather than exported from that module because its brief is
// admin READ hooks; the two writes below (create, status override) are used by
// this screen and nothing else.

type LooseClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};
const loose = pmsDb as unknown as LooseClient;

// ── Dates ────────────────────────────────────────────────────────────────────
// All local-time, all `YYYY-MM-DD`. `covers_period_start/end` are DATE columns
// and `<input type="date">` speaks the same string, so the maths stays in that
// space and never round-trips through UTC — an admin in Mogadishu (UTC+3)
// picking "today" must not get yesterday's date stored.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function todayIso(): string {
  return toIsoDate(new Date());
}

/** The local calendar date of a stored timestamp, or null if there isn't one. */
function isoDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : toIsoDate(date);
}

/**
 * Add whole months, clamping to the end of the target month.
 *
 * Naively bumping `setMonth` overflows: 31 January + 1 month becomes 3 March,
 * so an operator who pays on the 31st would be billed for a period that quietly
 * runs two days long every time it happens.
 */
function addMonths(iso: string, months: number): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDayOfTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDayOfTarget));
  return toIsoDate(target);
}

/**
 * The period a fresh payment should cover, defaulted so consecutive payments
 * EXTEND rather than overwrite.
 *
 * The start is the later of today and whatever they have already paid for. That
 * "later of" is the whole point: anchoring on today alone throws away the time
 * left on the clock, so an operator who pays a week early silently loses that
 * week — and neither they nor the admin ever sees it happen, because the row
 * just says 'active' either way.
 *
 * `trial_ends_at` is deliberately NOT folded into the "later of". Trial days
 * are given, not bought, and rolling them into a paid period would quietly turn
 * a 14-day giveaway into six paid weeks for every operator who pays on day one.
 * The admin can still move the "From" date by hand if they want to be generous.
 */
function defaultPeriod(subscription: Subscription): { start: string; end: string } {
  const today = todayIso();
  const paidThrough = isoDateOf(subscription.currentPeriodEnd);
  // Plain string comparison is safe: both are zero-padded fixed-width ISO dates.
  const start = paidThrough && paidThrough > today ? paidThrough : today;
  return { start, end: addMonths(start, 1) };
}

/**
 * `current_period_end` is a TIMESTAMPTZ. Storing the bare date would put it at
 * midnight — the START of the covered day — so anyone reading it back sees
 * "paid through yesterday" and the customer is shorted a day for free. Push it
 * to the last instant of the day they actually bought.
 */
function endOfDayIso(iso: string): string | null {
  if (!ISO_DATE.test(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const at = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** `formatDay` for a date-only string, which it would otherwise read as UTC. */
function formatIsoDay(iso: string | null | undefined): string {
  return iso ? formatDay(`${iso}T00:00:00`) : "—";
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Always two decimals. NOT `formatMoney()` from use-rent.ts, which drops the
 * cents on whole amounts — a receipts list where "$60" sits under "$99.99"
 * reads like a rounding bug rather than a price. Same reasoning as
 * `formatPlanPrice()` in lib/plans.ts, which can't be reused here because it
 * only accepts a Plan and these are arbitrary recorded amounts.
 */
function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

/** Parsed dollars, or null when the field isn't a usable amount. */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  // NUMERIC(12,2). Snap here as well as in the mutation so what the summary
  // line promises is exactly what gets stored.
  return roundCents(value);
}

// ── Labels ───────────────────────────────────────────────────────────────────
// Full Tailwind class strings, never assembled by concatenation — a class built
// from a variable is invisible to Tailwind's scanner and ships as no styling at
// all. Every colour is a semantic token, so light and dark both work.

const STATUS_LABEL: Record<SubscriptionState, string> = {
  none: "No subscription",
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  expired: "Expired",
};

const STATUS_CLASS: Record<SubscriptionState, string> = {
  none: "border-transparent bg-muted text-muted-foreground",
  trialing: "border-transparent bg-info/15 text-info",
  active: "border-transparent bg-success/15 text-success",
  past_due: "border-transparent bg-destructive/15 text-destructive",
  canceled: "border-transparent bg-muted text-muted-foreground",
  expired: "border-transparent bg-warning/15 text-warning",
};

function planLabel(plan: PlanId): string {
  return planById(plan)?.label ?? plan;
}

function planPrice(plan: PlanId): number {
  return planById(plan)?.priceUsd ?? 0;
}

/** The three statuses an admin sets by hand. 'active' is only ever earned by a
 *  recorded payment, and 'trialing' only by start_trial() — neither belongs in
 *  a manual override, because both hand out the product. */
type OverridableStatus = "past_due" | "canceled" | "expired";

const OVERRIDE_OPTIONS: {
  value: OverridableStatus;
  label: string;
  consequence: string;
}[] = [
  {
    value: "past_due",
    label: "Past due",
    consequence:
      "Their payment is late. This will lock them out of the manage area straight away — the rent ledger, tenants, hotel screens and payroll all go behind the paywall.",
  },
  {
    value: "canceled",
    label: "Canceled",
    consequence:
      "They have stopped subscribing. This will lock them out of the manage area straight away.",
  },
  {
    value: "expired",
    label: "Expired",
    consequence:
      "Their paid period is over. This will lock them out of the manage area straight away.",
  },
];

// ── Admin writes ─────────────────────────────────────────────────────────────
// Recording a payment already has a hook (`useRecordSubscriptionPayment`). The
// two writes here have no other caller, so they live beside their only screen.
// Both are admin-only in Postgres; the client checks exist to turn a 42501 into
// a sentence, not to enforce anything.

/**
 * Set a status by hand.
 *
 * Deliberately does NOT clear `current_period_end` or `trial_ends_at`. Those
 * are the record of what was actually bought; wiping them would destroy the
 * evidence an admin needs to work out how much time is owed when the operator
 * calls back to argue. Entitlement is decided by the status, so leaving the
 * dates alone costs nothing.
 */
function useOverrideSubscriptionStatus() {
  const { platformRole } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { subscription: Subscription; status: OverridableStatus }) => {
      if (platformRole !== "admin") {
        throw new Error("Only a platform admin can change a subscription's status.");
      }
      const { error } = await loose
        .from("subscriptions")
        .update({ status: input.status })
        .eq("id", input.subscription.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      toast.success(`Marked ${STATUS_LABEL[input.status].toLowerCase()}`);
      // `subscriptionKey()` bare is a real PREFIX, and it is the only key this
      // mutation can build honestly — it covers all three families the change
      // is visible through: the admin list (["subscription","admin","all"]),
      // the subject's own read (["subscription", subjectKey, plan]) and the
      // receipts (["subscription","payments",id]). Reaching for a longer key
      // out of values this mutation doesn't hold would end in `undefined` and
      // match nothing, which is how this bug has shipped three times already.
      queryClient.invalidateQueries({ queryKey: subscriptionKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't change the status")),
  });
}

type CreateSubscriptionInput = {
  subjectType: SubjectType;
  subjectId: string;
  plan: PlanId;
  /** Open the 14-day trial as well, rather than creating a locked shell. */
  withTrial: boolean;
};

/**
 * Create a subscription for a subject that has none — the operator who never
 * clicked "start trial" but is standing in front of you with $60 on EVC.
 *
 * WITHOUT a trial the row is created 'expired', i.e. locked. Creating it
 * 'active' would hand out the product with no receipt behind it; the admin
 * records the payment against the new row and THAT activates it, so money and
 * access are never separated.
 *
 * WITH a trial it goes through the `start_trial()` RPC rather than an INSERT,
 * even though an admin could insert directly. The RPC computes
 * `now() + 14 days` in Postgres, so the trial length can't drift with a wrong
 * device clock, and it is `ON CONFLICT DO NOTHING` — a used trial stays used.
 */
function useCreateSubscription() {
  const { platformRole } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSubscriptionInput): Promise<{ created: boolean }> => {
      if (platformRole !== "admin") {
        throw new Error("Only a platform admin can create a subscription.");
      }
      const subjectId = input.subjectId.trim();
      if (!subjectId) throw new Error("Enter the Clerk id of the account to bill.");

      if (input.withTrial) {
        const { data, error } = await loose.rpc("start_trial", {
          _subject_type: input.subjectType,
          _subject_id: subjectId,
          _plan: input.plan,
        });
        if (error) throw error;
        // The RPC is a no-op when a row already exists, and says so by
        // returning the state it found. Report that honestly instead of
        // claiming a fresh trial that was never opened.
        return { created: data === "trialing" };
      }

      const { error } = await loose.from("subscriptions").insert({
        subject_type: input.subjectType,
        subject_id: subjectId,
        plan: input.plan,
        status: "expired",
      });
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new Error(
            "That account already has a subscription on this plan — find it in the list and record a payment against it.",
          );
        }
        throw error;
      }
      return { created: true };
    },
    onSuccess: (result) => {
      toast[result.created ? "success" : "info"](
        result.created
          ? "Subscription created"
          : "That account already had a subscription on this plan — nothing was changed.",
      );
      // Same prefix, same reason as the override above.
      queryClient.invalidateQueries({ queryKey: subscriptionKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't create the subscription")),
  });
}

// ── The panel ────────────────────────────────────────────────────────────────

export function BillingAdminPanel() {
  const { isLoaded, isSignedIn, platformRole } = useAppAuth();
  const isAdmin = isLoaded && isSignedIn && platformRole === "admin";

  const query = useAllSubscriptions();
  const [term, setTerm] = useState("");
  const rows = useSubscriptionSearch(query.data, term);

  const [payTarget, setPayTarget] = useState<Subscription | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<Subscription | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<OverridableStatus>("past_due");
  const [createOpen, setCreateOpen] = useState(false);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);

  const override = useOverrideSubscriptionStatus();
  // Same synchronous re-entry guard as the payment form — see the long note
  // there. An AlertDialogAction is as double-tappable as any other button.
  const overrideInFlight = useRef(false);

  // Counted over EVERY subscription, not the filtered view: the headline is
  // "how much work is there", and a search term must not make the backlog look
  // like it shrank.
  const counts = useMemo(() => {
    const all = query.data ?? [];
    let active = 0;
    let trialing = 0;
    let attention = 0;
    for (const row of all) {
      const state = effectiveSubscriptionState(row);
      if (state === "active") active += 1;
      if (state === "trialing") trialing += 1;
      if (subscriptionUrgency(row) !== "none") attention += 1;
    }
    return { total: all.length, active, trialing, attention };
  }, [query.data]);

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Billing is admin-only</p>
            <p className="text-sm text-muted-foreground">
              Recording payments and changing a subscription's status needs a platform
              administrator account.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const confirmOverride = () => {
    if (!overrideTarget || overrideInFlight.current) return;
    overrideInFlight.current = true;
    override.mutate(
      { subscription: overrideTarget, status: overrideStatus },
      {
        onSuccess: () => setOverrideTarget(null),
        onSettled: () => {
          overrideInFlight.current = false;
        },
      },
    );
  };

  const openOverride = (subscription: Subscription) => {
    // Reset the choice on every open. A status left over from the last account
    // is the kind of thing that locks out the wrong customer.
    setOverrideStatus("past_due");
    setOverrideTarget(subscription);
  };

  const overrideCopy =
    OVERRIDE_OPTIONS.find((option) => option.value === overrideStatus) ?? OVERRIDE_OPTIONS[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            Subscriptions
          </h2>
          <p className="text-sm text-muted-foreground">
            Confirm an EVC Plus, Zaad or Sifalo Pay transfer and unlock the account.
          </p>
        </div>
        <Button variant="hero" size="sm" onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="w-4 h-4" /> Add subscription
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Subscriptions" value={counts.total} />
        <StatCard label="Active" value={counts.active} tone="success" />
        <StatCard label="On trial" value={counts.trialing} tone="info" />
        <StatCard label="Needs attention" value={counts.attention} tone="destructive" />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by Clerk id, plan or status…"
          className="pl-10"
          aria-label="Search subscriptions"
        />
      </div>

      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : query.isError ? (
        // A failed query must never look like "no subscriptions". Reading an
        // outage as an empty book is how an admin concludes nobody has paid.
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <CircleAlert className="w-5 h-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                The subscription list couldn't be loaded
              </p>
              <p className="text-sm text-muted-foreground">
                This is a connection or permission problem — it does not mean there are no
                subscriptions. Nothing has been changed.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="shrink-0"
            >
              {query.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-10 text-center">
            <Receipt className="w-9 h-9 text-muted-foreground mx-auto mb-3" />
            {term.trim() ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  No subscription matches "{term.trim()}"
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Search by the Clerk id (<span className="font-mono">user_…</span> or{" "}
                  <span className="font-mono">org_…</span>), the plan, or a status.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setTerm("")}>
                  Clear search
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">No subscriptions yet</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  A subscription appears here as soon as an operator starts their{" "}
                  {TRIAL_DAYS}-day trial. Add one by hand for someone who wants to pay without
                  trialling first.
                </p>
                <Button variant="hero" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus className="w-4 h-4" /> Add subscription
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((subscription) => (
            <SubscriptionRow
              key={subscription.id}
              subscription={subscription}
              historyOpen={openHistoryId === subscription.id}
              onToggleHistory={() =>
                setOpenHistoryId((current) => (current === subscription.id ? null : subscription.id))
              }
              onRecordPayment={() => setPayTarget(subscription)}
              onOverride={() => openOverride(subscription)}
            />
          ))}
        </ul>
      )}

      {/* Record payment — one dialog for the whole list, keyed so every open
          starts from that subscription's own defaults rather than the last
          one's half-typed values. */}
      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {payTarget
                ? `${planLabel(payTarget.plan)} — ${payTarget.subjectId}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {payTarget && (
            <RecordPaymentForm
              key={payTarget.id}
              subscription={payTarget}
              onDone={() => setPayTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a subscription</DialogTitle>
            <DialogDescription>
              For an account that never started a trial but wants to pay.
            </DialogDescription>
          </DialogHeader>
          {createOpen && <CreateSubscriptionForm onDone={() => setCreateOpen(false)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!overrideTarget}
        onOpenChange={(open) => {
          // Never yank the dialog out from under an in-flight write — the admin
          // would be left unsure whether it went through.
          if (!open && !override.isPending) setOverrideTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change this subscription's status</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <span className="block font-medium text-foreground">
                  {overrideTarget ? planLabel(overrideTarget.plan) : ""} ·{" "}
                  <span className="font-mono text-xs">{overrideTarget?.subjectId}</span>
                </span>
                <span className="block mt-2">
                  Only these three can be set by hand. <strong>Active</strong> is earned by a
                  recorded payment and <strong>trial</strong> by the trial itself — neither is
                  something to award from a dropdown.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="override-status" className="text-xs text-muted-foreground">
                New status
              </Label>
              <Select
                value={overrideStatus}
                onValueChange={(value) => setOverrideStatus(value as OverridableStatus)}
              >
                <SelectTrigger id="override-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERRIDE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* The consequence, named in full and updated with the choice —
                nobody should have to infer that "past due" means a lockout. */}
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
              <TriangleAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                {overrideCopy.consequence}
                <span className="block mt-1 text-muted-foreground">
                  Nothing is deleted, and it is reversible: recording a payment puts them straight
                  back to active.
                </span>
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={override.isPending}>Leave it alone</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Radix closes on click by default. Hold it open until the write
                // has actually landed, so a failure is seen rather than guessed.
                event.preventDefault();
                confirmOverride();
              }}
              disabled={override.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {override.isPending ? "Saving…" : `Mark ${overrideCopy.label.toLowerCase()}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

const STAT_TONE: Record<"default" | "success" | "info" | "destructive", string> = {
  default: "text-foreground",
  success: "text-success",
  info: "text-info",
  destructive: "text-destructive",
};

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className={cn("text-xl sm:text-2xl font-bold", STAT_TONE[tone])}>{value}</div>
        <p className="text-muted-foreground text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}

// ── One subscription ─────────────────────────────────────────────────────────

const URGENCY_ACCENT: Record<string, string> = {
  past_due: "border-destructive/40 bg-destructive/[0.03]",
  expired: "border-warning/40 bg-warning/[0.03]",
  trial_ending: "border-info/40 bg-info/[0.03]",
  none: "border-border",
};

function SubscriptionRow({
  subscription,
  historyOpen,
  onToggleHistory,
  onRecordPayment,
  onOverride,
}: {
  subscription: Subscription;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onRecordPayment: () => void;
  onOverride: () => void;
}) {
  const state = effectiveSubscriptionState(subscription);
  const urgency = subscriptionUrgency(subscription);
  const isOrg = subscription.subjectType === "org";
  const SubjectIcon = isOrg ? Building2 : UserRound;

  const copySubjectId = () => {
    // The Clerk id is the one thing an admin needs to paste back into a support
    // chat, and it is 30-odd unselectable characters on a phone.
    navigator.clipboard
      ?.writeText(subscription.subjectId)
      .then(() => toast.success("Clerk id copied"))
      .catch(() => toast.error("Couldn't copy — select the id and copy it by hand."));
  };

  return (
    <li className={cn("rounded-xl border p-3 sm:p-4", URGENCY_ACCENT[urgency] ?? "border-border")}>
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {planLabel(subscription.plan)}
            </span>
            <Badge className={cn("rounded-full text-[10px]", STATUS_CLASS[state])}>
              {STATUS_LABEL[state]}
            </Badge>
            <Badge variant="outline" className="rounded-full text-[10px] font-normal gap-1">
              <SubjectIcon className="w-3 h-3" />
              {isOrg ? "Agency" : "Individual"}
            </Badge>
            {/* The stored column and the effective state can disagree, and the
                admin should know which one they're looking at before they
                start changing things. */}
            {subscription.status !== state && (
              <span className="text-[10px] text-muted-foreground">
                (stored as {STATUS_LABEL[subscription.status].toLowerCase()})
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 mt-1">
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {subscription.subjectId}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground"
              onClick={copySubjectId}
              aria-label="Copy Clerk id"
            >
              <ClipboardCopy className="w-3 h-3" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />
              Trial ends {formatDay(subscription.trialEndsAt)}
            </span>
            <span className="flex items-center gap-1">
              <CreditCard className="w-3 h-3" />
              Paid through {formatDay(subscription.currentPeriodEnd)}
            </span>
          </div>

          {urgency !== "none" && (
            <p
              className={cn(
                "text-[11px] font-medium mt-2",
                urgency === "past_due"
                  ? "text-destructive"
                  : urgency === "expired"
                    ? "text-warning"
                    : "text-info",
              )}
            >
              {urgency === "past_due"
                ? "Payment is late — locked out until a payment is recorded."
                : urgency === "expired"
                  ? "Locked out. Record a payment to restore access."
                  : `Trial runs out within ${TRIAL_ENDING_SOON_DAYS} days — ask for payment now.`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Button variant="hero" size="sm" onClick={onRecordPayment}>
            <Wallet className="w-4 h-4" />
            Record payment
          </Button>
          <Button variant="outline" size="sm" onClick={onToggleHistory}>
            <Receipt className="w-4 h-4" />
            History
            {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          {/* One tap straight into the confirmation, which is where the status
              is chosen. A menu here would mean opening a popover to open a
              dialog — two portals deep, on a phone, to do one thing. */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOverride}
            aria-label={`Change status for ${subscription.subjectId}`}
          >
            <Ban className="w-4 h-4" />
            Status
          </Button>
        </div>
      </div>

      {historyOpen && (
        <div className="mt-3 pt-3 border-t border-border">
          <PaymentHistory subscriptionId={subscription.id} />
        </div>
      )}
    </li>
  );
}

// ── Payment history ──────────────────────────────────────────────────────────

function PaymentHistory({ subscriptionId }: { subscriptionId: string }) {
  const { data, isPending, isError } = useSubscriptionPayments(subscriptionId);

  // Every amount is a NUMERIC(12,2) that arrived as a JS double, so summing
  // them reintroduces binary drift Postgres never had — see roundCents in
  // use-hotel-staff.ts. Round the TOTAL, not the inputs, or $99.99 + $60.00
  // prints as $159.99000000000001.
  //
  // Keyed on `data` rather than a `data ?? []` local: the fallback is a fresh
  // array identity on every render, which would make this memo recompute always
  // and mean nothing at all.
  const total = useMemo(
    () => roundCents((data ?? []).reduce((sum, payment) => sum + payment.amount, 0)),
    [data],
  );

  const payments = data ?? [];

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-destructive">
        The payment history couldn't be loaded. This is not the same as "no payments" — refresh and
        try again before recording anything.
      </p>
    );
  }

  if (payments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No payments recorded yet. If they have sent money, record it above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">
          {payments.length} payment{payments.length === 1 ? "" : "s"}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatUsd(total)} collected
        </p>
      </div>
      <ul className="space-y-2">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="rounded-lg border border-border bg-muted/30 p-2.5 flex flex-wrap items-start justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {formatUsd(payment.amount)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {SUBSCRIPTION_PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Paid {formatDay(payment.paidAt)}
                {payment.coversPeriodStart && payment.coversPeriodEnd
                  ? ` · covers ${formatIsoDay(payment.coversPeriodStart)} → ${formatIsoDay(payment.coversPeriodEnd)}`
                  : ""}
              </p>
              {payment.externalRef && (
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  Ref {payment.externalRef}
                </p>
              )}
              {payment.note && (
                <p className="text-[11px] text-muted-foreground">{payment.note}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Record payment form ──────────────────────────────────────────────────────

function RecordPaymentForm({
  subscription,
  onDone,
}: {
  subscription: Subscription;
  onDone: () => void;
}) {
  const record = useRecordSubscriptionPayment();

  const period = useMemo(() => defaultPeriod(subscription), [subscription]);

  const [amount, setAmount] = useState(() => planPrice(subscription.plan).toFixed(2));
  const [method, setMethod] = useState<SubscriptionPaymentMethod>("evc");
  const [externalRef, setExternalRef] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso);
  const [coversStart, setCoversStart] = useState(period.start);
  const [coversEnd, setCoversEnd] = useState(period.end);
  const [activate, setActivate] = useState(true);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  /**
   * ── Why a ref and not just `record.isPending` ────────────────────────────
   * Two taps on a phone land inside the same React batch. `isPending` is state:
   * the second handler runs before React has re-rendered with the first tap's
   * update, reads `false`, and fires a second INSERT — two receipts and two
   * months of credit for one $60 transfer, with nothing on screen to say so.
   * `disabled` doesn't save us either, since it only takes effect on that same
   * later render.
   *
   * A ref is written synchronously, so the second handler sees `true`
   * immediately. It is cleared in `onSettled` — NOT at the end of this
   * function, which would reopen the window while the request is still in
   * flight, and NOT in `onSuccess` alone, which would wedge the button forever
   * after a failure the admin needs to retry.
   */
  const inFlight = useRef(false);

  const parsedAmount = parseAmount(amount);
  const amountInvalid = parsedAmount === null;
  const periodInvalid = Boolean(coversStart && coversEnd && coversEnd <= coversStart);
  const activationInvalid = activate && !ISO_DATE.test(coversEnd);

  // Extending is the norm; shortening is almost always a typo in the end date.
  // Say so loudly rather than quietly cutting a paying customer's time.
  const paidThrough = isoDateOf(subscription.currentPeriodEnd);
  const wouldShorten = Boolean(activate && paidThrough && coversEnd && coversEnd < paidThrough);

  const blocked = amountInvalid || periodInvalid || activationInvalid;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (blocked) return;
    if (inFlight.current) return;
    inFlight.current = true;

    record.mutate(
      {
        subscriptionId: subscription.id,
        amount: parsedAmount ?? 0,
        method,
        externalRef: externalRef.trim() || null,
        // A date-only `paid_at` would be stored as midnight UTC and could show
        // as the previous day locally; anchor it to local noon so the day an
        // admin picked is the day everyone reads back.
        paidAt: ISO_DATE.test(paidOn) ? new Date(`${paidOn}T12:00:00`).toISOString() : null,
        coversPeriodStart: coversStart || null,
        coversPeriodEnd: coversEnd || null,
        note: note.trim() || null,
        // Receipt AND entitlement in one action. Making the admin flip the
        // status separately is exactly how a paid customer stays locked out.
        activateUntil: activate ? endOfDayIso(coversEnd) : null,
      },
      {
        onSuccess: () => onDone(),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="billing-amount" className="text-xs text-muted-foreground">
            Amount (USD)
          </Label>
          <Input
            id="billing-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => setTouched(true)}
            className="h-11 rounded-xl"
            aria-invalid={touched && amountInvalid}
          />
          {touched && amountInvalid ? (
            <p className="text-xs text-destructive">Enter the amount that arrived, in dollars.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {planLabel(subscription.plan)} is {formatUsd(planPrice(subscription.plan))} a month.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="billing-method" className="text-xs text-muted-foreground">
            Paid by
          </Label>
          <Select value={method} onValueChange={(value) => setMethod(value as SubscriptionPaymentMethod)}>
            <SelectTrigger id="billing-method" className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBSCRIPTION_PAYMENT_METHODS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="billing-ref" className="text-xs text-muted-foreground">
            Transaction reference <span className="text-muted-foreground/70">(optional)</span>
          </Label>
          <Input
            id="billing-ref"
            value={externalRef}
            onChange={(event) => setExternalRef(event.target.value)}
            placeholder="EVC confirmation code"
            maxLength={120}
            className="h-11 rounded-xl font-mono text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing-paid-on" className="text-xs text-muted-foreground">
            Paid on
          </Label>
          <Input
            id="billing-paid-on"
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
            className="h-11 rounded-xl"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
        <p className="text-xs font-medium text-foreground">Period this money covers</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="billing-from" className="text-xs text-muted-foreground">From</Label>
            <Input
              id="billing-from"
              type="date"
              value={coversStart}
              onChange={(event) => setCoversStart(event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-to" className="text-xs text-muted-foreground">To</Label>
            <Input
              id="billing-to"
              type="date"
              value={coversEnd}
              onChange={(event) => setCoversEnd(event.target.value)}
              className={cn("h-11 rounded-xl", (periodInvalid || wouldShorten) && "border-destructive")}
            />
          </div>
        </div>

        {periodInvalid ? (
          <p className="text-xs text-destructive">"To" must be after "From".</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {paidThrough && paidThrough > todayIso()
              ? `Starts where their paid time runs out (${formatIsoDay(paidThrough)}), so this month is added on top rather than replacing it.`
              : "One month from today."}
          </p>
        )}

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activate}
            onChange={(event) => setActivate(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
          />
          <span className="text-xs text-foreground">
            Activate the subscription through {formatIsoDay(coversEnd)}
            <span className="block text-muted-foreground">
              Leave this on unless you are only logging a part-payment. Turning it off records the
              money without unlocking anything.
            </span>
          </span>
        </label>

        {wouldShorten && (
          <p className="text-xs text-destructive flex items-start gap-2">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            This ends BEFORE their current paid-through date ({formatIsoDay(paidThrough)}). Saving
            will cut their access short. Check the "To" date.
          </p>
        )}
        {activationInvalid && (
          <p className="text-xs text-destructive">
            Set a "To" date, or turn off activation to record the money only.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="billing-note" className="text-xs text-muted-foreground">
          Note <span className="text-muted-foreground/70">(optional)</span>
        </Label>
        <Textarea
          id="billing-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything the next admin would need to know."
          rows={2}
          className="rounded-xl"
        />
      </div>

      <div className="rounded-xl bg-muted/50 p-3 text-xs text-foreground">
        {amountInvalid ? (
          <span className="text-muted-foreground">Enter an amount to see what will be saved.</span>
        ) : (
          <>
            Recording <span className="font-semibold">{formatUsd(parsedAmount)}</span> by{" "}
            {SUBSCRIPTION_PAYMENT_METHOD_LABELS[method]}
            {activate ? (
              <>
                {" "}and unlocking the account through{" "}
                <span className="font-semibold">{formatIsoDay(coversEnd)}</span>.
              </>
            ) : (
              <> without changing their access.</>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={record.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="hero" disabled={record.isPending || (touched && blocked)}>
          <Wallet className="w-4 h-4" />
          {record.isPending ? "Saving…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}

// ── Create subscription form ─────────────────────────────────────────────────

function CreateSubscriptionForm({ onDone }: { onDone: () => void }) {
  const create = useCreateSubscription();

  const [subjectType, setSubjectType] = useState<SubjectType>("user");
  const [subjectId, setSubjectId] = useState("");
  const [plan, setPlan] = useState<PlanId>("pms");
  const [withTrial, setWithTrial] = useState(false);
  const [touched, setTouched] = useState(false);

  // Same synchronous guard as the payment form — a duplicate here would be a
  // second row fighting the unique index, or a second trial nobody asked for.
  const inFlight = useRef(false);

  const trimmedId = subjectId.trim();
  const idInvalid = trimmedId.length < 3;
  // Clerk ids are prefixed. Warn rather than block: the prefix is a convention,
  // and refusing to save on it would strand an admin holding a valid id.
  const prefixMismatch =
    trimmedId.length > 0 && !trimmedId.startsWith(subjectType === "org" ? "org_" : "user_");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (idInvalid) return;
    if (inFlight.current) return;
    inFlight.current = true;

    create.mutate(
      { subjectType, subjectId: trimmedId, plan, withTrial },
      {
        onSuccess: () => onDone(),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="create-subject-type" className="text-xs text-muted-foreground">
            Billed to
          </Label>
          <Select value={subjectType} onValueChange={(value) => setSubjectType(value as SubjectType)}>
            <SelectTrigger id="create-subject-type" className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">An individual (Clerk user)</SelectItem>
              <SelectItem value="org">An agency (Clerk organization)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="create-plan" className="text-xs text-muted-foreground">Plan</Label>
          <Select value={plan} onValueChange={(value) => setPlan(value as PlanId)}>
            <SelectTrigger id="create-plan" className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLANS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label} — {formatUsd(option.priceUsd)}/mo
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-subject-id" className="text-xs text-muted-foreground">
          Clerk id
        </Label>
        <Input
          id="create-subject-id"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={subjectType === "org" ? "org_2cd…" : "user_2ab…"}
          className="h-11 rounded-xl font-mono text-sm"
          aria-invalid={touched && idInvalid}
        />
        {touched && idInvalid ? (
          <p className="text-xs text-destructive">
            Paste the Clerk id of the account to bill. It is shown on their row in the Users tab.
          </p>
        ) : prefixMismatch ? (
          <p className="text-xs text-warning">
            That doesn't look like a{" "}
            {subjectType === "org" ? "an organization id (org_…)" : "user id (user_…)"}. Double-check
            before saving — a subscription on the wrong id unlocks the wrong account.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            An agency's plan belongs to the organization; a solo landlord's belongs to their user.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-border bg-muted/30 p-3">
        <input
          type="checkbox"
          checked={withTrial}
          onChange={(event) => setWithTrial(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
        />
        <span className="text-xs text-foreground">
          Also open the {TRIAL_DAYS}-day free trial
          <span className="block text-muted-foreground">
            Off by default: the subscription is created locked, and the payment you record against
            it is what unlocks it. A trial is only opened once — if this account has already used
            one, nothing changes.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="hero" disabled={create.isPending || (touched && idInvalid)}>
          <Plus className="w-4 h-4" />
          {create.isPending ? "Creating…" : "Create subscription"}
        </Button>
      </div>
    </form>
  );
}

export default BillingAdminPanel;
