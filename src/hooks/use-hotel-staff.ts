import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError, useErrorToast } from "@/hooks/use-rent";
import { looseFrom } from "@/lib/supabase-loose";

/**
 * Hotel STAFF management + payroll data layer (migration 20260810000001).
 *
 * `hotel_staff` is the operator's team (their own + their agency's). A "staff
 * member" here is a hotel EMPLOYEE (receptionist, housekeeping, …) — a
 * different concept to the Clerk org team in `useStaff` (that's who can sign
 * into the marketplace). `staff_payroll` is one row per payment: a monthly
 * "salary" row seeded by generate_monthly_payroll() for each active
 * monthly-rate member, plus hand-added advances / bonuses / penalties.
 *
 * Both tables are added by 20260810000001 and aren't in the generated types
 * until `supabase gen types` runs, so reads/writes go through a loose accessor
 * and the payroll-run RPC is called through a plain typed rpc wrapper.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type HotelStaffRole =
  | "manager" | "receptionist" | "housekeeping" | "chef"
  | "security" | "maintenance" | "other";

export const HOTEL_STAFF_ROLES: { value: HotelStaffRole; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "receptionist", label: "Receptionist" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "chef", label: "Chef" },
  { value: "security", label: "Security" },
  { value: "maintenance", label: "Maintenance" },
  { value: "other", label: "Other" },
];

export type StaffPayrollType = "monthly" | "daily";

export type HotelStaff = {
  id: string;
  ownerId: string;
  orgId: string | null;
  name: string;
  role: HotelStaffRole;
  phone: string | null;
  email: string | null;
  hireDate: string | null;
  payrollType: StaffPayrollType;
  salary: number | null;
  active: boolean;
  notes: string | null;
  /**
   * The staff member's shift, as `HH:MM` local wall-clock (20260902000001).
   *
   * Attendance compares clock-in/out against these, so a night guard on
   * 20:00–06:00 must carry their real times rather than the table default —
   * see the timezone note in 20260903000001.
   */
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PayType = "salary" | "advance" | "bonus" | "penalty";

export const PAY_TYPES: { value: PayType; label: string }[] = [
  { value: "salary", label: "Salary" },
  { value: "advance", label: "Advance" },
  { value: "bonus", label: "Bonus" },
  { value: "penalty", label: "Penalty" },
];

export type PayrollStatus = "pending" | "paid" | "cancelled";

export type StaffBrief = {
  id: string;
  name: string;
  role: HotelStaffRole;
  phone: string | null;
  payrollType: StaffPayrollType;
  salary: number | null;
  active: boolean;
};

export type PayrollItem = {
  id: string;
  staffId: string;
  ownerId: string;
  orgId: string | null;
  periodStart: string;
  periodEnd: string;
  payType: PayType;
  amount: number;
  status: PayrollStatus;
  paidAt: string | null;
  note: string | null;
  createdAt: string | null;
  staff: StaffBrief | null;
};

export type HotelStaffFormInput = {
  name: string;
  role: HotelStaffRole;
  phone?: string;
  email?: string;
  hireDate?: string;
  payrollType: StaffPayrollType;
  salary?: number | null;
  active: boolean;
  notes?: string;
};

export type PayrollFormInput = {
  staffId: string;
  periodStart: string;
  periodEnd: string;
  payType: PayType;
  amount: number;
  note?: string;
};

// ── Raw row shapes ───────────────────────────────────────────────────────────

type RawStaff = {
  id: string;
  owner_id: string;
  org_id: string | null;
  name: string;
  role: HotelStaffRole;
  phone: string | null;
  email: string | null;
  hire_date: string | null;
  payroll_type: StaffPayrollType;
  salary: string | number | null;
  active: boolean | null;
  notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type RawBrief = {
  id: string;
  name: string;
  role: HotelStaffRole;
  phone: string | null;
  payroll_type: StaffPayrollType;
  salary: string | number | null;
  active: boolean | null;
};

type RawPayment = {
  id: string;
  staff_id: string;
  owner_id: string;
  org_id: string | null;
  period_start: string;
  period_end: string;
  pay_type: PayType;
  amount: string | number | null;
  status: PayrollStatus;
  paid_at: string | null;
  note: string | null;
  created_at: string | null;
  staff?: RawBrief | null;
};

const toNum = (v: string | number | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * Snap a running money total back onto cents. Both `hotel_staff.salary` and
 * `staff_payroll.amount` are NUMERIC(12,2) in Postgres, but they arrive as JS
 * doubles, so accumulating them reintroduces binary drift Postgres never had —
 * 0.1 + 0.2 = 0.30000000000000004, and formatMoney only drops the cents when
 * the number is an exact integer, so a $1,200.00 payroll would print as
 * "$1,200.00" or worse. Round every total the UI shows, not the inputs.
 */
export const roundCents = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;

function toStaff(row: RawStaff): HotelStaff {
  return {
    id: row.id,
    ownerId: row.owner_id,
    orgId: row.org_id ?? null,
    name: row.name,
    role: row.role,
    phone: row.phone ?? null,
    email: row.email ?? null,
    hireDate: row.hire_date ?? null,
    payrollType: row.payroll_type,
    salary: toNum(row.salary),
    active: row.active ?? false,
    notes: row.notes ?? null,
    // Postgres TIME comes back as `HH:MM:SS`; the inputs and the comparisons
    // upstream all speak `HH:MM`, so narrow once here rather than at each use.
    scheduledStart: row.scheduled_start?.slice(0, 5) ?? "09:00",
    scheduledEnd: row.scheduled_end?.slice(0, 5) ?? "18:00",
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function toBrief(row: RawBrief): StaffBrief {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone ?? null,
    payrollType: row.payroll_type,
    salary: toNum(row.salary),
    active: row.active ?? false,
  };
}

function toPayment(row: RawPayment): PayrollItem {
  return {
    id: row.id,
    staffId: row.staff_id,
    ownerId: row.owner_id,
    orgId: row.org_id ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payType: row.pay_type,
    amount: toNum(row.amount) ?? 0,
    status: row.status,
    paidAt: row.paid_at ?? null,
    note: row.note ?? null,
    createdAt: row.created_at ?? null,
    staff: row.staff ? toBrief(row.staff) : null,
  };
}

const looseRpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as {
    rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(fn, args);

// ── Pay-period helpers ───────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM` for the current month — the default month picker value. */
export function currentMonthInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** `YYYY-MM` → `{ start, end }` as date strings covering the whole month. */
export function monthBounds(value: string): { start: string; end: string } {
  const [y, m] = value.split("-").map(Number);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  return { start, end: `${y}-${pad2(m)}-${pad2(lastDay)}` };
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Roster query key. The list is filtered CLIENT-side by the signed-in user's
 * Clerk id + active org (RLS already narrowed it server-side, this trims an
 * admin's firehose), so the identity has to be part of the key: Clerk resolves
 * `useOrganization()` a tick AFTER `isSignedIn` flips, and with a fixed key the
 * roster fetched during that gap — filtered against a still-null orgId, so an
 * agency's members are dropped — would be cached forever and never refetched.
 * Same reason a stale roster survived a sign-out into a different account.
 *
 * Called bare it returns the 2-element PREFIX so every existing
 * `invalidateQueries({ queryKey: hotelStaffKey() })` keeps matching — the same
 * contract payrollKey below had to be fixed to honour.
 */
export const hotelStaffKey = (userId?: string | null, orgId?: string | null) =>
  userId === undefined
    ? (["hotel-staff", "mine"] as const)
    : (["hotel-staff", "mine", userId ?? null, orgId ?? null] as const);
/**
 * Payroll query key. Called WITHOUT an argument it must return a 2-element
 * PREFIX, not `[..., undefined]`.
 *
 * TanStack matches partially by walking the keys of the filter array, so a
 * 3-element `["hotel-staff","payroll",undefined]` compares `undefined` against
 * the live key's `"2026-08-01"`, mismatches on type, and invalidates NOTHING —
 * every payroll mutation would toast success while the table kept showing stale
 * rows.
 */
export const payrollKey = (periodStart?: string) =>
  periodStart
    ? (["hotel-staff", "payroll", periodStart] as const)
    : (["hotel-staff", "payroll"] as const);

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * The hotel staff the current user manages (their own + their agency's).
 * Named useHotelStaffList so it can't be confused with Clerk's org useStaff.
 */
export function useHotelStaffList() {
  const { isSignedIn, userId, orgId } = useAppAuth();
  const query = useQuery({
    queryKey: hotelStaffKey(userId, orgId),
    enabled: Boolean(isSignedIn),
    queryFn: async (): Promise<HotelStaff[]> => {
      const { data, error } = await looseFrom("hotel_staff")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data as RawStaff[]) ?? [])
        .map(toStaff)
        .filter((s) => s.ownerId === userId || (orgId != null && s.orgId === orgId));
    },
  });

  // Without this a failed roster read is indistinguishable from "no staff yet":
  // Payroll's "For *" picker just renders an empty list and the operator has no
  // idea why nobody is selectable.
  useErrorToast(query.error, "Couldn't load the team");

  return query;
}

/** Every payroll row that falls inside the given month (with its staff member). */
export function useHotelPayroll(periodStart?: string) {
  const { isSignedIn } = useAppAuth();
  const query = useQuery({
    queryKey: payrollKey(periodStart),
    enabled: Boolean(isSignedIn && periodStart),
    queryFn: async (): Promise<PayrollItem[]> => {
      const { start, end } = monthBounds(periodStart as string);
      const { data, error } = await looseFrom("staff_payroll")
        .select("*, staff:hotel_staff(id, name, role, phone, payroll_type, salary, active)")
        .gte("period_start", start)
        .lte("period_start", end)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return ((data as RawPayment[]) ?? []).map(toPayment);
    },
  });

  // This query failing used to render as the cheerful "Nothing here yet" empty
  // state — exactly how the `staff(...)` embed pointing at a table that doesn't
  // exist stayed invisible for so long. A broken read must LOOK broken.
  useErrorToast(query.error, "Couldn't load payroll for this month");

  return query;
}

// ── Mutations: staff ─────────────────────────────────────────────────────────

export function useCreateHotelStaff() {
  const queryClient = useQueryClient();
  const { userId, orgId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: HotelStaffFormInput): Promise<HotelStaff> => {
      if (!userId) throw new Error("Not signed in.");
      // `name TEXT NOT NULL` happily accepts '', so a roster row with no name is
      // a write the database will never refuse. Guard it here as well as in the
      // form — a nameless member renders as a blank row you can't identify.
      if (!input.name.trim()) throw new Error("Enter their name.");
      const { data, error } = await looseFrom("hotel_staff")
        .insert({
          owner_id: userId,
          org_id: orgId ?? null,
          name: input.name.trim(),
          role: input.role,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          hire_date: input.hireDate || null,
          payroll_type: input.payrollType,
          salary: input.salary ?? null,
          active: input.active,
          notes: input.notes?.trim() || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toStaff(data as RawStaff);
    },
    onSuccess: (staff) => {
      toast.success(`${staff.name} added to staff`);
      queryClient.invalidateQueries({ queryKey: hotelStaffKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't add the staff member")),
  });
}

export function useUpdateHotelStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; input: HotelStaffFormInput }): Promise<HotelStaff> => {
      const { id, input } = args;
      const { data, error } = await looseFrom("hotel_staff")
        .update({
          name: input.name.trim(),
          role: input.role,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          hire_date: input.hireDate || null,
          payroll_type: input.payrollType,
          salary: input.salary ?? null,
          active: input.active,
          notes: input.notes?.trim() || null,
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return toStaff(data as RawStaff);
    },
    onSuccess: (staff) => {
      toast.success(`${staff.name} updated`);
      queryClient.invalidateQueries({ queryKey: hotelStaffKey() });
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update the staff member")),
  });
}

/** Quick toggle for the active switch, kept separate so the row stays snappy. */
export function useToggleHotelStaffActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; active: boolean }) => {
      const { error } = await looseFrom("hotel_staff")
        .update({ active: args.active })
        .eq("id", args.id);
      if (error) throw error;
      return args;
    },
    onSuccess: ({ active }) => {
      toast.success(active ? "Staff member activated" : "Staff member deactivated");
      queryClient.invalidateQueries({ queryKey: hotelStaffKey() });
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update the staff member")),
  });
}

export function useDeleteHotelStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (staff: HotelStaff) => {
      const { error } = await looseFrom("hotel_staff").delete().eq("id", staff.id);
      if (error) throw error;
      return staff;
    },
    onSuccess: (staff) => {
      toast.success(`${staff.name} removed`);
      queryClient.invalidateQueries({ queryKey: hotelStaffKey() });
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't remove the staff member")),
  });
}

// ── Mutations: payroll ───────────────────────────────────────────────────────

export function useCreatePayrollItem() {
  const queryClient = useQueryClient();
  const { userId, orgId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: PayrollFormInput): Promise<PayrollItem> => {
      if (!userId) throw new Error("Not signed in.");
      const { data, error } = await looseFrom("staff_payroll")
        .insert({
          staff_id: input.staffId,
          owner_id: userId,
          org_id: orgId ?? null,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          pay_type: input.payType,
          amount: input.amount,
          status: "pending",
          note: input.note?.trim() || null,
        })
        .select("*, staff:hotel_staff(id, name, role, phone, payroll_type, salary, active)")
        .single();
      if (error) throw error;
      return toPayment(data as RawPayment);
    },
    onSuccess: () => {
      toast.success("Payment added");
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't add the payment")),
  });
}

/** Mark a payment paid (or edit a pending row's amount/note). */
export function useUpdatePayrollItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<{ amount: number; note: string | null; status: PayrollStatus }>;
    }): Promise<PayrollItem> => {
      const { id, patch } = args;
      const payload: Record<string, unknown> = { ...patch };
      if (patch.status === "paid") payload.paid_at = new Date().toISOString();
      const { data, error } = await looseFrom("staff_payroll")
        .update(payload)
        .eq("id", id)
        .select("*, staff:hotel_staff(id, name, role, phone, payroll_type, salary, active)")
        .single();
      if (error) throw error;
      return toPayment(data as RawPayment);
    },
    onSuccess: () => {
      toast.success("Payroll updated");
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update the payment")),
  });
}

export function useDeletePayrollItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await looseFrom("staff_payroll").delete().eq("id", paymentId);
      if (error) throw error;
      return paymentId;
    },
    onSuccess: () => {
      toast.success("Payment removed");
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't remove the payment")),
  });
}

/**
 * `generate_monthly_payroll` shipped declared STABLE while its body INSERTs, so
 * Postgres refuses the write with 0A000 the moment it has an actual row to add.
 * 20260811000001 drops the STABLE keyword, but until that migration is APPLIED
 * the RPC still fails in production — and the raw driver message ("INSERT is not
 * allowed in a non-volatile function") reads like a bug in the page rather than
 * a database that's behind. Name the real cause so nobody hunts the wrong one.
 */
function describePayrollRunError(error: unknown): string {
  const err = error as { code?: string; message?: string } | null;
  if (
    err?.code === "0A000" ||
    /non-volatile function|not allowed in a (non-volatile|read-only)/i.test(err?.message ?? "")
  ) {
    return "The payroll generator needs a pending database update (migration 20260811000001). Nothing was created — apply it, then try again.";
  }
  return describeWriteError(error, "Couldn't generate the payroll");
}

/** Pre-fill the month's salary rows for every ACTIVE monthly-rate staff member. */
export function useGenerateMonthlyPayroll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (month: string): Promise<number> => {
      const { start, end } = monthBounds(month);
      const { data, error } = await looseRpc("generate_monthly_payroll", {
        _month_start: start,
        _month_end: end,
      });
      if (error) throw error;
      return Number(data) || 0;
    },
    onSuccess: (count) => {
      toast.success(
        count > 0
          ? `Generated ${count} salary ${count === 1 ? "row" : "rows"} for this month`
          : "Nothing to add — everyone active already has a salary row",
      );
      // The bare 2-element key is a PREFIX of every month's key, so this alone
      // refreshes the month just generated as well as any other month cached.
      queryClient.invalidateQueries({ queryKey: payrollKey() });
    },
    onError: (error: unknown) => toast.error(describePayrollRunError(error)),
  });
}