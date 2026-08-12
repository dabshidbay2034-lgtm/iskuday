import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";

import { usePropertyAccess, type ManagedProperty } from "@/hooks/use-rent";
import {
  useHousekeeping,
  useSaveHousekeepingTask,
  useSetHousekeepingStatus,
  useDeleteHousekeepingTask,
  TASK_STATUS_META,
  TASK_TYPE_LABEL,
  type HousekeepingTask,
  type HousekeepingTaskType,
  type HousekeepingTaskStatus,
} from "@/hooks/use-housekeeping";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<HousekeepingTaskStatus, string> = {
  pending: "bg-secondary text-muted-foreground border-border",
  in_progress: "bg-info/10 text-info border-info/20",
  done: "bg-success/10 text-success border-success/20",
  skipped: "bg-warning/10 text-warning border-warning/20",
};

/**
 * Housekeeping turnaround tasks for one room (hotel management). Between
 * guests the desk logs a clean / deep-clean / inspection / maintenance task and
 * works through it. Written by anyone with booking-manage rights.
 */
export function HousekeepingCard({ property }: { property: ManagedProperty }) {
  const { canViewBookings: canView, canManageBookings: canManage } = usePropertyAccess(property);
  const roomIds = property.id ? [property.id] : [];
  const { data, isPending, isError } = useHousekeeping(roomIds);
  const saveTask = useSaveHousekeepingTask(roomIds);
  const setStatus = useSetHousekeepingStatus(roomIds);
  const deleteTask = useDeleteHousekeepingTask(roomIds);

  const [taskType, setTaskType] = useState<HousekeepingTaskType>("clean");
  const [adding, setAdding] = useState(false);

  if (!canView || property.type !== "hotel") return null;

  const tasks = data ?? [];
  const open = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
              Housekeeping
            </CardTitle>
            <CardDescription className="text-xs">
              Turnaround between guests
              {!isPending && open.length > 0 && (
                <> · <span className="text-warning">{open.length} open</span></>
              )}
            </CardDescription>
          </div>
          {canManage && !adding && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setAdding(true)}
            >
              <Plus className="w-4 h-4" /> Add task
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {adding && canManage && (
          <form
            className="rounded-xl border border-border p-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveTask.mutate(
                { roomId: property.id, taskType },
                {
                  onSuccess: () => {
                    setAdding(false);
                    setTaskType("clean");
                  },
                },
              );
            }}
          >
            <div className="flex items-center gap-2">
              <Select value={taskType} onValueChange={(v) => setTaskType(v as HousekeepingTaskType)}>
                <SelectTrigger className="h-9 rounded-full flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_TYPE_LABEL) as HousekeepingTaskType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TASK_TYPE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                variant="hero"
                disabled={saveTask.isPending}
              >
                {saveTask.isPending ? "Adding..." : "Add"}
              </Button>
            </div>
          </form>
        )}

        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">Tasks couldn't be loaded.</p>
        ) : tasks.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No tasks</p>
            <p className="text-xs text-muted-foreground">
              {canManage
                ? "Add a turnaround task when the room needs cleaning or inspection."
                : "Only desk staff can add tasks."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task: HousekeepingTask) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground capitalize">
                    {TASK_TYPE_LABEL[task.taskType]}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {task.notes || `Logged by ${task.createdBy ? "staff" : "system"}`}
                    {task.scheduledAt ? ` · for ${task.scheduledAt}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {canManage ? (
                    <>
                      <Badge
                        variant="outline"
                        className={cn("rounded-full text-[10px] font-normal", STATUS_STYLES[task.status])}
                      >
                        {TASK_STATUS_META[task.status].label}
                      </Badge>
                      <Select
                        value={task.status}
                        onValueChange={(v) =>
                          setStatus.mutate({ id: task.id, status: v as HousekeepingTaskStatus })
                        }
                      >
                        <SelectTrigger className="h-8 w-[104px] rounded-full text-xs" aria-label="Change status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(TASK_STATUS_META) as HousekeepingTaskStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>
                              {TASK_STATUS_META[s].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        className="text-[11px] text-destructive hover:underline"
                        onClick={() => deleteTask.mutate(task.id)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px] font-normal", STATUS_STYLES[task.status])}
                    >
                      {TASK_STATUS_META[task.status].label}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
