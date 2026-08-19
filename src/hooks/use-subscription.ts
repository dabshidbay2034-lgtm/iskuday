import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError, pmsDb, useErrorToast } from "@/hooks/use-rent";
import { TRIAL_DAYS, planById, trialDaysRemaining, type PlanId } from "@/lib/plans";
import { looseFrom } from "@/lib/supabase-loose";

/**
 * Subscription + trial data layer (migration 20260816000001).
 *
 * Two plans, one 14-day trial each, and NO payment processor — Stripe does not
 * support Somalia as a business location and this market pays by mobile money.
 * Payments are recorded by a platform admin who has confirmed an EVC / Zaad /
 * Sifalo Pay transfer actually landed. That manual path is first-class, not a
 * placeholder; see the migration header before wiring a rail up.
 *
 * ── THE RULE THAT SHAPES THIS WHOLE MODULE ──────────────────────────────────
 * The client CANNOT write a subscription. `subscriptions` and
 * `subscription_payments` have no subscriber-facing INSERT/UPDATE/DELETE
 * policy at all — only a platform admin writes them. So:
 *
 *   • useStartTrial() goes through the `start_trial()` RPC, not an INSERT. The
 *     RPC is SECURITY DEFINER and hard-codes `status='trialing'` and
 *     `now() + 14 days`, so the browser never gets to name either value.
 *     (A plain `.insert({ status: 'trialing' })` from here would be rejected by
 *     RLS — that is the design, not a bug to route around.)
 *   • useRecordSubscriptionPayment() is admin-only and will be refused by the
 *     database for anyone else, whatever the UI does.
 *
 * Everything else here is a read.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `subscriptions`, `subscription_payments` and the two functions post-date the
// generated types (they only appear once `supabase gen types` runs against a
// database with 20260816000001 applied), so this module goes through loose
// accessors and narrows every row itself — same pattern as use-staff-documents.

const looseRpc = (fn: string, args?: Record<string, unknown>) =>
  (pmsDb as unknown as {
    rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(fn, args);

// ── Domain types ─────────────────────────────────────────────────────────────

/** Whether the subscriber is a Clerk organization or an individual user. */
export type SubjectType = "user" | "org";

/** The five stored statuses, plus 'none' for "never subscribed". */
export type SubscriptionState =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

/**
 * How the subscription was paid.
 *
 * The rent-collection vocabulary (`PaymentMethod` in use-rent.ts) PLUS
 * 'sifalo'. The two lists have deliberately diverged: Sifalo Pay is how
 * operators pay US, and nobody has asked for it as a way tenants pay their
 * landlord. Don't unify them — `rent_ledger.method` has its own CHECK in its
 * own applied migration, and widening it needs its own migration.
 */
export type SubscriptionPaymentMethod =
  | "cash"
  | "evc"
  | "zaad"
  | "sifalo"
  | "bank"
  | "other";

/** Ordered for the UI: the rails operators actually use, first. */
export const SUBSCRIPTION_PAYMENT_METHODS: {
  value: SubscriptionPaymentMethod;
  label: string;
}[] = [
  { value: "evc", label: "EVC Plus" },
  { value: "zaad", label: "Zaad" },
  { value: "sifalo", label: "Sifalo Pay" },
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export const SUBSCRIPTION_PAYMENT_METHOD_LABELS: Record<SubscriptionPaymentMethod, string> = {
  cash: "Cash",
  evc: "EVC Plus",
  zaad: "Zaad",
  sifalo: "Sifalo Pay",
  bank: "Bank transfer",
  other: "Other",
};

export type Subscription = {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  plan: PlanId;
  /** The RECORDED status. Read `effectiveSubscriptionState()`, not this. */
  status: SubscriptionState;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type SubscriptionPayment = {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  method: SubscriptionPaymentMethod;
  /** EVC/Zaad/Sifalo transaction id, when there is one. Cash has none. */
  externalRef: string | null;
  paidAt: string;
  coversPeriodStart: string | null;
  coversPeriodEnd: string | null;
  recordedBy: string | null;
  note: string | null;
  createdAt: string | null;
};

// ── Row mappers ──────────────────────────────────────────────────────────────

type RawSubscription = {
  id: string;
  subject_type?: string | null;
  subject_id?: string | null;
  plan?: string | null;
  status?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function toSubscription(row: RawSubscription): Subscription {
  return {
    id: row.id,
    subjectType: (row.subject_type as SubjectType) ?? "user",
    subjectId: row.subject_id ?? "",
    plan: (row.plan as PlanId) ?? "pms",
    status: (row.status as SubscriptionState) ?? "expired",
    trialEndsAt: row.trial_ends_at ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

type RawPayment = {
  id: string;
  subscription_id: string;
  amount?: number | string | null;
  currency?: string | null;
  method?: string | null;
  external_ref?: string | null;
  paid_at?: string | null;
  covers_period_start?: string | null;
  covers_period_end?: string | null;
  recorded_by?: string | null;
  note?: string | null;
  created_at?: string | null;
};

function toPayment(row: RawPayment): SubscriptionPayment {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    // NUMERIC(12,2) can arrive as a string from PostgREST depending on the
    // column's precision handling; Number() it once here so no call site has to
    // remember, and every total downstream is arithmetic on a number.
    amount: Number(row.amount ?? 0),
    currency: row.currency ?? "USD",
    method: (row.method as SubscriptionPaymentMethod) ?? "other",
    externalRef: row.external_ref ?? null,
    paidAt: row.paid_at ?? "",
    // DATE columns can come back as full timestamps; slice so `<input
    // type="date">` and any date maths agree — same fix as use-staff-documents.
    coversPeriodStart: row.covers_period_start
      ? String(row.covers_period_start).slice(0, 10)
      : null,
    coversPeriodEnd: row.covers_period_end
      ? String(row.covers_period_end).slice(0, 10)
      : null,
    recordedBy: row.recorded_by ?? null,
    note: row.note ?? null,
    createdAt: row.created_at ?? null,
  };
}

// ── The effective state ──────────────────────────────────────────────────────

/**
 * The state that actually decides entitlement, computed against the clock.
 *
 * ⚠ THIS MIRRORS public.subscription_state() IN THE MIGRATION LINE FOR LINE.
 * Change one and you must change the other. They exist as a pair because RLS
 * cannot call TypeScript: any future server-side gate (a policy on another
 * table, an edge function handling a payment rail's callback) has to use the
 * SQL one, while this one saves the UI a second round trip on every render.
 *
 * WHY A STALE `status` CANNOT BE TRUSTED: nothing runs a cron against this
 * database. A row written 'trialing' on day 1 is still literally 'trialing' on
 * day 400 — nobody ever went back to change it. Reading `status` alone hands a
 * free subscription to every account that once opened a trial.
 *
 * WHY 'active' IS **NOT** DEMOTED THE SAME WAY: a lapsed `currentPeriodEnd`
 * means either "they stopped paying" or "they paid by EVC on Sunday and an
 * admin confirms it on Tuesday". With a manual rail the second is routine, and
 * locking a paying customer out of their own rent records because an admin was
 * slow is much worse than a couple of unbilled days. An admin moves them to
 * past_due or expired deliberately.
 */
export function effectiveSubscriptionState(
  subscription: Subscription | null | undefined,
  now: Date = new Date(),
): SubscriptionState {
  if (!subscription) return "none";

  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    const ends = new Date(subscription.trialEndsAt);
    if (!Number.isNaN(ends.getTime()) && ends.getTime() <= now.getTime()) {
      return "expired";
    }
  }

  return subscription.status;
}

/**
 * The whole entitlement question, in one boolean.
 *
 * Exactly two states pay for the product: an in-flight trial and an active
 * subscription. `past_due`, `canceled`, `expired` and `none` do not — and
 * `none` in particular must be false, or an account that never started a trial
 * would get the product for nothing.
 */
export function isEntitledState(state: SubscriptionState): boolean {
  return state === "trialing" || state === "active";
}

// ── Subject ──────────────────────────────────────────────────────────────────

export type SubscriptionSubject = {
  isLoaded: boolean;
  subjectType: SubjectType;
  subjectId: string | null;
  /** Stable per-subject suffix for query keys. */
  key: string;
  ready: boolean;
};

/**
 * WHO is being billed.
 *
 * Mirrors `useManageScope()` in use-rent.ts on purpose: with an agency active
 * the subject is the Clerk organization, and without one it is the signed-in
 * user. Most small Mogadishu landlords never create an organization, so the
 * user branch is the common case, not the fallback.
 *
 * A consequence worth knowing: switching the active organization switches which
 * subscription you are looking at. That is correct — the agency's plan is the
 * agency's, and a staff member's personal units are on their own — and it is
 * why the query keys below carry `key` rather than just the plan.
 */
export function useSubscriptionSubject(): SubscriptionSubject {
  const { isLoaded, orgId, userId } = useAppAuth();
  const subjectType: SubjectType = orgId ? "org" : "user";
  const subjectId = orgId ?? userId ?? null;

  return {
    isLoaded,
    subjectType,
    subjectId,
    key: subjectId ? `${subjectType}:${subjectId}` : "none",
    ready: Boolean(isLoaded && subjectId),
  };
}

// ── Query keys ───────────────────────────────────────────────────────────────

/**
 * Called with fewer arguments these MUST return a shorter PREFIX, never a key
 * padded out with `undefined`.
 *
 * TanStack matches partially by walking the filter array element by element, so
 * `["subscription", undefined, undefined]` compares `undefined` against the
 * live key's subject and mismatches — invalidating NOTHING while the mutation
 * cheerfully toasts success and the screen keeps showing the old plan. That
 * exact bug has shipped twice in this codebase (see payrollKey and
 * staffDocumentsKey); this is the third place it would have.
 */
export const subscriptionKey = (subjectKey?: string, plan?: PlanId) => {
  if (!subjectKey) return ["subscription"] as const;
  if (!plan) return ["subscription", subjectKey] as const;
  return ["subscription", subjectKey, plan] as const;
};

/**
 * Deliberately nested under the same "subscription" root, so invalidating
 * `subscriptionKey()` after recording a payment refreshes the receipts too.
 */
export const subscriptionPaymentsKey = (subscriptionId?: string) =>
  subscriptionId
    ? (["subscription", "payments", subscriptionId] as const)
    : (["subscription", "payments"] as const);

/**
 * Every subscription on the platform — the admin billing list.
 *
 * Deliberately under the same "subscription" root as the two factories above,
 * so a mutation that invalidates the bare `subscriptionKey()` prefix (which is
 * exactly what useRecordSubscriptionPayment does, because it knows neither the
 * subject nor the plan) refreshes this list too. A sibling root such as
 * ["admin-subscriptions"] would have left an admin staring at 'past_due'
 * one second after they activated the account.
 *
 * Takes no arguments ON PURPOSE. Filtering happens in useSubscriptionSearch()
 * over the rows already in the cache, so typing in the search box cannot fire a
 * query per keystroke — and there is no parameter here that could arrive
 * `undefined` and produce a key that matches nothing.
 */
export const allSubscriptionsKey = () => ["subscription", "admin", "all"] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * This subject's subscription for one plan, or null when they have never
 * started a trial.
 *
 * Fetched with `.limit(1)` rather than `.maybeSingle()`. The unique index makes
 * a second row impossible, but maybeSingle THROWS on multiple rows (PostgREST
 * 406) — and a query that throws here resolves the state to "unknown", which
 * the gate would have to read as either a lockout or a giveaway. Taking the
 * first row degrades gracefully instead, exactly as useAppAuth does for
 * user_roles.
 */
export function useMySubscription(plan: PlanId) {
  const subject = useSubscriptionSubject();

  const query = useQuery({
    queryKey: subscriptionKey(subject.key, plan),
    enabled: subject.ready,
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await looseFrom("subscriptions")
        .select("*")
        .eq("subject_type", subject.subjectType)
        .eq("subject_id", subject.subjectId)
        .eq("plan", plan)
        .limit(1);
      if (error) throw error;
      const rows = (data as RawSubscription[]) ?? [];
      return rows.length > 0 ? toSubscription(rows[0]) : null;
    },
  });

  useErrorToast(query.error, "Couldn't load your subscription");
  return query;
}

/**
 * The receipts for a subscription, newest first.
 *
 * RLS scopes these to the subject (or an admin), so there is no ownership
 * filter in the query builder — re-implementing the boundary here is how you
 * end up silently excluding the very rows the page exists to show.
 */
export function useSubscriptionPayments(subscriptionId?: string) {
  const { isSignedIn } = useAppAuth();

  const query = useQuery({
    queryKey: subscriptionPaymentsKey(subscriptionId),
    enabled: Boolean(isSignedIn && subscriptionId),
    queryFn: async (): Promise<SubscriptionPayment[]> => {
      const { data, error } = await looseFrom("subscription_payments")
        .select("*")
        .eq("subscription_id", subscriptionId)
        .order("paid_at", { ascending: false });
      if (error) throw error;
      return ((data as RawPayment[]) ?? []).map(toPayment);
    },
  });

  useErrorToast(query.error, "Couldn't load your payment history");
  return query;
}

// ── Entitlement ──────────────────────────────────────────────────────────────

export type Entitlement = {
  /** Still resolving Clerk or the subscription row. */
  isPending: boolean;
  state: SubscriptionState;
  /** True for `trialing` and `active` ONLY. */
  isEntitled: boolean;
  isTrialing: boolean;
  isExpired: boolean;
  /** Whole days left, rounded up. Null unless a trial is actually running. */
  daysLeftInTrial: number | null;
  /** The row itself, for pages that want the dates. */
  subscription: Subscription | null;
};

/**
 * The one hook a gate should call.
 *
 * `isPending` is part of the contract, not an implementation detail: callers
 * MUST NOT treat "not yet loaded" as "not entitled". While this is pending,
 * `state` is 'none' and `isEntitled` is false simply because nothing is known
 * yet — rendering a paywall on that would flash one at a paying customer on
 * every single navigation. BillingGate renders children while pending for
 * exactly this reason.
 */
export function useEntitlement(plan: PlanId): Entitlement {
  const subject = useSubscriptionSubject();
  const query = useMySubscription(plan);

  const subscription = query.data ?? null;

  // Recomputed per render rather than memoised on a timer. The state only
  // changes when the clock crosses trial_ends_at, and a user sitting on the
  // page as their trial lapses will see it on their next interaction — which is
  // soon enough, and much cheaper than an interval ticking in every gate.
  return useMemo(() => {
    const state = effectiveSubscriptionState(subscription);
    const isTrialing = state === "trialing";

    return {
      /**
       * A FAILED query counts as "not known yet", not as "not entitled".
       *
       * Without `query.isError` here, any failure — a dropped connection, an
       * RLS change, this migration simply not being applied yet — resolves the
       * state to 'none' and HARD-LOCKS every paying customer at once. That is
       * the worst possible failure for a paywall: the people who suffer are
       * exactly the ones who paid.
       *
       * Failing open is safe here because this gate is a COMMERCIAL control,
       * not a security boundary. It guards no data — every table behind it is
       * independently protected by RLS, which does not consult subscription
       * status at all. So the cost of failing open is a few minutes of
       * unbilled access; the cost of failing closed is locking out the entire
       * paying customer base on a transient error.
       */
      isPending: !subject.isLoaded || query.isPending || query.isError,
      state,
      isEntitled: isEntitledState(state),
      isTrialing,
      isExpired: state === "expired",
      daysLeftInTrial: isTrialing ? trialDaysRemaining(subscription?.trialEndsAt) : null,
      subscription,
    };
  }, [subject.isLoaded, query.isPending, query.isError, subscription]);
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Start the 14-day trial for a plan.
 *
 * Goes through the `start_trial` RPC rather than an INSERT, because the client
 * has no INSERT privilege on `subscriptions` — see the module header. The RPC
 * fixes `status='trialing'` and `trial_ends_at = now() + 14 days` server-side,
 * so neither this file nor a browser console can name a longer trial.
 *
 * IDEMPOTENT, and that is also what stops a used trial being restarted: the
 * RPC's INSERT is `ON CONFLICT DO NOTHING` against the unique
 * (subject_type, subject_id, plan) index, so a second call on an existing
 * subscription changes nothing at all and returns the current state. Calling it
 * after the trial lapsed returns 'expired' — it does not start a fresh 14 days.
 */
export function useStartTrial(plan: PlanId) {
  const subject = useSubscriptionSubject();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<SubscriptionState> => {
      if (!subject.ready || !subject.subjectId) {
        throw new Error("You must be signed in to start a trial.");
      }

      const { data, error } = await looseRpc("start_trial", {
        _subject_type: subject.subjectType,
        _subject_id: subject.subjectId,
        _plan: plan,
      });
      if (error) throw error;
      return (data as SubscriptionState) ?? "none";
    },
    onSuccess: (state) => {
      if (state === "trialing") {
        toast.success(`Your ${TRIAL_DAYS}-day free trial has started`);
      } else {
        // The RPC was a no-op because a subscription already exists. Say so,
        // rather than claiming a trial started that didn't — someone whose
        // trial ran out yesterday must not be told they have 14 fresh days.
        toast.info("This account already has a subscription on this plan.");
      }
      queryClient.invalidateQueries({ queryKey: subscriptionKey(subject.key, plan) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't start your trial")),
  });
}

export type RecordSubscriptionPaymentInput = {
  subscriptionId: string;
  /** Dollars. Rounded to cents before it is sent — the column is NUMERIC(12,2). */
  amount: number;
  currency?: string;
  method: SubscriptionPaymentMethod;
  /** The EVC / Zaad / Sifalo transaction id, when the operator quoted one. */
  externalRef?: string | null;
  /** ISO timestamp; defaults to now. */
  paidAt?: string | null;
  coversPeriodStart?: string | null;
  coversPeriodEnd?: string | null;
  note?: string | null;
  /**
   * Move the subscription to 'active' through this date, in one go.
   *
   * This is the day-one flow in a single action: an admin confirms the Zaad
   * transfer landed, records the receipt AND opens the paid period. Omit it to
   * log a payment without changing entitlement (a part-payment, or a receipt
   * being backfilled after the fact).
   */
  activateUntil?: string | null;
};

/**
 * Record money received against a subscription. PLATFORM ADMIN ONLY.
 *
 * With no processor, this IS the payment rail: an operator sends $60 over EVC,
 * Zaad or Sifalo Pay, an admin confirms it arrived and records it here. When a
 * rail is eventually chosen it writes the same two rows from a service-role
 * edge function, and this hook stays as the manual fallback — which will always
 * be needed, because cash exists.
 *
 * The database enforces the admin restriction; the guard below is only there so
 * a misplaced button gives a sentence instead of a raw 42501. Both matter: the
 * client check can be bypassed and is not security, the RLS check is.
 */
export function useRecordSubscriptionPayment() {
  const { userId, platformRole } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordSubscriptionPaymentInput) => {
      if (platformRole !== "admin") {
        throw new Error("Only a platform admin can record a subscription payment.");
      }

      // NUMERIC(12,2) in Postgres, a double in JS. Round at the boundary so a
      // total assembled in the browser can't arrive as 99.99000000000001 and be
      // silently truncated by the column.
      const amount = Number.isFinite(input.amount)
        ? Math.round(input.amount * 100) / 100
        : 0;

      const { data, error } = await looseFrom("subscription_payments")
        .insert({
          subscription_id: input.subscriptionId,
          amount,
          currency: input.currency ?? "USD",
          method: input.method,
          external_ref: input.externalRef?.trim() || null,
          paid_at: input.paidAt || new Date().toISOString(),
          covers_period_start: input.coversPeriodStart || null,
          covers_period_end: input.coversPeriodEnd || null,
          recorded_by: userId,
          note: input.note?.trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;

      // Receipt first, entitlement second. If this update fails the money is
      // still on record and an admin can retry; doing it the other way round
      // could leave an account activated with no evidence of why.
      if (input.activateUntil) {
        const { error: subError } = await looseFrom("subscriptions")
          .update({ status: "active", current_period_end: input.activateUntil })
          .eq("id", input.subscriptionId);
        if (subError) throw subError;
      }

      return toPayment(data as RawPayment);
    },
    onSuccess: (payment) => {
      toast.success("Payment recorded");
      queryClient.invalidateQueries({
        queryKey: subscriptionPaymentsKey(payment.subscriptionId),
      });
      // Prefix match — the subscription key carries the subject and the plan,
      // neither of which this mutation knows. `["subscription"]` is a real
      // prefix and matches both, which is the whole reason the factory returns
      // one when called bare.
      queryClient.invalidateQueries({ queryKey: subscriptionKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't record the payment")),
  });
}

// ── Admin reads ──────────────────────────────────────────────────────────────
//
// The platform-admin billing surface. RLS is what actually decides these rows
// are visible — "Subject sees own subscription" lets has_role(…,'admin')
// through, so no ownership filter belongs in the query builder. The `enabled`
// guard below is only there to stop a non-admin firing a request that could
// only ever come back empty; it is not the boundary.

/**
 * A trial with this many days or fewer left is already something to chase — the
 * operator has to be asked for money BEFORE the lockout, not after it.
 */
export const TRIAL_ENDING_SOON_DAYS = 3;

/** Why a subscription is in the admin's way today, or 'none'. */
export type SubscriptionUrgency = "past_due" | "expired" | "trial_ending" | "none";

/**
 * Computed from the EFFECTIVE state, not the stored column, so a trial that ran
 * out in March surfaces as work to do even though its row still literally says
 * 'trialing' — nothing runs a cron to correct it.
 */
export function subscriptionUrgency(
  subscription: Subscription,
  now: Date = new Date(),
): SubscriptionUrgency {
  const state = effectiveSubscriptionState(subscription, now);
  if (state === "past_due") return "past_due";
  if (state === "expired") return "expired";
  if (state === "trialing") {
    const left = trialDaysRemaining(subscription.trialEndsAt, now);
    if (left !== null && left <= TRIAL_ENDING_SOON_DAYS) return "trial_ending";
  }
  return "none";
}

const URGENCY_RANK: Record<SubscriptionUrgency, number> = {
  past_due: 0,
  expired: 1,
  trial_ending: 2,
  none: 3,
};

/** The date this row is counting down to, for the within-bucket ordering. */
function deadlineMs(subscription: Subscription): number {
  const raw =
    subscription.status === "trialing"
      ? subscription.trialEndsAt ?? subscription.currentPeriodEnd
      : subscription.currentPeriodEnd ?? subscription.trialEndsAt;
  const ms = raw ? new Date(raw).getTime() : Number.NaN;
  // A row with no date at all sorts last inside its bucket rather than first —
  // "unknown" is not "overdue since 1970".
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Broken first, then soonest-to-break.
 *
 * Returns a NEW array. The input is the array TanStack is holding in its cache;
 * sorting it in place would mutate cached data behind React's back and reorder
 * rows for every other consumer without any of them re-rendering.
 */
export function sortSubscriptionsByUrgency(
  rows: Subscription[],
  now: Date = new Date(),
): Subscription[] {
  return [...rows].sort((a, b) => {
    const rankA = URGENCY_RANK[subscriptionUrgency(a, now)];
    const rankB = URGENCY_RANK[subscriptionUrgency(b, now)];
    if (rankA !== rankB) return rankA - rankB;

    const deadlineA = deadlineMs(a);
    const deadlineB = deadlineMs(b);
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;

    // Total order, so React keys never shuffle between renders on a tie.
    return a.subjectId.localeCompare(b.subjectId) || a.plan.localeCompare(b.plan);
  });
}

/**
 * Every subscription on the platform. PLATFORM ADMIN ONLY.
 *
 * Unpaginated on purpose: this is a manual billing rail run by one or two
 * people, so the table is in the hundreds, not the millions, and an admin
 * chasing a payment at 11pm needs Ctrl-F over everything rather than a page
 * control. Revisit when the row count makes that untrue, not before.
 */
export function useAllSubscriptions() {
  const { isLoaded, isSignedIn, platformRole } = useAppAuth();
  const isAdmin = Boolean(isLoaded && isSignedIn && platformRole === "admin");

  const query = useQuery({
    queryKey: allSubscriptionsKey(),
    enabled: isAdmin,
    queryFn: async (): Promise<Subscription[]> => {
      const { data, error } = await looseFrom("subscriptions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as RawSubscription[]) ?? []).map(toSubscription);
    },
  });

  useErrorToast(query.error, "Couldn't load subscriptions");
  return query;
}

/**
 * Filter by free text, then order by urgency. Client-side over the cached rows,
 * so the list stays responsive on a phone and a typo doesn't cost a round trip.
 *
 * Matches the Clerk subject id (what an admin actually pastes in from a support
 * chat), the plan by id and by label, and the effective status spelled both
 * `past_due` and "past due" — nobody types the underscore.
 */
export function useSubscriptionSearch(
  subscriptions: Subscription[] | undefined,
  term: string,
): Subscription[] {
  return useMemo(() => {
    const rows = subscriptions ?? [];
    const needle = term.trim().toLowerCase();

    const matched = needle
      ? rows.filter((row) => {
          const state = effectiveSubscriptionState(row);
          const haystack = [
            row.subjectId,
            row.subjectType,
            row.plan,
            planById(row.plan)?.label ?? "",
            state,
            state.replace(/_/g, " "),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        })
      : rows;

    return sortSubscriptionsByUrgency(matched);
  }, [subscriptions, term]);
}
