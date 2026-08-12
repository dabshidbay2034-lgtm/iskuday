import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";

import { todayInputValue, type ManagedProperty } from "@/hooks/use-rent";
import {
  useSaveExpense,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseRow,
  type ExpenseStatus,
} from "@/hooks/use-expenses";

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

type ExpenseDialogProps = {
  property: ManagedProperty;
  /** Pass an existing expense to edit it; `null` records a new one. */
  expense: ExpenseRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Records (or corrects) one expense on the register — a tube leak fixed, a
 * repair done, supplies bought. Both staff and managers add these (plan §5).
 */
export function ExpenseDialog({
  property, expense, open, onOpenChange,
}: ExpenseDialogProps) {
  const save = useSaveExpense(property);

  const [category, setCategory] = useState<ExpenseCategory>("maintenance");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayInputValue());
  const [status, setStatus] = useState<ExpenseStatus>("unpaid");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCategory(expense?.category ?? "maintenance");
    setTitle(expense?.title ?? "");
    setDescription(expense?.description ?? "");
    setAmount(expense ? String(expense.amount) : "");
    setExpenseDate(expense?.expenseDate ?? todayInputValue());
    setStatus(expense?.status ?? "unpaid");
    setNote(expense?.note ?? "");
    setTouched(false);
  }, [open, expense]);

  const parsedAmount = Number(amount);
  const amountError = useMemo(() => {
    if (!touched) return null;
    if (!amount.trim()) return "Enter the amount spent.";
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return "Enter a valid amount.";
    }
    return null;
  }, [amount, parsedAmount, touched]);

  const titleError = useMemo(
    () => (touched && title.trim().length < 2 ? "Describe the expense." : null),
    [title, touched],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (title.trim().length < 2) return;
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount < 0) return;

    save.mutate(
      {
        id: expense?.id,
        category,
        title,
        description,
        amount: parsedAmount,
        expenseDate: expenseDate || null,
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
          <DialogTitle>{expense ? "Edit expense" : "Record an expense"}</DialogTitle>
          <DialogDescription>
            {property.title} — money spent keeping this unit running.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expense-title" className="text-xs text-muted-foreground">
              What was it?
            </Label>
            <Input
              id="expense-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Tube leak fixed, plumber call-out…"
              maxLength={160}
              className="h-11 rounded-xl"
              aria-invalid={!!titleError}
              autoFocus
            />
            {titleError && <p className="text-xs text-destructive">{titleError}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="expense-category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as ExpenseCategory)}
              >
                <SelectTrigger id="expense-category" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-date" className="text-xs text-muted-foreground">
                Date
              </Label>
              <Input
                id="expense-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="expense-amount" className="text-xs text-muted-foreground">
                Amount
              </Label>
              <Input
                id="expense-amount"
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
              />
              {amountError && <p className="text-xs text-destructive">{amountError}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-status" className="text-xs text-muted-foreground">
                Status
              </Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as ExpenseStatus)}
              >
                <SelectTrigger id="expense-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-description" className="text-xs text-muted-foreground">
              Details <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="expense-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What leaked, who fixed it, any reference…"
              className="rounded-xl min-h-[64px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-note" className="text-xs text-muted-foreground">
              Note <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Input
              id="expense-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. paid in cash"
              maxLength={200}
              className="h-11 rounded-xl"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={save.isPending || !!amountError || !!titleError}
            >
              <Wallet className="w-4 h-4" />
              {save.isPending ? "Saving..." : expense ? "Save changes" : "Record expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}