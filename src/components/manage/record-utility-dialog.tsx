import { useEffect, useMemo, useState } from "react";
import { Receipt } from "lucide-react";

import {
  currentMonthKey,
  formatMonthLabel,
  usePropertyAccess,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  fromMonthInputValue,
  toMonthInputValue,
  useRecordUtilityBill,
  UTILITY_TYPES,
  type UtilityBillRow,
  type UtilityStatus,
  type UtilityType,
} from "@/hooks/use-utilities";

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

type RecordUtilityDialogProps = {
  property: ManagedProperty;
  /** Pass an existing bill to edit it; `null` records a new one. */
  bill: UtilityBillRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Records (or corrects) one utility bill.
 *
 * Saving upserts on (property, month, utility type) — the same key as the table
 * constraint — so re-entering a month replaces it instead of creating a
 * duplicate.
 *
 * Unlike marking rent paid, this is data entry rather than a financial control,
 * so **agents may do it** (plan §5, R-6). It still needs `UTILITIES_RECORD`, or
 * ownership of the unit when no agency is active.
 */
export function RecordUtilityDialog({
  property, bill, open, onOpenChange,
}: RecordUtilityDialogProps) {
  const { canRecordUtilities: canRecord } = usePropertyAccess(property);
  const record = useRecordUtilityBill(property);

  const [utilityType, setUtilityType] = useState<UtilityType>("electricity");
  const [month, setMonth] = useState(toMonthInputValue(currentMonthKey()));
  const [amount, setAmount] = useState("");
  const [meterReading, setMeterReading] = useState("");
  const [status, setStatus] = useState<UtilityStatus>("unpaid");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  // Re-seed whenever the dialog opens, for a new bill or an existing one.
  useEffect(() => {
    if (!open) return;
    setUtilityType(bill?.utilityType ?? "electricity");
    setMonth(toMonthInputValue(bill?.periodMonth ?? currentMonthKey()));
    setAmount(bill ? String(bill.amount) : "");
    setMeterReading(bill?.meterReading != null ? String(bill.meterReading) : "");
    setStatus(bill?.status ?? "unpaid");
    setNote(bill?.note ?? "");
    setTouched(false);
  }, [open, bill]);

  const parsedAmount = Number(amount);
  const amountError = useMemo(() => {
    if (!touched) return null;
    if (!amount.trim()) return "Enter the bill amount.";
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return "Enter a valid amount.";
    }
    return null;
  }, [amount, parsedAmount, touched]);

  if (!canRecord) return null;

  const periodMonth = fromMonthInputValue(month);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount < 0) return;
    if (!month) return;

    const reading = meterReading.trim();

    record.mutate(
      {
        utilityType,
        periodMonth,
        amount: parsedAmount,
        meterReading: reading ? Number(reading) : null,
        status,
        note,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit utility bill" : "Record utility bill"}</DialogTitle>
          <DialogDescription>
            {property.title} — one bill per utility per month.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="utility-type" className="text-xs text-muted-foreground">
                Utility
              </Label>
              <Select
                value={utilityType}
                onValueChange={(v) => setUtilityType(v as UtilityType)}
              >
                <SelectTrigger id="utility-type" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UTILITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="utility-month" className="text-xs text-muted-foreground">
                Month
              </Label>
              <Input
                id="utility-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="utility-amount" className="text-xs text-muted-foreground">
                Amount
              </Label>
              <Input
                id="utility-amount"
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
              {amountError && <p className="text-xs text-destructive">{amountError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="utility-meter" className="text-xs text-muted-foreground">
                Meter reading <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="utility-meter"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={meterReading}
                onChange={(e) => setMeterReading(e.target.value)}
                placeholder="—"
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="utility-status" className="text-xs text-muted-foreground">
              Status
            </Label>
            <Select value={status} onValueChange={(v) => setStatus(v as UtilityStatus)}>
              <SelectTrigger id="utility-status" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="utility-note" className="text-xs text-muted-foreground">
              Note <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="utility-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Meter number, who paid it, anything worth remembering."
              className="rounded-xl min-h-[72px]"
            />
          </div>

          {month && (
            <p className="text-xs text-muted-foreground">
              Saving replaces any existing bill for {formatMonthLabel(periodMonth)}.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={record.isPending || !!amountError || !amount.trim() || !month}
            >
              <Receipt className="w-4 h-4" />
              {record.isPending ? "Saving..." : bill ? "Save changes" : "Record bill"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
