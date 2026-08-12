import { useState } from "react";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";

import {
  formatMoney,
  formatDay,
  usePropertyAccess,
  useStaffNameLookup,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  usePropertyMaintenance,
  useDeleteMaintenance,
  type MaintenanceRow,
  type MaintenanceStatus,
} from "@/hooks/use-maintenance";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MaintenanceDialog } from "./maintenance-dialog";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<MaintenanceStatus, string> = {
  open: "bg-warning/10 text-warning border-warning/20",
  in_progress: "bg-info/10 text-info border-info/20",
  resolved: "bg-success/10 text-success border-success/20",
  cancelled: "bg-secondary text-muted-foreground border-border",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export function MaintenanceCard({ property }: { property: ManagedProperty }) {
  const { canManageMaintenance: canManage, canViewMaintenance } = usePropertyAccess(property);
  const nameOf = useStaffNameLookup();

  const { data, isPending, isError, openCount } = usePropertyMaintenance(property);
  const deleteJob = useDeleteMaintenance(property);

  const jobs = data ?? [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaintenanceRow | null>(null);

  if (!canViewMaintenance) return null;

  const openJobs = jobs.filter((j) => j.status === "open" || j.status === "in_progress");

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Wrench className="w-4 h-4 text-muted-foreground shrink-0" />
              Maintenance
            </CardTitle>
            <CardDescription className="text-xs">
              Work orders for this unit
              {!isPending && openJobs.length > 0 && (
                <>
                  {" "}· <span className="text-warning">{openJobs.length} open</span>
                </>
              )}
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="shrink-0"
            >
              <Plus className="w-4 h-4" /> Log job
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">
            Maintenance jobs couldn't be loaded. Refresh to try again.
          </p>
        ) : jobs.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <Wrench className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No maintenance jobs</p>
            <p className="text-xs text-muted-foreground mb-3">
              {canManage
                ? "Log the first one when something needs fixing."
                : "Only the unit's staff can log a job."}
            </p>
            {canManage && (
              <Button
                variant="hero"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4" /> Log a job
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => {
              const needsAttention =
                job.priority === "urgent" &&
                (job.status === "open" || job.status === "in_progress");
              return (
                <li
                  key={job.id}
                  className={cn(
                    "rounded-xl border p-3 space-y-2",
                    needsAttention
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {job.title}
                      </p>
                      {job.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                          {job.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditing(job);
                              setDialogOpen(true);
                            }}
                            aria-label={`Edit ${job.title}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteTarget(job)}
                            aria-label={`Delete ${job.title}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px] font-normal", STATUS_STYLES[job.status])}
                    >
                      {job.status.replace("_", " ")}
                    </Badge>
                    <span className={cn("text-[11px] capitalize", PRIORITY_STYLES[job.priority])}>
                      {job.priority} priority
                    </span>
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {job.category}
                    </span>
                    {job.assignedTo && (
                      <span className="text-[11px] text-muted-foreground">
                        → {job.assignedTo}
                      </span>
                    )}
                    {job.actualCost != null && (
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        Cost {formatMoney(job.actualCost)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span>
                      {job.reportedBy ? nameOf(job.reportedBy) : "—"} · reported{" "}
                      {formatDay(job.createdAt)}
                    </span>
                    {job.resolvedAt && <span>resolved {formatDay(job.resolvedAt)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {canManage && (
        <MaintenanceDialog
          property={property}
          job={editing}
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
            <AlertDialogTitle>Delete this maintenance job?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span> will be
              removed from this unit's maintenance log. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteJob.mutate(deleteTarget.id)}
              disabled={deleteJob.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteJob.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}