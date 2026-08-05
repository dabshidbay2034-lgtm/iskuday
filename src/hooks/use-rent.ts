import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { useStaff } from "@/hooks/use-staff";
import { PERMISSIONS } from "@/lib/permissions";

/**
 * Rent ledger data layer for the /manage surface (docs/PLAN_PMS_SERVICES.md §3).
 *
 * One `rent_ledger` row per property per calendar month, `period_month` always
 * being day 1 — see R-4. A boolean "paid" flag cannot answer "was March paid?",
 * so every read here is period-shaped.
 *
 * This module is also the single home for the small primitives the rest of the
 * manage surface shares — money formatting, month arithmetic and the RLS-aware
 * error describer — so `use-utilities.ts` and the manage components import them
 * from one place instead of re-implementing them.
 */

// ── Supabase access ──────────────────────────────────────────────────────────

/**
 * Every manage-surface query goes through this handle rather than importing the
 * client directly, so this module and `use-utilities.ts` stay on one code path.
 *
 * `rent_ledger`, `utility_bills` and the new `properties` columns come from the
 * foundation migration, and src/integrations/supabase/types.ts is generated from
 * it. Selects are `*` and every row is narrowed by the mappers below, so a
 * column that lands later (e.g. a dedicated `monthly_fee`, still open per plan
 * §3 Q1) is picked up without a query change.
 */
export const pmsDb = supabase;

// ── Domain types ─────────────────────────────────────────────────────────────

export type OccupancyStatus = "vacant" | "occupied";
export type RentStatus = "unpaid" | "partial" | "paid";
export type PaymentMethod = "cash" | "evc" | "zaad" | "bank" | "other";

/** Manual collection only — no payment provider integration (plan §8, D4). */
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "evc", label: "EVC Plus" },
  { value: "zaad", label: "Zaad" },
  { value: "bank", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/** A property as the management surface sees it — marketplace fields dropped. */
export type ManagedProperty = {
  id: string;
  title: string;
  location: string;
  type: string;
  occupancyStatus: OccupancyStatus;
  isListed: boolean;
  /** The rent the owner records. `properties.price` is that figure (plan §8, D1). */
  monthlyRent: number;
  isDailyRate: boolean;
  /** Null for a solo landlord's own unit — agencies only (see `usePropertyAccess`). */
  orgId: string | null;
  /** Clerk id of the individual owner. Drives the no-agency path. */
  ownerId: string | null;
};

export type RentLedgerRow = {
  /** `null` for the synthetic current-month row that has no database row yet. */
  id: string | null;
  propertyId: string;
  /** Always day 1 of the month, `YYYY-MM-01`. */
  periodMonth: string;
  amountDue: number;
  amountPaid: number;
  status: RentStatus;
  paidAt: string | null;
  markedBy: string | null;
  method: PaymentMethod | null;
  note: string | null;
};

export type PortfolioSummary = {
  totalUnits: number;
  occupied: number;
  vacant: number;
  listed: number;
  /** Rent expected for the current month across occupied units. */
  expectedThisMonth: number;
  collectedThisMonth: number;
  outstandingThisMonth: number;
  /** Unpaid balance from every month before the current one. */
  arrears: number;
};

// ── Formatting helpers (shared across the manage surface) ────────────────────

/**
 * One money formatter for the whole manage surface. Whole amounts print without
 * cents ("$1,200"), anything else keeps two decimals ("$1,200.50").
 */
export function formatMoney(value?: number | null): string {
  const amount = Number(value ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(safe) ? 0 : 2,
  }).format(safe);
}

/** `YYYY-MM-01` for the month containing `date`, in local time. */
export function monthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function currentMonthKey(): string {
  return monthKey(new Date());
}

/** `YYYY-MM-01` for the month `offset` months before the current one. */
export function monthKeyOffset(offset: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - offset);
  return monthKey(date);
}

/** "August 2026" from `2026-08-01` — parsed by hand to dodge UTC drift. */
export function formatMonthLabel(periodMonth: string): string {
  const [year, month] = periodMonth.slice(0, 10).split("-").map(Number);
  if (!year || !month) return periodMonth;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** "12 Aug 2026" from an ISO timestamp; em dash when absent. */
export function formatDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `YYYY-MM-DD` for today — the default date in the mark-paid dialog. */
export function todayInputValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The permission matrix (plan §5) is enforced in Postgres, not just in React —
 * an agent or viewer who reaches a write path anyway gets an RLS rejection.
 * Turn that into something a human can act on instead of a silent no-op.
 */
export function describeWriteError(error: unknown, fallback: string): string {
  const err = error as { code?: string; message?: string } | null;
  const message = err?.message ?? "";
  if (
    err?.code === "42501" ||
    /row-level security|violates row-level|permission denied|not authorized/i.test(message)
  ) {
    return "Your role doesn't allow this. Ask an agency admin or manager to do it.";
  }
  return message || fallback;
}

/** Surfaces a failed query as a sonner toast, once per new error. */
export function useErrorToast(error: unknown, message: string) {
  useEffect(() => {
    if (!error) return;
    toast.error(describeWriteError(error, message));
  }, [error, message]);
}

/**
 * Resolves a Clerk user id to a display name using the active organization's
 * membership list, so the ledger can say who marked a payment rather than
 * printing `user_2ab…`.
 */
export function useStaffNameLookup() {
  const { members, currentUserId } = useStaff();

  return useCallback(
    (clerkUserId?: string | null): string => {
      if (!clerkUserId) return "—";
      if (clerkUserId === currentUserId) return "You";
      const match = members.find((m) => m.userId === clerkUserId);
      return match?.fullName ?? "Staff member";
    },
    [members, currentUserId],
  );
}

// ── Row mappers ──────────────────────────────────────────────────────────────

type RawProperty = {
  id: string;
  title: string;
  location: string;
  type?: string | null;
  price?: number | null;
  monthly_fee?: number | null;
  occupancy_status?: string | null;
  is_listed?: boolean | null;
  is_available?: boolean | null;
  is_daily_rate?: boolean | null;
  org_id?: string | null;
  owner_id?: string | null;
};

function toManagedProperty(row: RawProperty): ManagedProperty {
  return {
    id: row.id,
    title: row.title,
    location: row.location,
    type: row.type ?? "property",
    occupancyStatus: row.occupancy_status === "occupied" ? "occupied" : "vacant",
    // `is_listed` is the new advertising flag; fall back to the legacy
    // `is_available` boolean until every row has been migrated (plan R-3).
    isListed: row.is_listed ?? row.is_available ?? false,
    // `properties.price` is the rent (plan §8, D1 — no `monthly_fee` column is
    // coming). The `??` is kept only so an older row shape can't read as $0.
    monthlyRent: Number(row.monthly_fee ?? row.price ?? 0),
    isDailyRate: Boolean(row.is_daily_rate),
    orgId: row.org_id ?? null,
    ownerId: row.owner_id ?? null,
  };
}

type RawRentRow = {
  id: string;
  property_id: string;
  period_month: string;
  amount_due?: number | null;
  amount_paid?: number | null;
  status?: string | null;
  paid_at?: string | null;
  marked_by?: string | null;
  method?: string | null;
  note?: string | null;
};

function toRentRow(row: RawRentRow): RentLedgerRow {
  return {
    id: row.id,
    propertyId: row.property_id,
    periodMonth: String(row.period_month).slice(0, 10),
    amountDue: Number(row.amount_due ?? 0),
    amountPaid: Number(row.amount_paid ?? 0),
    status: (row.status as RentStatus) ?? "unpaid",
    paidAt: row.paid_at ?? null,
    markedBy: row.marked_by ?? null,
    method: (row.method as PaymentMethod) ?? null,
    note: row.note ?? null,
  };
}

/** The row shown for a month that has no database row yet. */
export function placeholderRentRow(
  property: Pick<ManagedProperty, "id" | "monthlyRent">,
  periodMonth: string,
): RentLedgerRow {
  return {
    id: null,
    propertyId: property.id,
    periodMonth,
    amountDue: property.monthlyRent,
    amountPaid: 0,
    status: "unpaid",
    paidAt: null,
    markedBy: null,
    method: null,
    note: null,
  };
}

/** Outstanding balance on a row, never negative (overpayments don't credit). */
export function outstandingOf(row: Pick<RentLedgerRow, "amountDue" | "amountPaid">): number {
  return Math.max(0, Number(row.amountDue ?? 0) - Number(row.amountPaid ?? 0));
}

export function rentStatusFor(amountDue: number, amountPaid: number): RentStatus {
  if (amountPaid <= 0) return "unpaid";
  return amountPaid >= amountDue ? "paid" : "partial";
}

// ── Scope ────────────────────────────────────────────────────────────────────

/**
 * Who the manage surface is answering for.
 *
 * Two kinds of landlord use it, and both are first-class (R1):
 *
 *  - an **agency** — a Clerk Organization, whose units carry `org_id`;
 *  - a **solo owner** — someone who never created an organization, whose units
 *    carry only `owner_id`. Most small Mogadishu landlords are this.
 *
 * With an org active the portfolio is "the agency's units plus my own"; without
 * one it is strictly "my own".
 *
 * Note where the filtering happens, because the two halves are not alike:
 *
 *  - `properties` has a **public** SELECT policy — the whole marketplace is
 *    readable — so the client filter below is what keeps a stranger's unit out
 *    of the dashboard. It never filters `org_id` for a solo owner: PostgREST's
 *    `eq` does not match NULL, so `org_id.eq.<null>` would return nothing at
 *    all. The no-org branch filters on `owner_id` alone.
 *  - `rent_ledger` / `utility_bills` are **not** publicly readable and their
 *    policies already resolve org-or-owner through `public.owns_property()`.
 *    Those queries filter on `property_id` only and let the policy scope them —
 *    re-implementing the boundary in the query builder is how you end up
 *    silently excluding the very users this path exists for.
 */
export function useManageScope() {
  const { isLoaded, orgId, userId } = useAppAuth();
  return {
    isLoaded,
    orgId: orgId ?? null,
    userId: userId ?? null,
    /** No agency in play — the signed-in user is a solo landlord right now. */
    isSoloScope: !orgId,
    /** Stable per-scope suffix for query keys. */
    key: orgId ?? (userId ? `owner:${userId}` : "none"),
    ready: Boolean(isLoaded && (orgId || userId)),
  };
}

// ── Per-property permissions ─────────────────────────────────────────────────

export type PropertyAccess = {
  /** No agency active *and* this unit is the signed-in user's own. */
  isSoloOwner: boolean;
  canMarkRentPaid: boolean;
  canRecordUtilities: boolean;
  canSetOccupancy: boolean;
};

/**
 * What the signed-in user may do to **this specific unit**.
 *
 * The org permission matrix (plan §5) assumes a Clerk organization. A solo
 * landlord has no org role at all, so `can()` returns false for everything and
 * would lock them out of their own ledger. They are effectively the admin of
 * their own units, so grant them full control — but the grant keys on
 * `property.ownerId === userId`, never on "there is no org".
 *
 * That distinction is the whole safety property of this hook:
 *
 *  - solo landlord, own unit          → full control (owner_id matches)
 *  - solo landlord, someone else's id → nothing (owner_id doesn't match, and
 *                                       the query wouldn't have returned it)
 *  - org:agent inside an agency       → org matrix only; still no mark-paid,
 *                                       because an org is active
 *
 * So an agent can never reach the money control by way of this path.
 */
export function usePropertyAccess(property?: ManagedProperty | null): PropertyAccess {
  const { can, orgId, userId } = useAppAuth();

  const isSoloOwner = Boolean(
    !orgId && userId && property?.ownerId && property.ownerId === userId,
  );

  return {
    isSoloOwner,
    canMarkRentPaid: isSoloOwner || can(PERMISSIONS.RENT_MARK_PAID),
    canRecordUtilities: isSoloOwner || can(PERMISSIONS.UTILITIES_RECORD),
    canSetOccupancy: isSoloOwner || can(PERMISSIONS.PROPERTY_OCCUPANCY),
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * The portfolio: every unit belonging to the active agency, plus every unit the
 * signed-in user owns personally. Newest first.
 */
export function useOrgProperties() {
  const scope = useManageScope();

  const query = useQuery({
    queryKey: ["manage", "properties", scope.key],
    enabled: scope.ready,
    queryFn: async (): Promise<ManagedProperty[]> => {
      const base = pmsDb.from("properties").select("*");
      const scoped = scope.orgId
        ? base.or(`org_id.eq.${scope.orgId},owner_id.eq.${scope.userId}`)
        : base.eq("owner_id", scope.userId);

      const { data, error } = await scoped.order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toManagedProperty);
    },
  });

  useErrorToast(query.error, "Couldn't load your properties");
  return query;
}

/**
 * One unit, filtered to the caller's portfolio rather than trusting the id in
 * the URL — `properties` is publicly readable, so a stranger's id must come back
 * as "not found" instead of rendering a management header for it.
 */
export function useManagedProperty(propertyId?: string) {
  const scope = useManageScope();

  const query = useQuery({
    queryKey: ["manage", "property", propertyId, scope.key],
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<ManagedProperty | null> => {
      const base = pmsDb.from("properties").select("*").eq("id", propertyId);
      const scoped = scope.orgId
        ? base.or(`org_id.eq.${scope.orgId},owner_id.eq.${scope.userId}`)
        : base.eq("owner_id", scope.userId);

      const { data, error } = await scoped.maybeSingle();
      if (error) throw error;
      return data ? toManagedProperty(data) : null;
    },
  });

  useErrorToast(query.error, "Couldn't load this property");
  return query;
}

/**
 * Twelve months of ledger rows across the portfolio — powers the summary tiles.
 *
 * Keyed on the property ids rather than on `org_id`, because a ledger row for a
 * solo owner's unit has no `org_id` at all, and someone who belongs to an agency
 * may also hold units of their own. Pass the result of `useOrgProperties()`;
 * the query waits for it and short-circuits when the portfolio is empty.
 */
export function usePortfolioRent(properties?: ManagedProperty[]) {
  const scope = useManageScope();

  const propertyIds = useMemo(
    () => (properties ?? []).map((p) => p.id).sort(),
    [properties],
  );

  const query = useQuery({
    queryKey: ["manage", "rent", "portfolio", scope.key, propertyIds.join(",")],
    enabled: Boolean(scope.ready && properties),
    queryFn: async (): Promise<RentLedgerRow[]> => {
      if (propertyIds.length === 0) return [];
      const { data, error } = await pmsDb
        .from("rent_ledger")
        .select("*")
        .in("property_id", propertyIds)
        .gte("period_month", monthKeyOffset(11))
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toRentRow);
    },
  });

  useErrorToast(query.error, "Couldn't load the rent ledger");
  return query;
}

/**
 * Twelve months of ledger rows for one property, newest first, with the current
 * month always present.
 *
 * The current month's row is created lazily (R-4) — but only by someone who may
 * write to the ledger: agency managers/admins, or the solo owner of the unit.
 * Everyone else gets a client-side placeholder so viewers and agents still see
 * the month without tripping an RLS rejection.
 */
export function usePropertyRentLedger(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const { canMarkRentPaid } = usePropertyAccess(property);
  const queryClient = useQueryClient();
  const propertyId = property?.id;
  const orgId = scope.orgId;

  const query = useQuery({
    queryKey: ["manage", "rent", "property", propertyId],
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<RentLedgerRow[]> => {
      const { data, error } = await pmsDb
        .from("rent_ledger")
        .select("*")
        .eq("property_id", propertyId)
        .gte("period_month", monthKeyOffset(11))
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toRentRow);
    },
  });

  useErrorToast(query.error, "Couldn't load the rent ledger");

  const rows = useMemo<RentLedgerRow[]>(() => {
    if (!property) return [];
    const fetched = query.data ?? [];
    const thisMonth = currentMonthKey();
    const merged = fetched.some((r) => r.periodMonth === thisMonth)
      ? fetched
      : [placeholderRentRow(property, thisMonth), ...fetched];
    return [...merged].sort((a, b) => b.periodMonth.localeCompare(a.periodMonth));
  }, [property, query.data]);

  // Lazy creation of the current month's row. Guarded by a ref so a failed
  // insert (or a slow round trip) can't turn into an insert loop.
  const ensuredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!canMarkRentPaid || !propertyId || !query.data || !property) return;
    if (ensuredFor.current === propertyId) return;

    const thisMonth = currentMonthKey();
    if (query.data.some((r) => r.periodMonth === thisMonth)) return;

    ensuredFor.current = propertyId;

    void (async () => {
      const { error } = await pmsDb.from("rent_ledger").upsert(
        {
          property_id: propertyId,
          // Null for a solo owner's unit — the column is nullable, and
          // owns_property() resolves the row through properties.owner_id.
          // Never write "" here; that would match no org and no owner.
          org_id: orgId ?? null,
          period_month: thisMonth,
          amount_due: property.monthlyRent,
          amount_paid: 0,
          status: "unpaid",
        },
        { onConflict: "property_id,period_month", ignoreDuplicates: true },
      );

      if (error) {
        // Nothing the user asked for failed — the placeholder row is already on
        // screen — so log it rather than firing a toast at them.
        console.warn("[use-rent] could not open the current month's ledger row:", error);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["manage", "rent", "property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["manage", "rent", "portfolio"] });
    })();
  }, [canMarkRentPaid, orgId, property, propertyId, query.data, queryClient]);

  return { ...query, rows };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type MarkPaidInput = {
  periodMonth: string;
  amountDue: number;
  /** What the ledger already recorded — the new payment is added to it. */
  previousPaid: number;
  /** The payment being recorded now. */
  amount: number;
  method: PaymentMethod;
  /** `YYYY-MM-DD` from the date input. */
  paidDate: string;
  note?: string;
};

/**
 * Records money received against a month.
 *
 * Call sites must gate this on `usePropertyAccess(property).canMarkRentPaid` —
 * agency managers/admins, or the solo owner of the unit. Agents and viewers can
 * read the ledger but never confirm money in (plan §5, R-6), and the database
 * enforces the same rule, which is why the error path spells out the permission
 * problem.
 */
export function useMarkRentPaid(property?: ManagedProperty | null) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MarkPaidInput) => {
      if (!property) throw new Error("No property selected.");

      const amountPaid = Number(input.previousPaid ?? 0) + Number(input.amount ?? 0);
      const status = rentStatusFor(input.amountDue, amountPaid);

      const { error } = await pmsDb.from("rent_ledger").upsert(
        {
          property_id: property.id,
          // Null when there's no active agency — a solo owner's row is reached
          // through the properties.owner_id fallback in the policy, not org_id.
          org_id: orgId ?? null,
          period_month: input.periodMonth,
          amount_due: input.amountDue,
          amount_paid: amountPaid,
          status,
          paid_at: new Date(`${input.paidDate}T12:00:00`).toISOString(),
          marked_by: userId,
          method: input.method,
          note: input.note?.trim() || null,
        },
        { onConflict: "property_id,period_month" },
      );

      if (error) throw error;
      return { ...input, amountPaid, status };
    },
    onSuccess: (result) => {
      toast.success(
        result.status === "paid"
          ? `${formatMonthLabel(result.periodMonth)} marked paid`
          : `${formatMoney(result.amount)} recorded for ${formatMonthLabel(result.periodMonth)}`,
      );
      queryClient.invalidateQueries({ queryKey: ["manage", "rent", "property", property?.id] });
      // Prefix match — the portfolio key carries the scope and the id list.
      queryClient.invalidateQueries({ queryKey: ["manage", "rent", "portfolio"] });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't record the payment")),
  });
}

/**
 * Occupancy toggle on /manage/property/:id — gated on
 * `usePropertyAccess(property).canSetOccupancy`.
 */
export function useSetOccupancy(property?: ManagedProperty | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (status: OccupancyStatus) => {
      if (!property) throw new Error("No property selected.");
      const { error } = await pmsDb
        .from("properties")
        .update({
          occupancy_status: status,
          // An occupied unit must leave the marketplace but stay in the ledger
          // (plan R-3). Freeing it up does not re-advertise it automatically —
          // that stays a deliberate publish action.
          ...(status === "occupied" ? { is_listed: false } : {}),
        })
        .eq("id", property.id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === "occupied" ? "Marked as occupied" : "Marked as vacant");
      queryClient.invalidateQueries({ queryKey: ["manage", "property", property?.id] });
      queryClient.invalidateQueries({ queryKey: ["manage", "properties"] });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update occupancy")),
  });
}

// ── Derivations ──────────────────────────────────────────────────────────────

/** Index this month's ledger rows by property id. */
export function currentMonthByProperty(ledger: RentLedgerRow[]): Map<string, RentLedgerRow> {
  const thisMonth = currentMonthKey();
  const map = new Map<string, RentLedgerRow>();
  for (const row of ledger) {
    if (row.periodMonth === thisMonth) map.set(row.propertyId, row);
  }
  return map;
}

/**
 * Summary tiles for /manage.
 *
 * Expected rent counts occupied units plus any month that already has a ledger
 * row — a vacant unit isn't owed rent, but one that was tenanted earlier in the
 * month still is. Arrears look only at months before the current one.
 */
export function buildPortfolioSummary(
  properties: ManagedProperty[],
  ledger: RentLedgerRow[],
): PortfolioSummary {
  const thisMonth = currentMonthKey();
  const currentRows = currentMonthByProperty(ledger);

  let expectedThisMonth = 0;
  let collectedThisMonth = 0;
  let occupied = 0;
  let listed = 0;

  for (const property of properties) {
    if (property.occupancyStatus === "occupied") occupied += 1;
    if (property.isListed) listed += 1;

    const row = currentRows.get(property.id);
    if (row) {
      expectedThisMonth += row.amountDue;
      collectedThisMonth += row.amountPaid;
    } else if (property.occupancyStatus === "occupied") {
      expectedThisMonth += property.monthlyRent;
    }
  }

  const arrears = ledger
    .filter((row) => row.periodMonth < thisMonth)
    .reduce((total, row) => total + outstandingOf(row), 0);

  return {
    totalUnits: properties.length,
    occupied,
    vacant: properties.length - occupied,
    listed,
    expectedThisMonth,
    collectedThisMonth,
    outstandingThisMonth: Math.max(0, expectedThisMonth - collectedThisMonth),
    arrears,
  };
}
