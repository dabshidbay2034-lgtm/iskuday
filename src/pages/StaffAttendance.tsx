import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, Clock, ClockArrowDown, ClockArrowUp,
  Pencil, User, AlertTriangle, XCircle,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAppAuth } from "@/hooks/use-auth";
import { useHotelStaffList } from "@/hooks/use-hotel-staff";
import {
  useAttendanceForDate, useClockIn, useClockOut, useOverrideAttendance,
  todayDateInput, type AttendanceWithStaff, type AttendanceStatus,
} from "@/hooks/use-staff-attendance";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof BadgeCheck }> = {
  present: { label: "Present", variant: "default", icon: BadgeCheck },
  absent: { label: "Absent", variant: "destructive", icon: XCircle },
  late: { label: "Late", variant: "secondary", icon: AlertTriangle },
  on_leave: { label: "On Leave", variant: "outline", icon: ClockArrowUp },
  early_leave: { label: "Early Leave", variant: "outline", icon: ClockArrowDown },
};

const ROLE_LABEL: Record<string, string> = {
  manager: "Manager",
  receptionist: "Receptionist",
  housekeeping: "Housekeeping",
  chef: "Chef",
  security: "Security",
  maintenance: "Maintenance",
  other: "Other",
};

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 5);
  }
}

function attendanceMap(records: AttendanceWithStaff[]): Map<string, AttendanceWithStaff> {
  const map = new Map<string, AttendanceWithStaff>();
  for (const r of records) {
    map.set(r.staffId, r);
  }
  return map;
}

type RosterRow = {
  staffId: string;
  staffName: string;
  staffRole: string;
  /** The staff member's OWN shift — never a hardcoded 09:00–18:00. */
  scheduledStart: string;
  scheduledEnd: string;
  attendance: AttendanceWithStaff | null;
};

// ── Component ────────────────────────────────────────────────────────────────

const StaffAttendance = () => {
  const [date, setDate] = useState<string>(todayDateInput());
  const { userId, orgId } = useAppAuth();

  const { data: attendance, isPending: attPending, isError: attError, refetch: refetchAtt } = useAttendanceForDate(date);
  const { data: staffList, isPending: staffPending } = useHotelStaffList();
  const clockIn = useClockIn();
  const clockOut = useClockOut();
  const overrideAtt = useOverrideAttendance();

  const [editTarget, setEditTarget] = useState<AttendanceWithStaff | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>("present");
  const [editNotes, setEditNotes] = useState("");

  const roster = useMemo((): RosterRow[] => {
    const byStaffId = attendanceMap(attendance ?? []);
    return (staffList ?? [])
      .filter((s) => s.active)
      .map((s) => ({
        staffId: s.id,
        staffName: s.name,
        staffRole: s.role,
        scheduledStart: s.scheduledStart,
        scheduledEnd: s.scheduledEnd,
        attendance: byStaffId.get(s.id) ?? null,
      }));
  }, [staffList, attendance]);

  /**
   * Counts every status the CHECK constraint allows, not just three of them.
   *
   * This used to tally present/absent/late only. Attendance has FIVE statuses,
   * so anyone marked early_leave or on_leave was counted in the total and in no
   * bucket at all - a roster of one person who left early rendered as
   * "Present 0 / Late 0 / Absent 0 / Total active 1", which reads as though
   * nobody turned up. Deriving buckets from the status itself means a newly
   * added status can never again go silently uncounted.
   */
  const summary = useMemo(() => {
    const tally: Record<AttendanceStatus, number> = {
      present: 0, absent: 0, late: 0, early_leave: 0, on_leave: 0,
    };
    let recorded = 0;
    for (const row of roster) {
      const status = row.attendance?.status;
      if (status && status in tally) { tally[status] += 1; recorded += 1; }
    }
    return { ...tally, total: roster.length, noRecord: roster.length - recorded };
  }, [roster]);

  const isToday = date === todayDateInput();

  function handleClockIn(row: RosterRow) {
    if (!userId) return; // route is auth-gated; never write an empty owner_id
    clockIn.mutate({
      staffId: row.staffId,
      ownerId: userId,
      orgId: orgId ?? null,
      date,
      clockIn: new Date().toISOString(),
      // The staff member's real shift. The trigger re-reads it from hotel_staff
      // anyway, but sending the truth keeps the row correct even if migration
      // 20260902000001 hasn't been applied yet.
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
    });
  }

  function handleClockOut(attendanceId: string) {
    clockOut.mutate({ attendanceId, clockOut: new Date().toISOString() });
  }

  function openEdit(record: AttendanceWithStaff) {
    setEditTarget(record);
    setEditStatus(record.status);
    setEditNotes(record.notes ?? "");
  }

  function handleSaveOverride() {
    if (!editTarget) return;
    overrideAtt.mutate(
      { id: editTarget.id, status: editStatus, notes: editNotes || undefined },
      { onSuccess: () => setEditTarget(null) },
    );
  }

  const isPending = attPending || staffPending;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-4xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link
              to="/manage/staff"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Staff
            </Link>
            <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" /> Attendance
            </h1>
            <p className="text-sm text-muted-foreground">
              Clock-in / out and daily attendance tracking.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              aria-label="Attendance date"
            />
          </div>
        </div>

        {/* Summary stats */}
        {/* Summary stats. Six tiles, not four: the buckets must sum to the
            roster or the row of numbers quietly contradicts the list below it. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryTile label="Present" value={String(summary.present)} className="text-success" />
          <SummaryTile label="Late" value={String(summary.late)} className="text-amber-600" />
          <SummaryTile label="Left early" value={String(summary.early_leave)} className="text-amber-600" />
          <SummaryTile label="On leave" value={String(summary.on_leave)} className="text-muted-foreground" />
          <SummaryTile label="Absent" value={String(summary.absent)} className="text-destructive" />
          <SummaryTile label="Total active" value={String(summary.total)} className="text-foreground" />
        </div>

        {/* Roster */}
        {isPending ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : attError ? (
          <div className="text-center py-14 bg-card rounded-2xl border border-destructive/40">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-3">
              <XCircle className="w-7 h-7 text-destructive" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">Attendance couldn't be loaded</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              The attendance data didn't come back from the server. Nothing has been lost.
            </p>
            <Button variant="outline" onClick={() => refetchAtt()}>Try again</Button>
          </div>
        ) : roster.length === 0 ? (
          <div className="text-center py-14 bg-card rounded-2xl border border-dashed border-border">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <User className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">No active staff</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Add team members on the Staff page before tracking attendance.
            </p>
            <Button variant="hero" asChild>
              <Link to="/manage/staff">Add staff</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {roster.map((row) => (
              <AttendanceRow
                key={row.staffId}
                row={row}
                isToday={isToday}
                clockingIn={clockIn.isPending && clockIn.variables?.staffId === row.staffId}
                clockingOut={clockOut.isPending && row.attendance != null && clockOut.variables?.attendanceId === row.attendance.id}
                onClockIn={() => handleClockIn(row)}
                onClockOut={() => row.attendance && handleClockOut(row.attendance.id)}
                onEdit={() => row.attendance && openEdit(row.attendance)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Edit attendance dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Override attendance</DialogTitle>
            <DialogDescription>
              {editTarget?.staffName} &middot; {editTarget ? ROLE_LABEL[editTarget.staffRole] ?? editTarget.staffRole : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-status" className="text-xs text-muted-foreground">Status</Label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as AttendanceStatus)}>
                <SelectTrigger id="edit-status" className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["present", "absent", "late", "on_leave", "early_leave"] as AttendanceStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        {STATUS_CONFIG[s].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes" className="text-xs text-muted-foreground">Notes</Label>
              <Textarea id="edit-notes" value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Reason for override, extra context…" rows={3} className="rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleSaveOverride} disabled={overrideAtt.isPending} className="rounded-xl">
              {overrideAtt.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold font-mono", className)}>{value}</p>
    </div>
  );
}

function AttendanceRow({ row, isToday, clockingIn, clockingOut, onClockIn, onClockOut, onEdit }: {
  row: RosterRow;
  isToday: boolean;
  clockingIn: boolean;
  clockingOut: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onEdit: () => void;
}) {
  const att = row.attendance;
  const cfg = att ? STATUS_CONFIG[att.status] ?? STATUS_CONFIG.absent : null;
  const StatusIcon = cfg?.icon ?? User;
  const canClockIn = isToday && !att?.clockIn;
  const canClockOut = isToday && att?.clockIn && !att?.clockOut;

  return (
    <li className="bg-card rounded-2xl border border-border p-4 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate max-w-[180px]">{row.staffName}</span>
            <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {ROLE_LABEL[row.staffRole] ?? row.staffRole}
            </span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div className="flex items-center gap-1.5">
              <ClockArrowUp className="w-3 h-3" />
              {/* Falls back to the staff member's own shift, not a 9-to-6
                  guess — before anyone clocks in there is no attendance row,
                  and showing "09:00" to a night guard is a lie. */}
              <span>Scheduled: {att?.scheduledStart ?? row.scheduledStart} &ndash; {att?.scheduledEnd ?? row.scheduledEnd}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ClockArrowDown className="w-3 h-3" />
              <span>Clock in: {att?.clockIn ? formatTime(att.clockIn) : <span className="italic">Not clocked in</span>}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>
                Clock out:{" "}
                {att?.clockOut
                  ? formatTime(att.clockOut)
                  : att?.clockIn
                    ? <span className="italic text-success">Still working</span>
                    : <span className="italic">Not clocked out</span>}
              </span>
            </div>
          </div>
          {att?.notes && <p className="text-xs text-muted-foreground italic bg-muted/40 rounded-lg px-2 py-1">{att.notes}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {att ? (
            <Badge variant={cfg?.variant ?? "outline"} className="flex items-center gap-1 whitespace-nowrap">
              <StatusIcon className="w-3 h-3" />{cfg?.label ?? att.status}
            </Badge>
          ) : (
            <Badge variant="destructive" className="flex items-center gap-1 whitespace-nowrap">
              <XCircle className="w-3 h-3" />No record
            </Badge>
          )}
          <div className="flex items-center gap-1.5">
            {canClockIn && (
              <Button variant="outline" size="sm" onClick={onClockIn} disabled={clockingIn} className="h-8 text-xs rounded-xl">
                {clockingIn ? (
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : <ClockArrowUp className="w-3.5 h-3.5" />}
                Clock in
              </Button>
            )}
            {canClockOut && (
              <Button variant="outline" size="sm" onClick={onClockOut} disabled={clockingOut} className="h-8 text-xs rounded-xl">
                {clockingOut ? (
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : <ClockArrowDown className="w-3.5 h-3.5" />}
                Clock out
              </Button>
            )}
            {att && (
              <button type="button" onClick={onEdit} className="w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors" aria-label="Edit attendance">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default StaffAttendance;