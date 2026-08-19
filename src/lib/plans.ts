import type { AccountKind } from "@/lib/account-type";

/**
 * The plan catalogue. PURE — no React, no Supabase, no imports beyond the
 * AccountKind type, so it can be read from a component, a hook, a test or a
 * future edge function without dragging the data layer along.
 *
 * TWO OFFERINGS, not two disconnected products:
 *
 *   hotel  $99.99/mo — hotel operations + property management bundled together
 *   pms    $60.00/mo — PMS only for agencies and landlords
 *
 * The hotel bundle is the full product stack a hotel business needs. The PMS
 * plan remains a separate, cheaper option for rental businesses without hotel
 * management features.
 *
 * Both open with a 14-day free trial.
 *
 * NO PROCESSOR IS MODELLED HERE. There is no `stripePriceId`, and there should
 * not be one: Stripe does not support Somalia as a business location and this
 * market pays by mobile money. `priceUsd` is a NUMBER the UI formats and an
 * admin reconciles against — capture stays pluggable. See the header of
 * supabase/migrations/20260816000001_subscriptions.sql.
 */

export type PlanId = "hotel" | "pms";

export type Plan = {
  id: PlanId;
  label: string;
  /** One line under the price, for the plan cards. */
  tagline: string;
  /** Monthly price in US dollars. Money, so it is compared and printed at 2dp. */
  priceUsd: number;
  /** What the money unlocks, in the order a buyer cares about it. */
  features: string[];
  /**
   * Which kinds of account this plan is FOR.
   *
   * `platform` (admins) and `none` (renters) map to no plan at all: an admin
   * doesn't buy the product and a renter browsing listings never reaches a paid
   * surface. Neither is an oversight — see planForAccountKind().
   */
  accountKinds: AccountKind[];
};

/** Free trial length, in days. Mirrored in SQL by public.start_trial(). */
export const TRIAL_DAYS = 14;

/**
 * Ordered for display: hotel first, because it is the flagship and the anchor
 * price that makes the PMS plan read as the affordable one.
 */
export const PLANS: Plan[] = [
  {
    id: "hotel",
    label: "Hotel Management + PMS",
    tagline: "The complete hotel package — rooms, bookings, staff and rent operations in one place.",
    priceUsd: 99.99,
    features: [
      "Hotel rooms, rates and reservation requests",
      "Front desk: arrivals, departures and in-house guests",
      "Bookings, housekeeping and staff payroll",
      "Your own hotel web page on a subdomain",
      "PMS tools: rent ledger, utilities and maintenance",
      "Lease documents, tenant records and portfolio visibility",
    ],
    accountKinds: ["hotel"],
  },
  {
    id: "pms",
    label: "PMS Only",
    tagline: "For agencies and landlords that need property management without hotel operations.",
    priceUsd: 60.0,
    features: [
      "Rent ledger, month by month",
      "Utility bills per unit",
      "Expenses and maintenance work orders",
      "Lease documents",
      "Tenant records",
      "Portfolio dashboard with arrears",
    ],
    accountKinds: ["agency", "landlord"],
  },
];

/**
 * Which plans satisfy a requirement for `plan`.
 *
 * The hotel plan is sold as "Hotel Management + PMS" and its feature list
 * promises the rent ledger, utilities, maintenance, leases and tenant records —
 * the PMS product, included. So a hotel subscriber asked for `pms` is entitled.
 *
 * This existed only in the marketing copy. `useMySubscription` matched the plan
 * exactly, so a hotel manager paying $99.99 was refused at every
 * `BillingGate plan="pms"` — which is the whole of `/manage/property/:id`. They
 * were sold the PMS tools and locked out of them.
 *
 * Not symmetric, deliberately: PMS does not include hotel operations, which is
 * the difference the higher price buys.
 */
export const PLAN_COVERAGE: Record<PlanId, PlanId[]> = {
  hotel: ["hotel"],
  pms: ["pms", "hotel"],
};

/** Every plan whose subscription would satisfy a gate asking for `plan`. */
export function plansCovering(plan: PlanId): PlanId[] {
  return PLAN_COVERAGE[plan] ?? [plan];
}

/** Indexed lookup. Built from PLANS so the two can never disagree. */
const PLAN_BY_ID: Record<PlanId, Plan> = PLANS.reduce(
  (acc, plan) => {
    acc[plan.id] = plan;
    return acc;
  },
  // Seeded through a cast rather than built with Object.fromEntries, which
  // erases the key union down to `string` and loses the Record's check — the
  // same trap TYPE_LABEL documents in PayrollPage.tsx.
  {} as Record<PlanId, Plan>,
);

export function planById(id: PlanId): Plan {
  return PLAN_BY_ID[id];
}

/**
 * The plan an account of this kind would buy, or null when it wouldn't.
 *
 * A hotel buys the hotel plan; an agency and a solo landlord both buy the PMS
 * plan, because they do the same job at different scale. Platform admins and
 * plain renters return null — they never reach a paid surface, and returning a
 * plan for them would make a paywall appear on a marketplace page.
 */
export function planForAccountKind(kind: AccountKind): PlanId | null {
  switch (kind) {
    case "hotel":
      return "hotel";
    case "agency":
    case "landlord":
      return "pms";
    default:
      return null;
  }
}

/**
 * "$99.99" / "$60.00" — always two decimals.
 *
 * NOT formatMoney() from use-rent.ts. That one drops the cents on whole amounts
 * ("$60"), which is right for a rent ledger and wrong for a price tag: a price
 * list where one plan shows cents and the other doesn't looks like a bug, and
 * "$60" next to "$99.99" reads as an approximation.
 */
export function formatPlanPrice(plan: Plan | PlanId): string {
  const value = typeof plan === "string" ? planById(plan).priceUsd : plan.priceUsd;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * When a trial that started at `startedAt` runs out.
 *
 * ADVISORY ONLY on the client. The real trial_ends_at is computed by Postgres
 * inside public.start_trial() (`now() + 14 days`), precisely so a device with a
 * wrong clock — or a user who sets one deliberately — cannot mint themselves a
 * longer trial. Use this to preview a date, never to decide entitlement.
 */
export function trialEndsAt(startedAt: Date | string = new Date()): Date {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const base = Number.isNaN(start.getTime()) ? new Date() : start;
  const end = new Date(base.getTime());
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}

/**
 * Whole days left on a trial, floored at 0.
 *
 * Rounded UP, so the last partial day still reads "1 day left" rather than
 * "0 days left" while the account is very much still working. Returns null when
 * there is no trial end to count towards — an unbounded trial is not a
 * zero-day one, and the banner must not claim it is.
 */
export function trialDaysRemaining(
  trialEnd: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!trialEnd) return null;
  const end = trialEnd instanceof Date ? trialEnd : new Date(trialEnd);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}
