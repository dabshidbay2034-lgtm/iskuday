import { Fragment, useState } from "react";
import { Droplets, Lock, Pencil, Plus, Receipt, Zap } from "lucide-react";

import {
  formatMoney,
  formatMonthLabel,
  usePropertyAccess,
  useStaffNameLookup,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  usePropertyUtilityBills,
  UTILITY_TYPE_LABELS,
  type UtilityBillRow,
  type UtilityType,
} from "@/hooks/use-utilities";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RecordUtilityDialog } from "@/components/manage/record-utility-dialog";

const UTILITY_ICONS: Record<UtilityType, React.ElementType> = {
  electricity: Zap,
  water: Droplets,
  other: Receipt,
};

function BillsSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <Table>
        <TableBody>
          {[1, 2, 3].map((i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
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

/**
 * Utility bills for one property — grouped by month, newest first, with a
 * cross-utility total on each month header row.
 *
 * `UTILITIES_VIEW` shows the table; `UTILITIES_RECORD` — or being the solo owner
 * of this unit — adds the record/edit controls. Agents hold both: recording a
 * bill is data entry, not a financial control (plan §5, R-6).
 */
export function UtilityBillsTable({ property }: { property: ManagedProperty }) {
  const { canRecordUtilities: canRecord } = usePropertyAccess(property);
  const nameOf = useStaffNameLookup();

  const { groups, isPending, isError, outstanding } = usePropertyUtilityBills(property);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UtilityBillRow | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (bill: UtilityBillRow) => {
    setEditing(bill);
    setDialogOpen(true);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading font-semibold text-foreground">Utility bills</h2>
          <p className="text-xs text-muted-foreground">
            Electricity, water and anything else — last 12 months
            {!isPending && outstanding > 0 && (
              <> · {formatMoney(outstanding)} unpaid</>
            )}
          </p>
        </div>
        {canRecord && (
          <Button variant="outline" size="sm" onClick={openNew} className="shrink-0">
            <Plus className="w-4 h-4" /> Record bill
          </Button>
        )}
      </div>

      {isPending ? (
        <BillsSkeleton />
      ) : isError ? (
        <div className="text-center py-10 bg-card rounded-xl border border-border">
          <p className="text-sm text-muted-foreground">
            Utility bills couldn't be loaded. Refresh to try again.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No utility bills recorded for this unit yet.
          </p>
          {canRecord && (
            <Button variant="hero" size="sm" onClick={openNew}>
              <Plus className="w-4 h-4" /> Record the first bill
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[130px]">Utility</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Meter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Recorded by</TableHead>
                {canRecord && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.periodMonth}>
                  {/* Month header doubles as the cross-utility subtotal. */}
                  <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                    <TableCell
                      colSpan={2}
                      className="font-heading font-semibold text-sm text-foreground whitespace-nowrap"
                    >
                      {formatMonthLabel(group.periodMonth)}
                    </TableCell>
                    <TableCell
                      colSpan={canRecord ? 4 : 3}
                      className="text-right text-xs text-muted-foreground whitespace-nowrap"
                    >
                      Month total{" "}
                      <span className="font-heading font-bold text-foreground">
                        {formatMoney(group.total)}
                      </span>
                    </TableCell>
                  </TableRow>

                  {group.bills.map((bill) => {
                    const Icon = UTILITY_ICONS[bill.utilityType] ?? Receipt;
                    return (
                      <TableRow key={bill.id}>
                        <TableCell className="text-sm text-foreground">
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                            {UTILITY_TYPE_LABELS[bill.utilityType]}
                          </span>
                          {bill.note && (
                            <span className="block text-[11px] text-muted-foreground truncate max-w-[220px]">
                              {bill.note}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm text-foreground whitespace-nowrap">
                          {formatMoney(bill.amount)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-right text-sm text-muted-foreground">
                          {bill.meterReading ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              bill.status === "paid"
                                ? "bg-success/10 text-success border-success/20 text-[10px] rounded-full"
                                : "bg-muted text-muted-foreground border-border text-[10px] rounded-full"
                            }
                          >
                            {bill.status === "paid" ? "Paid" : "Unpaid"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {bill.recordedBy ? nameOf(bill.recordedBy) : "—"}
                        </TableCell>
                        {canRecord && (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(bill)}
                              aria-label={`Edit ${UTILITY_TYPE_LABELS[bill.utilityType]} bill for ${formatMonthLabel(bill.periodMonth)}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!canRecord && !isPending && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          You can view bills but not record them — ask an admin, manager or agent.
        </p>
      )}

      {canRecord && (
        <RecordUtilityDialog
          property={property}
          bill={editing}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(null);
          }}
        />
      )}
    </section>
  );
}
