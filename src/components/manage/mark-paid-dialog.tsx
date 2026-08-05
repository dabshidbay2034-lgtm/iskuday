import { useEffect, useMemo, useState } from "react";
import { Banknote } from "lucide-react";

import {
  formatMoney,
  formatMonthLabel,
  outstandingOf,
  rentStatusFor,
  todayInputValue,
  useMarkRentPaid,
  usePropertyAccess,
  PAYMENT_METHODS,
  type ManagedProperty,
  type PaymentMethod,
  type RentLedgerRow,
} from "@/hooks/use-rent";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type MarkPaidDialogProps = {
  property: ManagedProperty;
  /** The ledger month being settled; `null` closes the dialog. */
  row: RentLedgerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Records a rent payment against one month.
 *
 * The amount entered is the payment being received *now* — it is added to
 * whatever the ledger already holds, so a month can be settled in instalments.
 * Status follows from the arithmetic: `partial` while the total is short of the
 * amount due, `paid` once it covers it.
 *
 * Only agency admins/managers — or the solo owner of this unit — reach this
 * dialog. The trigger is hidden for everyone else, and this component refuses to
 * render without that permission as a second line of defence; the database is
 * the third.
 */
export function MarkPaidDialog({ property, row, open, onOpenChange }: MarkPaidDialogProps) {
  const { canMarkRentPaid: canMarkPaid } = usePropertyAccess(property);
  const markPaid = useMarkRentPaid(property);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidDate, setPaidDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  const outstanding = row ? outstandingOf(row) : 0;

  // Re-seed the form each time a different month is opened.
  useEffect(() => {
    if (!open || !row) return;
    setAmount(outstanding > 0 ? String(outstanding) : "");
    setMethod(row.method ?? "cash");
    setPaidDate(todayInputValue());
    setNote(row.note ?? "");
    setTouched(false);
    // `outstanding` is derived from `row`; keying on the row identity is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.periodMonth, row?.amountPaid]);

  const parsedAmount = Number(amount);
  const amountError = useMemo(() => {
    if (!touched) return null;
    if (!amount.trim()) return "Enter the amount received.";
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return "Enter an amount greater than zero.";
    }
    return null;
  }, [amount, parsedAmount, touched]);

  if (!canMarkPaid || !row) return null;

  const nextPaid = row.amountPaid + (Number.isFinite(parsedAmount) ? parsedAmount : 0);
  const nextStatus = rentStatusFor(row.amountDue, nextPaid);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!canMarkPaid) return;
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;

    markPaid.mutate(
      {
        periodMonth: row.periodMonth,
        amountDue: row.amountDue,
        previousPaid: row.amountPaid,
        amount: parsedAmount,
        method,
        paidDate,
        note,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record rent payment</DialogTitle>
          <DialogDescription>
            {formatMonthLabel(row.periodMonth)} — {property.title}
          </DialogDescription>
        </DialogHeader>

        {/* Where the month stands before this payment. */}
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-secondary/40 border border-border p-3">
          {[
            { label: "Due", value: formatMoney(row.amountDue) },
            { label: "Paid", value: formatMoney(row.amountPaid) },
            { label: "Outstanding", value: formatMoney(outstanding) },
          ].map((cell) => (
            <div key={cell.label}>
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                {cell.label}
              </p>
              <p className="text-sm font-heading font-bold text-foreground">{cell.value}</p>
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rent-amount" className="text-xs text-muted-foreground">
              Amount received
            </Label>
            <Input
              id="rent-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="0"
              className="h-11 rounded-xl"
              aria-invalid={!!amountError}
              autoFocus
            />
            {amountError ? (
              <p className="text-xs text-destructive">{amountError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Part payments are fine — this is added to what's already recorded.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="rent-method" className="text-xs text-muted-foreground">
                Method
              </Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="rent-method" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rent-date" className="text-xs text-muted-foreground">
                Date received
              </Label>
              <Input
                id="rent-date"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rent-note" className="text-xs text-muted-foreground">
              Note <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="rent-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Receipt number, who handed it over, anything worth remembering."
              className="rounded-xl min-h-[72px]"
            />
          </div>

          {/* Live outcome so nobody has to guess what "partial" will mean. */}
          {parsedAmount > 0 && (
            <div className="rounded-xl bg-secondary/40 border border-border p-3 text-xs text-muted-foreground">
              After saving, {formatMonthLabel(row.periodMonth)} will show{" "}
              <span className="font-semibold text-foreground">{formatMoney(nextPaid)}</span> of{" "}
              <span className="font-semibold text-foreground">{formatMoney(row.amountDue)}</span>{" "}
              paid —{" "}
              <span
                className={
                  nextStatus === "paid"
                    ? "font-semibold text-success"
                    : "font-semibold text-foreground"
                }
              >
                {nextStatus}
              </span>
              .
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={!canMarkPaid || markPaid.isPending || !!amountError || !amount.trim()}
            >
              <Banknote className="w-4 h-4" />
              {markPaid.isPending ? "Saving..." : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
