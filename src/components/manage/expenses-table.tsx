import { useState } from "react";
import { Pencil, Plus, Trash2, Wallet } from "lucide-react";

import {
  formatMoney,
  formatDay,
  usePropertyAccess,
  useStaffNameLookup,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  usePropertyExpenses,
  useDeleteExpense,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseRow,
} from "@/hooks/use-expenses";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ExpenseDialog } from "./expense-dialog";

/**
 * The expense register for one unit — money spent keeping it running. Both the
 * unit's staff and managers add to it, and everyone who can see the unit sees
 * it (the request's rule).
 */
export function ExpensesTable({ property }: { property: ManagedProperty }) {
  const { canRecordExpenses: canRecord, canViewExpenses } = usePropertyAccess(property);
  const nameOf = useStaffNameLookup();

  const { data, isPending, isError, total, outstanding } = usePropertyExpenses(property);
  const deleteExpense = useDeleteExpense(property);

  const rows = data ?? [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (expense: ExpenseRow) => {
    setEditing(expense);
    setDialogOpen(true);
  };

  if (!canViewExpenses) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading font-semibold text-foreground">Expenses</h2>
          <p className="text-xs text-muted-foreground">
            Maintenance, repairs and supplies
            {!isPending && total > 0 && (
              <>
                {" "}· <span className="font-medium text-foreground">{formatMoney(total)}</span> total
                {outstanding > 0 && ` · ${formatMoney(outstanding)} outstanding`}
              </>
            )}
          </p>
        </div>
        {canRecord && (
          <Button variant="outline" size="sm" onClick={openNew} className="shrink-0">
            <Plus className="w-4 h-4" /> Add expense
          </Button>
        )}
      </div>

      {isPending ? (
        <ExpensesSkeleton />
      ) : isError ? (
        <div className="text-center py-10 bg-card rounded-xl border border-border">
          <p className="text-sm text-muted-foreground">
            Expenses couldn't be loaded. Refresh to try again.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <Wallet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No expenses recorded for this unit yet.
          </p>
          {canRecord && (
            <Button variant="hero" size="sm" onClick={openNew}>
              <Plus className="w-4 h-4" /> Record the first expense
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Expense</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Recorded by</TableHead>
                {canRecord && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="text-sm text-foreground">
                    {expense.title}
                    {(expense.description || expense.note) && (
                      <span className="block text-[11px] text-muted-foreground truncate max-w-[220px]">
                        {expense.description ?? expense.note}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {EXPENSE_CATEGORY_LABELS[expense.category]}
                  </TableCell>
                  <TableCell className="text-right text-sm text-foreground whitespace-nowrap">
                    {formatMoney(expense.amount)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {formatDay(expense.expenseDate)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        expense.status === "paid"
                          ? "bg-success/10 text-success border-success/20 text-[10px] rounded-full"
                          : "bg-muted text-muted-foreground border-border text-[10px] rounded-full"
                      }
                    >
                      {expense.status === "paid" ? "Paid" : "Unpaid"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {expense.recordedBy ? nameOf(expense.recordedBy) : "—"}
                  </TableCell>
                  {canRecord && (
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(expense)}
                          aria-label={`Edit ${expense.title}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(expense)}
                          aria-label={`Delete ${expense.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canRecord && (
        <ExpenseDialog
          property={property}
          expense={editing}
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) setEditing(null);
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span> for{" "}
              {deleteTarget ? formatMoney(deleteTarget.amount) : ""} will be removed from the
              register. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteExpense.mutate(deleteTarget.id)}
              disabled={deleteExpense.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteExpense.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ExpensesSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableBody>
          {[1, 2, 3].map((i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-3.5 w-40" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
