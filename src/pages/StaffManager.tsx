import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, CalendarCheck2, Mail, Pencil, Phone, Plus, Trash2, Users, Wallet,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatDay, formatMoney } from "@/hooks/use-rent";
import {
  HOTEL_STAFF_ROLES, useHotelStaffList,
  useCreateHotelStaff, useUpdateHotelStaff, useToggleHotelStaffActive,
  useDeleteHotelStaff, type HotelStaff, type HotelStaffRole,
  type HotelStaffFormInput,
} from "@/hooks/use-hotel-staff";

const ROLE_LABEL: Record<HotelStaffRole, string> = Object.fromEntries(
  HOTEL_STAFF_ROLES.map((r) => [r.value, r.label]),
);

const AVATAR_COLORS = [
  "#0f766e", "#1d4ed8", "#b45309", "#7c3aed", "#be185d", "#047857", "#b91c1c",
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const emptyForm = (): HotelStaffFormInput => ({
  name: "",
  role: "other",
  phone: "",
  email: "",
  hireDate: "",
  payrollType: "monthly",
  salary: null,
  active: true,
  notes: "",
});

/**
 * /manage/staff — the team roster (migration 20260810000001).
 *
 * Add, edit, activate or retire hotel employees and set how each is paid
 * (monthly salary vs daily rate). The monthly payroll is run next door on
 * /manage/payroll, which seeds one salary row per active monthly-rate member.
 */
const StaffManager = () => {
  const { data: staff, isPending, isError } = useHotelStaffList();
  const deleteStaff = useDeleteHotelStaff();
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HotelStaff | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HotelStaff | null>(null);

  const visible = useMemo(() => {
    const rows = staff ?? [];
    if (filter === "all") return rows;
    return rows.filter((s) => (filter === "active" ? s.active : !s.active));
  }, [staff, filter]);

  const monthlyTotal = useMemo(
    () => (staff ?? [])
      .filter((s) => s.active && s.payrollType === "monthly")
      .reduce((sum, s) => sum + (s.salary ?? 0), 0),
    [staff],
  );

  const counts = useMemo(
    () => ({
      all: (staff ?? []).length,
      active: (staff ?? []).filter((s) => s.active).length,
      inactive: (staff ?? []).filter((s) => !s.active).length,
    }),
    [staff],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (member: HotelStaff) => {
    setEditing(member);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-3xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/manage/hotel"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Hotel desk
            </Link>
            <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Staff
            </h1>
            <p className="text-sm text-muted-foreground">Your team and how they're paid.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link to="/manage/payroll">
                <Wallet className="w-4 h-4" /> <span className="hidden sm:inline">Payroll</span>
              </Link>
            </Button>
            <Button variant="hero" size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add staff
            </Button>
          </div>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Active" value={String(counts.active)} />
          <StatTile label="Team total" value={String(counts.all)} />
          <StatTile
            label="Monthly payroll"
            value={formatMoney(monthlyTotal)}
            mono
          />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40",
              )}
            >
              {f[0].toUpperCase() + f.slice(1)}
              <span className="ml-1 opacity-70">
                {f === "all" ? counts.all : f === "active" ? counts.active : counts.inactive}
              </span>
            </button>
          ))}
        </div>

        {/* List */}
        {isPending ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
          </div>
        ) : isError ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <p className="text-sm text-destructive">The team couldn't be loaded.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-14 bg-card rounded-2xl border border-dashed border-border">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Users className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">
              {staff && staff.length > 0 ? "No staff in this view" : "No staff yet"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              {staff && staff.length > 0
                ? "Change the filter to see everyone, or add a new team member."
                : "Add receptionists, housekeeping, chefs and security — then run payroll for them from Payroll."}
            </p>
            <Button variant="hero" onClick={openCreate}>
              <Plus className="w-4 h-4" /> Add staff
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((member, i) => (
              <StaffRow
                key={member.id}
                member={member}
                color={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                onEdit={() => openEdit(member)}
                onDelete={() => setDeleteTarget(member)}
              />
            ))}
          </ul>
        )}
      </div>

      <StaffFormDialog
        key={`${editing?.id ?? "none"}:${dialogOpen}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => setDialogOpen(false)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name} from staff?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll stop appearing here and <span className="text-foreground font-medium">their payroll
              history for every month is removed too</span>. Their contact details are deleted with them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteStaff.mutate(deleteTarget)}
              disabled={deleteStaff.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteStaff.isPending ? "Removing…" : "Remove staff"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
};

/** Tiny stat tile used above the roster. */
function StatTile({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold text-foreground", mono && "font-mono")}>
        {value}
      </p>
    </div>
  );
}

function StaffRow({
  member, color, onEdit, onDelete,
}: {
  member: HotelStaff;
  color: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toggleActive = useToggleHotelStaffActive();
  return (
    <li className="bg-card rounded-2xl border border-border p-4 flex items-center gap-3">
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-heading font-bold text-sm shrink-0"
        style={{ backgroundColor: color }}
      >
        {initials(member.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn("font-semibold text-foreground text-sm", !member.active && "text-muted-foreground line-through")}>
            {member.name}
          </p>
          <Badge variant="secondary" className="rounded-full text-[10px]">
            {ROLE_LABEL[member.role]}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {member.phone && (
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {member.phone}</span>
          )}
          {member.email && (
            <span className="inline-flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {member.email}</span>
          )}
          {member.hireDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarCheck2 className="w-3 h-3" /> Since {formatDay(`${member.hireDate}T00:00:00`)}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-foreground/80">
          <span className={cn("font-medium", member.payrollType === "daily" ? "text-amber-600" : "text-teal-700")}>
            {member.payrollType === "monthly" ? "Monthly salary" : "Daily rate"}
          </span>
          <span className="ml-1 font-mono">{member.salary != null ? formatMoney(member.salary) : "—"}</span>
        </p>
      </div>
      <div className="flex flex-col items-center gap-2 shrink-0">
        <Switch
          checked={member.active}
          onCheckedChange={(v) => toggleActive.mutate({ id: member.id, active: v })}
          aria-label={`${member.active ? "Deactivate" : "Activate"} ${member.name}`}
        />
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} aria-label={`Edit ${member.name}`}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete} aria-label={`Remove ${member.name}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

// ── Add / edit dialog ────────────────────────────────────────────────────────

function StaffFormDialog({
  open, onOpenChange, editing, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: HotelStaff | null;
  onSaved: () => void;
}) {
  const createStaff = useCreateHotelStaff();
  const updateStaff = useUpdateHotelStaff();
  const saving = createStaff.isPending || updateStaff.isPending;

  // The dialog is keyed by target + open state in the parent, so this component
  // remounts fresh for every open — the initial form below is always correct.
  const [form, setForm] = useState<HotelStaffFormInput>(() =>
    editing
      ? {
          name: editing.name,
          role: editing.role,
          phone: editing.phone ?? "",
          email: editing.email ?? "",
          hireDate: editing.hireDate ?? "",
          payrollType: editing.payrollType,
          salary: editing.salary,
          active: editing.active,
          notes: editing.notes ?? "",
        }
      : emptyForm(),
  );
  const [touched, setTouched] = useState(false);

  const nameError = touched && form.name.trim().length < 2 ? "Enter their name." : null;
  const salaryRaw = form.salary == null ? "" : String(form.salary);
  const salaryError =
    touched && salaryRaw.trim() !== "" && (!Number.isFinite(Number(salaryRaw)) || Number(salaryRaw) < 0)
      ? "Enter an amount 0 or above."
      : null;

  const set = <K extends keyof HotelStaffFormInput>(key: K, value: HotelStaffFormInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameError || salaryError) return;

    const input: HotelStaffFormInput = {
      ...form,
      name: form.name.trim(),
      salary: salaryRaw.trim() === "" ? null : Number(salaryRaw),
    };

    const done = () => onSaved();
    if (editing) updateStaff.mutate({ id: editing.id, input }, { onSuccess: done });
    else createStaff.mutate(input, { onSuccess: done });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "Add staff member"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update their details or how they're paid."
              : "Who are you adding to the team? Payroll uses their role and rate."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="staff-name" className="text-xs text-muted-foreground">Full name *</Label>
            <Input
              id="staff-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Abdirahman Hassan"
              className="h-11 rounded-xl"
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v as HotelStaffRole)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOTEL_STAFF_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-hire" className="text-xs text-muted-foreground">Start date</Label>
              <Input
                id="staff-hire"
                type="date"
                value={form.hireDate}
                onChange={(e) => set("hireDate", e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="staff-phone" className="text-xs text-muted-foreground">Phone</Label>
            <Input
              id="staff-phone"
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+252…"
              className="h-11 rounded-xl"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-email" className="text-xs text-muted-foreground">Email</Label>
            <Input
              id="staff-email"
              type="email"
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
              placeholder="name@hotel.com"
              className="h-11 rounded-xl"
            />
          </div>

          <div className="rounded-xl border border-border p-3 space-y-3">
            <p className="text-xs font-medium text-foreground">How are they paid?</p>
            <div className="grid grid-cols-2 gap-2">
              <PayrollTypeCard
                active={form.payrollType === "monthly"}
                label="Monthly salary"
                hint="same amount every month"
                onClick={() => set("payrollType", "monthly")}
              />
              <PayrollTypeCard
                active={form.payrollType === "daily"}
                label="Daily wage"
                hint="per day worked"
                onClick={() => set("payrollType", "daily")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-salary" className="text-xs text-muted-foreground">
                {form.payrollType === "monthly" ? "Monthly salary" : "Daily rate"}
              </Label>
              <Input
                id="staff-salary"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={salaryRaw}
                onChange={(e) => set("salary", e.target.value === "" ? null : Number(e.target.value))}
                placeholder="0"
                className="h-11 rounded-xl font-mono"
              />
              {salaryError && <p className="text-xs text-destructive">{salaryError}</p>}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {form.payrollType === "monthly"
                ? "Payroll pre-fills one salary row for them each month."
                : "Daily-wage pay depends on shifts worked — you add it by hand in Payroll."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="staff-notes" className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              id="staff-notes"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Emergency contact, uniform size, shift preference…"
              className="rounded-xl text-sm min-h-[64px]"
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <span className="text-sm text-foreground">
              Currently active
              <span className="block text-[11px] text-muted-foreground">
                Inactive members don't appear in payroll runs.
              </span>
            </span>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="hero" disabled={saving || !!nameError || !!salaryError}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add to staff"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayrollTypeCard({
  active, label, hint, onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <p className={cn("text-xs font-semibold", active ? "text-primary" : "text-foreground")}>{label}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
    </button>
  );
}

export default StaffManager;