import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

import { type ManagedProperty } from "@/hooks/use-rent";
import {
  useSaveMaintenance,
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceRow,
  type MaintenanceStatus,
} from "@/hooks/use-maintenance";

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

type MaintenanceDialogProps = {
  property: ManagedProperty;
  /** Pass an existing job to edit it; `null` logs a new one. */
  job: MaintenanceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Logs (or updates) a maintenance/work-order ticket. Recording a job is data
 * entry, so both staff and managers may do it (plan §5).
 */
export function MaintenanceDialog({
  property, job, open, onOpenChange,
}: MaintenanceDialogProps) {
  const save = useSaveMaintenance(property);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory>("plumbing");
  const [priority, setPriority] = useState<MaintenancePriority>("medium");
  const [status, setStatus] = useState<MaintenanceStatus>("open");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [actualCost, setActualCost] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(job?.title ?? "");
    setDescription(job?.description ?? "");
    setCategory(job?.category ?? "plumbing");
    setPriority(job?.priority ?? "medium");
    setStatus(job?.status ?? "open");
    setEstimatedCost(job?.estimatedCost != null ? String(job.estimatedCost) : "");
    setActualCost(job?.actualCost != null ? String(job.actualCost) : "");
    setAssignedTo(job?.assignedTo ?? "");
    setTouched(false);
  }, [open, job]);

  const parsedEst = estimatedCost ? Number(estimatedCost) : null;
  const parsedActual = actualCost ? Number(actualCost) : null;
  const costInvalid =
    (parsedEst !== null && (!Number.isFinite(parsedEst) || parsedEst < 0)) ||
    (parsedActual !== null && (!Number.isFinite(parsedActual) || parsedActual < 0));

  const titleInvalid = touched && title.trim().length < 2;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (title.trim().length < 2 || costInvalid) return;

    save.mutate(
      {
        id: job?.id,
        title,
        description,
        category,
        priority,
        status,
        estimatedCost: parsedEst,
        actualCost: parsedActual,
        assignedTo: assignedTo || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job ? "Update maintenance job" : "Log a maintenance job"}</DialogTitle>
          <DialogDescription>
            {property.title} — a work order for your team.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="maint-title" className="text-xs text-muted-foreground">
              Job
            </Label>
            <Input
              id="maint-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Tube leaking behind the kitchen sink…"
              maxLength={160}
              className="h-11 rounded-xl"
              aria-invalid={titleInvalid}
              autoFocus
            />
            {titleInvalid && <p className="text-xs text-destructive">Describe the job.</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="maint-category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as MaintenanceCategory)}
              >
                <SelectTrigger id="maint-category" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maint-priority" className="text-xs text-muted-foreground">
                Priority
              </Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as MaintenancePriority)}
              >
                <SelectTrigger id="maint-priority" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maint-status" className="text-xs text-muted-foreground">
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as MaintenanceStatus)}
            >
              <SelectTrigger id="maint-status" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAINTENANCE_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="maint-est" className="text-xs text-muted-foreground">
                Estimated cost <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="maint-est"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maint-actual" className="text-xs text-muted-foreground">
                Actual cost <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="maint-actual"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                placeholder="0"
                className="h-11 rounded-xl"
              />
            </div>
          </div>
          {costInvalid && (
            <p className="text-xs text-destructive">Costs must be valid amounts of zero or more.</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="maint-assigned" className="text-xs text-muted-foreground">
              Assigned to <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Input
              id="maint-assigned"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              placeholder="Handyman, or a staff member"
              maxLength={80}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="maint-description" className="text-xs text-muted-foreground">
              Notes <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="maint-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs doing, parts needed, who to call…"
              className="rounded-xl min-h-[72px]"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={save.isPending || titleInvalid || costInvalid}
            >
              <Wrench className="w-4 h-4" />
              {save.isPending ? "Saving..." : job ? "Save changes" : "Log job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}