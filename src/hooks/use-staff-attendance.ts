import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError } from "@/hooks/use-rent";
import { looseFrom } from "@/lib/supabase-loose";

/**
 * Staff attendance data layer (migration 20260831000001).
 *
 * Attendance records track when each staff member clocked in/out vs their
 * scheduled shift (from hotel_staff.scheduled_start / scheduled_end).
 * Status is auto-derived by a database trigger but can be overridden.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type AttendanceStatus = "present" | "absent" | "late" | "early_leave" | "on_leave";

export type AttendanceRecord = {
  id: string;
  staffId: string;
  ownerId: string;
  orgId: string | null;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: AttendanceStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceWithStaff = AttendanceRecord & {
  staffName: string;
  staffRole: string;
  staffPhone: string | null;
};

// ── Raw row shapes ───────────────────────────────────────────────────────────

type RawAttendance = {
  id: string;
  staff_id: string;
  owner_id: string;
  org_id: string | null;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: AttendanceStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type RawAttendanceJoin = RawAttendance & {
  staff: { id: string; name: string; role: string; phone: string | null } | null;
};

function toAttendance(row: RawAttendance): AttendanceRecord {
  return {
    id: row.id,
    staffId: row.staff_id,
    ownerId: row.owner_id,
    orgId: row.org_id ?? null,
    date: String(row.date).slice(0, 10),
    clockIn: row.clock_in ?? null,
    clockOut: row.clock_out ?? null,
    scheduledStart: row.scheduled_start?.slice(0, 5) ?? "09:00",
    scheduledEnd: row.scheduled_end?.slice(0, 5) ?? "18:00",
    status: row.status,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttendanceWithStaff(row: RawAttendanceJoin): AttendanceWithStaff {
  return {
    ...toAttendance(row),
    staffName: row.staff?.name ?? "Unknown",
    staffRole: row.staff?.role ?? "other",
    staffPhone: row.staff?.phone ?? null,
  };
}

// ── Loose accessor ───────────────────────────────────────────────────────────

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Keyed by SCOPE as well as date.
 *
 * Without the scope in the key, switching the active organisation served the
 * previous org's roster from cache — the rows differ, the key did not. Called
 * bare it still returns the `["staff-attendance"]` prefix, which is what the
 * mutations invalidate.
 */
export const attendanceKey = (date?: string, scope?: string) => {
  if (!date) return ["staff-attendance"] as const;
  if (!scope) return ["staff-attendance", date] as const;
  return ["staff-attendance", date, scope] as const;
};

export const attendanceStaffKey = (staffId?: string) =>
  staffId ? (["staff-attendance", "staff", staffId] as const) : (["staff-attendance", "staff"] as const);

// ── Today's date helper ──────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for today, local time. */
export function todayDateInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * All attendance records for a given date, joined with staff name/role.
 */
export function useAttendanceForDate(date: string) {
  const { isSignedIn, userId, orgId } = useAppAuth();

  return useQuery({
    queryKey: attendanceKey(date, `${userId ?? "-"}:${orgId ?? "-"}`),
    enabled: Boolean(isSignedIn && date && userId),
    queryFn: async (): Promise<AttendanceWithStaff[]> => {
      const { data, error } = await looseFrom("staff_attendance")
        .select("*, staff:hotel_staff(id, name, role, phone)")
        .eq("date", date)
        .order("clock_in", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return ((data as RawAttendanceJoin[]) ?? [])
        .map(toAttendanceWithStaff)
        // Same scoping rule as useHotelStaffList: own records, plus the active
        // org's. RLS is the real boundary — this stops an operator who runs two
        // businesses from seeing both rosters merged with no way to tell them
        // apart, which is a legibility problem rather than a security one.
        .filter((a) => a.ownerId === userId || (orgId != null && a.orgId === orgId));
    },
  });
}

/**
 * Attendance history for a single staff member (last 30 days).
 */
export function useStaffAttendanceHistory(staffId?: string) {
  const { isSignedIn } = useAppAuth();

  return useQuery({
    queryKey: attendanceStaffKey(staffId),
    enabled: Boolean(isSignedIn && staffId),
    queryFn: async (): Promise<AttendanceRecord[]> => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const since = `${thirtyDaysAgo.getFullYear()}-${pad2(thirtyDaysAgo.getMonth() + 1)}-${pad2(thirtyDaysAgo.getDate())}`;

      const { data, error } = await looseFrom("staff_attendance")
        .select("*")
        .eq("staff_id", staffId)
        .gte("date", since)
        .order("date", { ascending: false });
      if (error) throw error;
      return ((data as RawAttendance[]) ?? []).map(toAttendance);
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type ClockInInput = {
  staffId: string;
  ownerId: string;
  orgId: string | null;
  date: string;
  clockIn: string; // ISO timestamp
  scheduledStart: string;
  scheduledEnd: string;
};

export type ClockOutInput = {
  attendanceId: string;
  clockOut: string; // ISO timestamp
};

export type OverrideAttendanceInput = {
  id: string;
  status: AttendanceStatus;
  notes?: string;
  clockIn?: string;
  clockOut?: string;
};

/** Create a new attendance row (clock-in) or update clock-in for today. */
export function useClockIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ClockInInput): Promise<AttendanceRecord> => {
      const { data, error } = await looseFrom("staff_attendance")
        .upsert(
          {
            staff_id: input.staffId,
            owner_id: input.ownerId,
            org_id: input.orgId ?? null,
            date: input.date,
            clock_in: input.clockIn,
            scheduled_start: input.scheduledStart,
            scheduled_end: input.scheduledEnd,
          },
          { onConflict: "staff_id,date", ignoreDuplicates: false },
        )
        .select("*")
        .single();
      if (error) throw error;
      return toAttendance(data as RawAttendance);
    },
    onSuccess: () => {
      toast.success("Clock-in recorded");
      queryClient.invalidateQueries({ queryKey: attendanceKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't clock in")),
  });
}

/** Record clock-out for an existing attendance row. */
export function useClockOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ClockOutInput): Promise<AttendanceRecord> => {
      const { data, error } = await looseFrom("staff_attendance")
        .update({ clock_out: input.clockOut })
        .eq("id", input.attendanceId)
        .select("*")
        .single();
      if (error) throw error;
      return toAttendance(data as RawAttendance);
    },
    onSuccess: () => {
      toast.success("Clock-out recorded");
      queryClient.invalidateQueries({ queryKey: attendanceKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't clock out")),
  });
}

/** Override the auto-derived status or add notes. */
export function useOverrideAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: OverrideAttendanceInput): Promise<AttendanceRecord> => {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.clockIn !== undefined) patch.clock_in = input.clockIn;
      if (input.clockOut !== undefined) patch.clock_out = input.clockOut;

      const { data, error } = await looseFrom("staff_attendance")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return toAttendance(data as RawAttendance);
    },
    onSuccess: () => {
      toast.success("Attendance updated");
      queryClient.invalidateQueries({ queryKey: attendanceKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update attendance")),
  });
}