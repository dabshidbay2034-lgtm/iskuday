import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import {
  currentMonthKey,
  describeWriteError,
  monthKeyOffset,
  pmsDb,
  useErrorToast,
  useManageScope,
  type ManagedProperty,
} from "@/hooks/use-rent";

/**
 * Utility bills for the /manage surface (docs/PLAN_PMS_SERVICES.md §3, R-8).
 *
 * One `utility_bills` row per property per month per `utility_type`, rather than
 * an electricity column and a water column — a third utility (generator,
 * rubbish, security) is a matter of time and costs nothing to allow for now.
 *
 * Recording a bill is data entry, so **agents may do it** — unlike marking rent
 * paid, which is a financial control withheld from them (plan §5).
 *
 * Shared primitives (money formatting, month helpers, the RLS-aware error
 * describer, the Supabase access shim) come from `use-rent.ts` so the manage
 * surface has exactly one copy of each.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type UtilityType = "electricity" | "water" | "other";
export type UtilityStatus = "unpaid" | "paid";

export const UTILITY_TYPES: { value: UtilityType; label: string }[] = [
  { value: "electricity", label: "Electricity" },
  { value: "water", label: "Water" },
  { value: "other", label: "Other" },
];

export const UTILITY_TYPE_LABELS: Record<UtilityType, string> = {
  electricity: "Electricity",
  water: "Water",
  other: "Other",
};

export type UtilityBillRow = {
  id: string;
  propertyId: string;
  /** Always day 1 of the month, `YYYY-MM-01`. */
  periodMonth: string;
  utilityType: UtilityType;
  amount: number;
  meterReading: number | null;
  status: UtilityStatus;
  recordedBy: string | null;
  note: string | null;
};

/** Bills for one month, plus the cross-utility total for that month. */
export type UtilityMonthGroup = {
  periodMonth: string;
  bills: UtilityBillRow[];
  total: number;
};

// ── Row mapper ───────────────────────────────────────────────────────────────

type RawUtilityBill = {
  id: string;
  property_id: string;
  period_month: string;
  utility_type?: string | null;
  amount?: number | null;
  meter_reading?: number | null;
  status?: string | null;
  recorded_by?: string | null;
  note?: string | null;
};

function toUtilityBill(row: RawUtilityBill): UtilityBillRow {
  return {
    id: row.id,
    propertyId: row.property_id,
    periodMonth: String(row.period_month).slice(0, 10),
    utilityType: (row.utility_type as UtilityType) ?? "other",
    amount: Number(row.amount ?? 0),
    meterReading: row.meter_reading === null || row.meter_reading === undefined
      ? null
      : Number(row.meter_reading),
    status: (row.status as UtilityStatus) ?? "unpaid",
    recordedBy: row.recorded_by ?? null,
    note: row.note ?? null,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Twelve months of bills for one property, grouped by month (newest first) with
 * a per-month total across utilities.
 */
export function usePropertyUtilityBills(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const propertyId = property?.id;

  const query = useQuery({
    queryKey: ["manage", "utilities", "property", propertyId],
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<UtilityBillRow[]> => {
      const { data, error } = await pmsDb
        .from("utility_bills")
        .select("*")
        .eq("property_id", propertyId)
        .gte("period_month", monthKeyOffset(11))
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toUtilityBill);
    },
  });

  useErrorToast(query.error, "Couldn't load utility bills");

  const groups = useMemo(() => groupBillsByMonth(query.data ?? []), [query.data]);

  const total = useMemo(
    () => (query.data ?? []).reduce((sum, bill) => sum + bill.amount, 0),
    [query.data],
  );

  const outstanding = useMemo(
    () =>
      (query.data ?? [])
        .filter((bill) => bill.status !== "paid")
        .reduce((sum, bill) => sum + bill.amount, 0),
    [query.data],
  );

  return { ...query, groups, total, outstanding };
}

/** Newest month first; utilities within a month keep a stable order. */
export function groupBillsByMonth(bills: UtilityBillRow[]): UtilityMonthGroup[] {
  const order: UtilityType[] = ["electricity", "water", "other"];
  const byMonth = new Map<string, UtilityBillRow[]>();

  for (const bill of bills) {
    const existing = byMonth.get(bill.periodMonth);
    if (existing) existing.push(bill);
    else byMonth.set(bill.periodMonth, [bill]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([periodMonth, monthBills]) => ({
      periodMonth,
      bills: [...monthBills].sort(
        (a, b) => order.indexOf(a.utilityType) - order.indexOf(b.utilityType),
      ),
      total: monthBills.reduce((sum, bill) => sum + bill.amount, 0),
    }));
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type RecordUtilityInput = {
  utilityType: UtilityType;
  /** `YYYY-MM-01`. */
  periodMonth: string;
  amount: number;
  meterReading?: number | null;
  status: UtilityStatus;
  note?: string;
};

/**
 * Creates or updates the bill for (property, month, utility).
 *
 * Gate call sites on `usePropertyAccess(property).canRecordUtilities` — agency
 * admins, managers and agents, or the solo owner of the unit. RLS enforces the
 * same rule, and a rejection is reported as a permission problem rather than a
 * silent failure.
 */
export function useRecordUtilityBill(property?: ManagedProperty | null) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordUtilityInput) => {
      if (!property) throw new Error("No property selected.");

      const { error } = await pmsDb.from("utility_bills").upsert(
        {
          property_id: property.id,
          // Null without an active agency — a solo owner's bill is reached via
          // the properties.owner_id fallback in the policy. Never "".
          org_id: orgId ?? null,
          period_month: input.periodMonth,
          utility_type: input.utilityType,
          amount: input.amount,
          meter_reading:
            input.meterReading === null || input.meterReading === undefined
              ? null
              : input.meterReading,
          status: input.status,
          recorded_by: userId,
          note: input.note?.trim() || null,
        },
        { onConflict: "property_id,period_month,utility_type" },
      );

      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      toast.success(`${UTILITY_TYPE_LABELS[input.utilityType]} bill saved`);
      queryClient.invalidateQueries({
        queryKey: ["manage", "utilities", "property", property?.id],
      });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't save the utility bill")),
  });
}

/** `YYYY-MM` for a month input, from a `YYYY-MM-01` period key. */
export function toMonthInputValue(periodMonth: string): string {
  return periodMonth.slice(0, 7);
}

/** `YYYY-MM-01` period key from a `YYYY-MM` month input value. */
export function fromMonthInputValue(value: string): string {
  return value ? `${value}-01` : currentMonthKey();
}
