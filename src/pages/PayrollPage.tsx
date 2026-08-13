import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Banknote, CircleCheck, Loader2, Pencil, Plus, Sparkles, Trash2,
  TriangleAlert, Wallet,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatDay, formatMoney } from "@/hooks/use-rent";
import {
  HOTEL_STAFF_ROLES, PAY_TYPES, currentMonthInput, monthBounds, roundCents,
  useHotelStaffList, useHotelPayroll, useGenerateMonthlyPayroll,
  useCreatePayrollItem, useUpdatePayrollItem, useDeletePayrollItem,
  type HotelStaff, type PayType, type PayrollItem, type PayrollStatus,
} from "@/hooks/use-hotel-staff";

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  HOTEL_STAFF_ROLES.map((r) => [r.value, r.label]),
);
// Built with a typed reduce rather than Object.fromEntries: fromEntries erases
// the key union down to `string`, so the result no longer satisfies
// Record<PayType, string> and every lookup below loses its check.
const TYPE_LABEL = PAY_TYPES.reduce(
  (acc, t) => {
    acc[t.value] = t.label;
    return acc;
  },
  {} as Record<PayType, string>,
);

type PaymentDialogState =
  | { mode: "create"; staffId?: string }
  | { mode: "edit"; payment: PayrollItem }
  | null;

/**
 * /manage/payroll — the monthly pay run (migration 20260810000001).
 *
 * Pick a month to see every salary/advance/bonus/penalty row in it, "Generate
 * month" to pre-fill one salary row per ACTIVE monthly-rate member, mark rows
 * paid as they're settled, and add extras (advance, bonus, penalty) for anyone —
 * the daily-wage members who don't get a generated row land in "No payment yet".
 */
const PayrollPage = () => {
  const [month, setMonth] = useState<string>(currentMonthInput());
  const { start, end } = useMemo(() => monthBounds(month), [month]);

  const { data: items, isPending, isError, refetch } = useHotelPayroll(start);
  const { data: staff } = useHotelStaffList();
  const generate = useGenerateMonthlyPayroll();
  const updatePayment = useUpdatePayrollItem();
  const deletePayment = useDeletePayrollItem();

  const [paymentDialog, setPaymentDialog] = useState<PaymentDialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollItem | null>(null);

  const rows = useMemo(() => (items ?? []), [items]);

  /**
   * `staff_payroll.amount` is CHECK (amount >= 0), so a row's SIGN lives
   * entirely in `pay_type`. Summing `amount` blind — which this did — made a
   * penalty (a deduction) and an advance (cash already fronted against the
   * salary) both INCREASE the wage bill: salary 400 + advance 100 + penalty 20
   * reported $520 when the month actually costs $380 and $280 is still owed.
   *
   *   salary, bonus → what you owe, positive
   *   penalty       → a deduction, negative
   *   advance       → NOT a cost. It's a pre-payment of the salary already
   *                   counted above, so adding it double-counts. It's tracked
   *                   on its own tile and taken off what's still owed.
   *
   * Cancelled rows are voided and must not move any number — they used to land
   * in `total` while being excluded from both paid and pending, so the three
   * tiles silently stopped adding up.
   */
  const summary = useMemo(() => {
    let total = 0, paid = 0, pending = 0, advanced = 0;
    let paidCount = 0, pendingCount = 0, advanceCount = 0;

    for (const row of rows) {
      if (row.status === "cancelled") continue;

      if (row.payType === "advance") {
        // Counted whatever the status: operators record an advance when the
        // cash leaves the till, and the row's status defaults to "pending" and
        // usually stays there.
        advanced += row.amount;
        advanceCount += 1;
        continue;
      }

      const signed = row.payType === "penalty" ? -row.amount : row.amount;
      total += signed;
      if (row.status === "paid") { paid += signed; paidCount += 1; }
      else { pending += signed; pendingCount += 1; }
    }

    return {
      total: roundCents(total),
      paid: roundCents(paid),
      pending: roundCents(pending),
      advanced: roundCents(advanced),
      // What's genuinely left to hand over: the unsettled wage bill less what
      // has already gone out as an advance.
      stillOwed: roundCents(pending - advanced),
      paidCount, pendingCount, advanceCount,
    };
  }, [rows]);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const byStatus = Number(a.status === "paid") - Number(b.status === "paid");
        if (byStatus !== 0) return byStatus;
        return (a.staff?.name ?? "").localeCompare(b.staff?.name ?? "");
      }),
    [rows],
  );

  const staffWithPayment = useMemo(
    () => new Set(rows.map((r) => r.staffId)),
    [rows],
  );
  const withoutPayment = useMemo(
    () => (staff ?? []).filter((s) => !staffWithPayment.has(s.id)),
    [staff, staffWithPayment],
  );

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [month]);

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-4xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link
              to="/manage/staff"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Staff
            </Link>
            <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" /> Payroll
            </h1>
            <p className="text-sm text-muted-foreground">
              Payments for <span className="font-medium text-foreground">{monthLabel}</span>.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              aria-label="Payroll month"
            />
            <Button variant="hero" size="sm" onClick={() => setPaymentDialog({ mode: "create" })}>
              <Plus className="w-4 h-4" /> Add payment
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryTile
            label="Payroll total"
            value={formatMoney(summary.total)}
            hint={`${formatMoney(summary.stillOwed)} still owed`}
            accent
          />
          <SummaryTile
            label={`Already advanced · ${summary.advanceCount}`}
            value={formatMoney(summary.advanced)}
            hint="paid out against salary"
          />
          <SummaryTile
            label={`Pending · ${summary.pendingCount}`}
            value={formatMoney(summary.pending)}
          />
          <SummaryTile
            label={`Paid · ${summary.paidCount}`}
            value={formatMoney(summary.paid)}
            green
          />
        </div>

        {/* Generate month */}
        <div className="rounded-2xl border border-border bg-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-primary" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Generate {monthLabel} salaries</p>
              <p className="text-xs text-muted-foreground">
                Adds one "salary" row for every active monthly-rate member who doesn't have one
                yet. Daily-wage members are skipped — add theirs by hand.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={generate.isPending}
            onClick={() => generate.mutate(month)}
          >
            {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
            Generate month
          </Button>
        </div>

        {/* Team with no payment yet */}
        {/* `rows` is empty when the payroll read FAILED too, which would list the
            whole team here as if nobody had been paid. Only trust it on success. */}
        {!isPending && !isError && withoutPayment.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              No payment yet this month
              <span className="text-xs font-normal text-muted-foreground"> ({withoutPayment.length})</span>
            </h2>
            <div className="rounded-xl border border-dashed border-border p-2 flex flex-wrap gap-2">
              {withoutPayment.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setPaymentDialog({ mode: "create", staffId: member.id })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                    member.active
                      ? "bg-background border-border text-foreground hover:border-primary hover:text-primary"
                      : "bg-muted/40 border-border text-muted-foreground",
                  )}
                >
                  <span className="truncate max-w-[160px]">{member.name}</span>
                  <span className="opacity-60">· {ROLE_LABEL[member.role]}</span>
                  <Plus className="w-3 h-3" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Payments table */}
        {isPending ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : isError ? (
          /* A failed read used to fall through to "Nothing here yet", which is
             how a query pointed at a non-existent table passed for an empty
             month. Broken and empty must never look the same. */
          <div className="text-center py-14 bg-card rounded-2xl border border-destructive/40">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
              <TriangleAlert className="w-7 h-7 text-destructive" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">
              Payroll couldn't be loaded
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              This month's payments didn't come back from the server. Nothing has been lost —
              the figures above are incomplete until it loads.
            </p>
            <Button variant="outline" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="text-center py-14 bg-card rounded-2xl border border-dashed border-border">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Banknote className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">Nothing here yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Generate the month's salaries, or add a payment for someone on the team.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="hero" onClick={() => generate.mutate(month)} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate salaries
              </Button>
              <Button variant="outline" onClick={() => setPaymentDialog({ mode: "create" })}>
                <Plus className="w-4 h-4" /> Add payment
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedRows.map((row) => (
              <PayrollRow
                key={row.id}
                row={row}
                // One shared mutation drives every row, so gate on the row it's
                // actually settling — otherwise "Mark paid" stays live during
                // its own request and a double-tap fires two updates, moving
                // paid_at and toasting twice.
                marking={updatePayment.isPending && updatePayment.variables?.id === row.id}
                onMarkPaid={() => markPaid(row)}
                onEdit={() => setPaymentDialog({ mode: "edit", payment: row })}
                onDelete={() => setDeleteTarget(row)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Add / edit payment */}
      <PaymentDialog
        key={paymentDialog
          ? paymentDialog.mode === "edit"
            ? `edit:${paymentDialog.payment.id}`
            : `create:${paymentDialog.staffId ?? "_"}`
          : "closed"}
        state={paymentDialog}
        onClose={() => setPaymentDialog(null)}
        staff={staff ?? []}
        periodStart={start}
        periodEnd={end}
        monthLabel={monthLabel}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.staff?.name ? `${deleteTarget.staff.name} · ` : ""}
              {TYPE_LABEL[deleteTarget?.payType ?? "salary"]} of{" "}
              <span className="font-medium text-foreground">{formatMoney(deleteTarget?.amount)}</span>
              {" "}will be removed from {monthLabel}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deletePayment.mutate(deleteTarget.id)}
              disabled={deletePayment.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePayment.isPending ? "Removing…" : "Remove payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );

  function markPaid(row: PayrollItem) {
    updatePayment.mutate({ id: row.id, patch: { status: "paid" } });
  }
};

function SummaryTile({
  label, value, hint, accent, green,
}: { label: string; value: string; hint?: string; accent?: boolean; green?: boolean }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold font-mono truncate",
          accent ? "text-foreground" : green ? "text-success" : "text-amber-600",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
    </div>
  );
}

function PayrollRow({
  row, marking, onMarkPaid, onEdit, onDelete,
}: {
  row: PayrollItem;
  marking: boolean;
  onMarkPaid: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const paid = row.status === "paid";
  const cancelled = row.status === "cancelled";

  return (
    <li className="bg-card rounded-2xl border border-border p-3 flex items-center gap-3">
      <span
        className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center text-white font-heading font-bold text-sm shrink-0",
          paid ? "bg-emerald-600/90" : "bg-teal-700",
        )}
      >
        {initials(row.staff?.name ?? "?")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-foreground truncate">
            {row.staff?.name ?? "Removed member"}
          </p>
          <PayTypeBadge type={row.payType} />
          <StatusBadge status={row.status} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {row.staff ? `${ROLE_LABEL[row.staff.role]} · ` : ""}
          {row.note || "—"}
          {row.paidAt && paid ? ` · Paid ${formatDay(row.paidAt)}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className={cn("font-heading font-bold text-sm font-mono", cancelled && "line-through text-muted-foreground")}>
          {formatMoney(row.amount)}
        </p>
        {!cancelled && (
          <div className="mt-1 flex items-center justify-end gap-0.5">
            {!paid && (
              <Button
                variant="ghost" size="sm" className="h-7 px-2 text-xs text-success"
                onClick={onMarkPaid} disabled={marking}
              >
                {marking
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <CircleCheck className="w-3.5 h-3.5" />}
                Mark paid
              </Button>
            )}
            {!paid && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label="Edit payment">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete} aria-label="Delete payment"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function PayTypeBadge({ type }: { type: PayType }) {
  const cls =
    type === "advance" ? "bg-amber-100 text-amber-700"
    : type === "bonus" ? "bg-emerald-100 text-emerald-700"
    : type === "penalty" ? "bg-rose-100 text-rose-700"
    : "bg-teal-100 text-teal-700";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>
      {TYPE_LABEL[type]}
    </span>
  );
}

function StatusBadge({ status }: { status: PayrollStatus }) {
  if (status === "paid")
    return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-600/10 text-success">Paid</span>;
  if (status === "cancelled")
    return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">Cancelled</span>;
  return <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700">Pending</span>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Add / edit payment dialog ────────────────────────────────────────────────

function PaymentDialog({
  state, onClose, staff, periodStart, periodEnd, monthLabel,
}: {
  state: PaymentDialogState;
  onClose: () => void;
  staff: HotelStaff[];
  periodStart: string;
  periodEnd: string;
  monthLabel: string;
}) {
  const create = useCreatePayrollItem();
  const update = useUpdatePayrollItem();
  const saving = create.isPending || update.isPending;

  // The dialog is keyed by its target in the parent, so this component remounts
  // fresh for every open — the initial state below is always correct.
  const [staffId, setStaffId] = useState<string>(() =>
    state?.mode === "edit" || state === null ? "" : state.staffId ?? "",
  );
  const [payType, setPayType] = useState<PayType>(() =>
    state?.mode === "edit" ? state.payment.payType : "advance",
  );
  const [amountRaw, setAmountRaw] = useState<string>(() =>
    state?.mode === "edit" ? String(state.payment.amount) : "",
  );
  const [note, setNote] = useState<string>(() => (state?.mode === "edit" ? state.payment.note ?? "" : ""));
  const [touched, setTouched] = useState(false);

  const open = state !== null;
  const isEdit = state?.mode === "edit" || false;

  // Validity comes from the VALUES; `touched` only decides whether it's shown.
  // Folding `touched` into the predicate made both errors null on the very first
  // submit — the render that flips touched to true still sees false — so the
  // guard below waved an empty form through and inserted a $0 payment. With
  // pay_type "salary" that's worse than noise: it takes the member's slot in the
  // uq_staff_salary_period index, and "Generate month" then skips them forever.
  const amount = roundCents(Number(amountRaw));
  const amountInvalid = amountRaw.trim() === "" || !Number.isFinite(amount) || amount <= 0;
  const staffInvalid = state?.mode !== "edit" && !staffId;

  const amountError = touched && amountInvalid ? "Enter an amount above 0." : null;
  const staffError = touched && staffInvalid ? "Pick who this is for." : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (amountInvalid || staffInvalid || !state) return;

    if (state.mode === "edit") {
      update.mutate({ id: state.payment.id, patch: { amount, note: note.trim() || null } }, { onSuccess: onClose });
    } else {
      if (!staffId) return;
      create.mutate(
        {
          staffId,
          periodStart,
          periodEnd,
          payType,
          amount,
          note: note.trim() || undefined,
        },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit payment" : `Add payment · ${monthLabel}`}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Adjust a payment that hasn't been settled yet."
              : `A salary, advance, bonus or penalty within ${monthLabel}.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">For *</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue placeholder="Choose a staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} — {ROLE_LABEL[member.role]}
                      {!member.active ? " (inactive)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {staffError && <p className="text-xs text-destructive">{staffError}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select
                value={payType}
                onValueChange={(v) => setPayType(v as PayType)}
                disabled={isEdit}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} disabled={isEdit}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-amount" className="text-xs text-muted-foreground">Amount *</Label>
              <Input
                id="pay-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl font-mono"
              />
              {amountError && <p className="text-xs text-destructive">{amountError}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pay-note" className="text-xs text-muted-foreground">Note</Label>
            <Input
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isEdit ? "Reason for the adjustment…" : "e.g. August salary balance, weekly pay, bonus"}
              className="h-11 rounded-xl"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="hero" disabled={saving || !!amountError || !!staffError}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default PayrollPage;