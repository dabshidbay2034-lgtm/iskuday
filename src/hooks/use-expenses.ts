import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import {
  describeWriteError,
  formatMoney,
  pmsDb,
  useErrorToast,
  useManageScope,
  type ManagedProperty,
} from "@/hooks/use-rent";

/**
 * Expense register for a property (20260806000001).
 *
 * The scratchpad for money spent keeping a unit running — "a tube leaked, the
 * plumber fixed it, $30 was paid". Whoever is managing the unit (org staff or
 * the assigned caretaker) can add an expense, and everyone who can see the unit
 * sees the register. Recording a cost is data entry, not a financial control —
 * the same trust level as utility bills (plan §5, R-6).
 *
 * Shared primitives (money formatting, month helpers, the RLS-aware error
 * describer, the Supabase access shim) come from `use-rent.ts`, matching
 * `use-utilities.ts`.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `property_expenses` isn't in the generated types until `supabase gen types`
// runs against a database that has the 20260806000001 migration applied, so this
// module reads/writes it through a loose accessor and narrows rows with its own
// mapper. The rest of the manage surface lives on the typed client.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (pmsDb as unknown as LooseClient).from(table);

// ── Domain types ─────────────────────────────────────────────────────────────

export type ExpenseCategory = "maintenance" | "repair" | "supplies" | "utility" | "other";
export type ExpenseStatus = "unpaid" | "paid";

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "maintenance", label: "Maintenance" },
  { value: "repair", label: "Repair" },
  { value: "supplies", label: "Supplies" },
  { value: "utility", label: "Utility" },
  { value: "other", label: "Other" },
];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  maintenance: "Maintenance",
  repair: "Repair",
  supplies: "Supplies",
  utility: "Utility",
  other: "Other",
};

export type ExpenseRow = {
  id: string;
  propertyId: string;
  category: ExpenseCategory;
  title: string;
  description: string | null;
  amount: number;
  expenseDate: string | null;
  status: ExpenseStatus;
  recordedBy: string | null;
  note: string | null;
  createdAt: string;
};

// ── Row mapper ───────────────────────────────────────────────────────────────

type RawExpense = {
  id: string;
  property_id: string;
  category?: string | null;
  title?: string | null;
  description?: string | null;
  amount?: number | null;
  expense_date?: string | null;
  status?: string | null;
  recorded_by?: string | null;
  note?: string | null;
  created_at?: string | null;
};

function toExpense(row: RawExpense): ExpenseRow {
  return {
    id: row.id,
    propertyId: row.property_id,
    category: (row.category as ExpenseCategory) ?? "other",
    title: row.title ?? "Expense",
    description: row.description ?? null,
    amount: Number(row.amount ?? 0),
    expenseDate: row.expense_date ? String(row.expense_date).slice(0, 10) : null,
    status: (row.status as ExpenseStatus) ?? "unpaid",
    recordedBy: row.recorded_by ?? null,
    note: row.note ?? null,
    createdAt: row.created_at ?? "",
  };
}

// ── Query ────────────────────────────────────────────────────────────────────

export const expensesKey = (propertyId?: string) =>
  ["manage", "expenses", "property", propertyId] as const;

/** All expenses for one property, newest first. */
export function usePropertyExpenses(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const propertyId = property?.id;

  const query = useQuery({
    queryKey: expensesKey(propertyId),
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await looseFrom("property_expenses")
                .select("*")
                .eq("property_id", propertyId)
        .order("expense_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toExpense);
    },
  });

  useErrorToast(query.error, "Couldn't load expenses");

  const total = useMemo(
    () => (query.data ?? []).reduce((sum, e) => sum + e.amount, 0),
    [query.data],
  );
  const outstanding = useMemo(
    () =>
      (query.data ?? [])
        .filter((e) => e.status !== "paid")
        .reduce((sum, e) => sum + e.amount, 0),
    [query.data],
  );

  return { ...query, total, outstanding };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type SaveExpenseInput = {
  id?: string;
  category: ExpenseCategory;
  title: string;
  description?: string;
  amount: number;
  expenseDate: string | null;
  status: ExpenseStatus;
  note?: string;
};

/** Create or update an expense on a property. */
export function useSaveExpense(property?: ManagedProperty | null) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveExpenseInput) => {
      if (!property) throw new Error("No property selected.");

      const payload = {
        property_id: property.id,
        org_id: orgId ?? null, // nullable — owner/staff branch resolves the row
        category: input.category,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        amount: input.amount,
        expense_date: input.expenseDate || null,
        status: input.status,
        recorded_by: userId,
        note: input.note?.trim() || null,
      };

      const { error } = input.id
        ? await looseFrom("property_expenses").update(payload).eq("id", input.id)
        : await looseFrom("property_expenses").insert(payload);

      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      toast.success(input.id ? "Expense updated" : "Expense recorded");
      queryClient.invalidateQueries({ queryKey: expensesKey(property?.id) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't save the expense")),
  });
}

/** Delete an expense. Gated on org admin/manager or the unit owner in RLS. */
export function useDeleteExpense(property?: ManagedProperty | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await looseFrom("property_expenses").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      toast.success("Expense removed");
      queryClient.invalidateQueries({ queryKey: expensesKey(property?.id) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't delete the expense")),
  });
}

/** Re-export money formatter so the expenses UI stays consistent with the rest. */
export { formatMoney };