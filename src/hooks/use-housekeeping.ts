import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError } from "@/hooks/use-rent";

/**
 * Housekeeping task data layer (migration 20260807000001).
 *
 * A task is a room-turnaround log entry — clean / deep-clean / inspection /
 * maintenance — that the desk uses between guests. Written by anyone with
 * `canManageBookings` (agents, managers, assigned caretakers, owners); the
 * table's RLS enforces it. Rows live against `room_id` (= `property_id`).
 *
 * The table is added by 20260807000001 and isn't in the generated types until
 * `supabase gen types` runs, so reads go through a loose accessor.
 */

export type HousekeepingTaskType = "clean" | "deep_clean" | "inspection" | "maintenance";
export type HousekeepingTaskStatus = "pending" | "in_progress" | "done" | "skipped";

export type HousekeepingTask = {
  id: string;
  roomId: string;
  orgId: string | null;
  taskType: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  scheduledAt: string | null;
  assignedTo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
};

type RawTask = {
  id: string;
  room_id: string;
  org_id: string | null;
  task_type: HousekeepingTaskType | null;
  status: HousekeepingTaskStatus | null;
  scheduled_at: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
};

function toTask(row: RawTask): HousekeepingTask {
  return {
    id: row.id,
    roomId: row.room_id,
    orgId: row.org_id ?? null,
    taskType: row.task_type ?? "clean",
    status: row.status ?? "pending",
    scheduledAt: row.scheduled_at ? String(row.scheduled_at).slice(0, 10) : null,
    assignedTo: row.assigned_to ?? null,
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
  };
}

export const TASK_TYPE_LABEL: Record<HousekeepingTaskType, string> = {
  clean: "Clean",
  deep_clean: "Deep clean",
  inspection: "Inspection",
  maintenance: "Maintenance",
};

export const TASK_STATUS_META: Record<
  HousekeepingTaskStatus,
  { label: string; tone: "default" | "secondary" | "info" | "success" | "warning" }
> = {
  pending: { label: "Pending", tone: "secondary" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "success" },
  skipped: { label: "Skipped", tone: "warning" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFromHousekeeping = (table: string) =>
  (supabase as unknown as LooseClient).from(table);

export const housekeepingKey = (roomIds?: readonly string[]) =>
  ["housekeeping", roomIds?.join(",") ?? "all"] as const;

/** Open (not-done) tasks across the given rooms, oldest first. */
export function useHousekeeping(roomIds: readonly string[]) {
  return useQuery({
    queryKey: housekeepingKey(roomIds),
    enabled: roomIds.length > 0,
    queryFn: async (): Promise<HousekeepingTask[]> => {
      const { data, error } = await looseFromHousekeeping("housekeeping_tasks")
        .select("*")
        .in("room_id", roomIds as string[])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data as RawTask[]) ?? []).map(toTask);
    },
  });
}

export function useSaveHousekeepingTask(roomIds: readonly string[]) {
  const queryClient = useQueryClient();
  const { orgId, userId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: {
      roomId: string;
      taskType: HousekeepingTaskType;
      scheduledAt?: string;
      assignedTo?: string;
      notes?: string;
    }) => {
      const { data, error } = await looseFromHousekeeping("housekeeping_tasks")
        .insert({
          room_id: input.roomId,
          org_id: orgId ?? null,
          task_type: input.taskType,
          scheduled_at: input.scheduledAt || null,
          assigned_to: input.assignedTo || null,
          notes: input.notes?.trim() || null,
          created_by: userId,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toTask(data as RawTask);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: housekeepingKey(roomIds) });
      queryClient.invalidateQueries({ queryKey: ["housekeeping"] });
      toast.success("Housekeeping task added");
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't add the task")),
  });
}

export function useSetHousekeepingStatus(roomIds: readonly string[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; status: HousekeepingTaskStatus }) => {
      const { error } = await looseFromHousekeeping("housekeeping_tasks")
        .update({ status: args.status })
        .eq("id", args.id);
      if (error) throw error;
      return args;
    },
    onSuccess: (_, args) => {
      queryClient.invalidateQueries({ queryKey: housekeepingKey(roomIds) });
      queryClient.invalidateQueries({ queryKey: ["housekeeping"] });
      toast.success(`Task marked ${TASK_STATUS_META[args.status].label.toLowerCase()}`);
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't update the task")),
  });
}

export function useDeleteHousekeepingTask(roomIds: readonly string[]) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await looseFromHousekeeping("housekeeping_tasks").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: housekeepingKey(roomIds) });
      queryClient.invalidateQueries({ queryKey: ["housekeeping"] });
      toast.success("Task removed");
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't remove the task")),
  });
}
