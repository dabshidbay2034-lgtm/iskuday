import { useState } from "react";
import { Banknote, Lock } from "lucide-react";

import {
  formatDay,
  formatMoney,
  formatMonthLabel,
  outstandingOf,
  usePropertyAccess,
  usePropertyRentLedger,
  useStaffNameLookup,
  PAYMENT_METHODS,
  type ManagedProperty,
  type RentLedgerRow,
  type RentStatus,
} from "@/hooks/use-rent";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MarkPaidDialog } from "@/components/manage/mark-paid-dialog";

const STATUS_STYLES: Record<RentStatus, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-success/10 text-success border-success/20" },
  partial: { label: "Partial", className: "bg-warning/10 text-warning border-warning/20" },
  unpaid: { label: "Unpaid", className: "bg-muted text-muted-foreground border-border" },
};

/** Rent status pill — shared with the portfolio table on /manage. */
export function RentStatusBadge({ status }: { status: RentStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unpaid;
  return (
    <Badge variant="outline" className={`${style.className} text-[10px] rounded-full`}>
      {style.label}
    </Badge>
  );
}

function methodLabel(method?: string | null): string {
  if (!method) return "";
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

function LedgerSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableBody>
          {[1, 2, 3, 4].map((i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-3.5 w-28" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
              <TableCell className="text-right"><Skeleton className="h-8 w-24 rounded-md ml-auto" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The rent ledger for one property — twelve months, newest first, with the
 * current month always shown even before its row exists in the database.
 *
 * Permissions (plan §5, R-6): `RENT_VIEW` gets you the table — viewers and
 * agents included. Only `RENT_MARK_PAID` — or being the solo owner of this very
 * unit — gets you the "Mark paid" control, and it is *absent*, not merely greyed
 * out, for everyone else. RLS enforces the same boundary server-side, so a
 * forced request still fails and surfaces as a permission toast rather than a
 * silent no-op.
 */
export function RentLedgerTable({ property }: { property: ManagedProperty }) {
  const { canMarkRentPaid: canMarkPaid } = usePropertyAccess(property);
  const nameOf = useStaffNameLookup();

  const { rows, isPending, isError } = usePropertyRentLedger(property);
  const [target, setTarget] = useState<RentLedgerRow | null>(null);

  const totalOutstanding = rows.reduce((sum, row) => sum + outstandingOf(row), 0);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading font-semibold text-foreground">Rent ledger</h2>
          <p className="text-xs text-muted-foreground">
            Last 12 months · {formatMoney(property.monthlyRent)} per month
          </p>
        </div>
        {!isPending && totalOutstanding > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
              Outstanding
            </p>
            <p className="font-heading font-bold text-foreground">
              {formatMoney(totalOutstanding)}
            </p>
          </div>
        )}
      </div>

      {isPending ? (
        <LedgerSkeleton />
      ) : isError ? (
        <div className="text-center py-10 bg-card rounded-xl border border-border">
          <p className="text-sm text-muted-foreground">
            The rent ledger couldn't be loaded. Refresh to try again.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[130px]">Month</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Paid on</TableHead>
                <TableHead className="hidden lg:table-cell">Marked by</TableHead>
                {canMarkPaid && <TableHead className="text-right w-[120px]">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.periodMonth}>
                  <TableCell className="font-medium text-sm text-foreground whitespace-nowrap">
                    {formatMonthLabel(row.periodMonth)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-foreground whitespace-nowrap">
                    {formatMoney(row.amountDue)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-foreground whitespace-nowrap">
                    {formatMoney(row.amountPaid)}
                    {row.method && (
                      <span className="block text-[10px] text-muted-foreground">
                        {methodLabel(row.method)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <RentStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                    {formatDay(row.paidAt)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {row.markedBy ? nameOf(row.markedBy) : "—"}
                  </TableCell>

                  {/* Financial control — rendered only for RENT_MARK_PAID. */}
                  {canMarkPaid && (
                    <TableCell className="text-right">
                      <Button
                        variant={row.status === "paid" ? "ghost" : "outline"}
                        size="sm"
                        className="whitespace-nowrap"
                        // Hidden by the guard above and disabled here: neither
                        // alone should be the only thing standing between an
                        // agent and the money column.
                        disabled={!canMarkPaid}
                        onClick={() => canMarkPaid && setTarget(row)}
                      >
                        <Banknote className="w-4 h-4" />
                        {row.status === "paid" ? "Adjust" : "Mark paid"}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!canMarkPaid && !isPending && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Recording rent as received is limited to agency admins and managers.
        </p>
      )}

      {/* Mounted only when the viewer may record money — the dialog re-checks too. */}
      {canMarkPaid && (
        <MarkPaidDialog
          property={property}
          row={target}
          open={!!target}
          onOpenChange={(open) => !open && setTarget(null)}
        />
      )}
    </section>
  );
}
