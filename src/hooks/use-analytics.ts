import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { useManageScope, useOrgProperties, usePortfolioRent, buildPortfolioSummary, formatMoney, type ManagedProperty, type RentLedgerRow } from "@/hooks/use-rent";
import { useHotelBookings, occupiedRoomIdsOn, staysOnDate, ACTIVE_BOOKING_STATUSES, type Booking } from "@/hooks/use-bookings";
import { useHotelStaffList } from "@/hooks/use-hotel-staff";

/**
 * Analytics data layer for the hotel dashboard.
 *
 * Aggregates money-in, money-out, occupancy, bookings, and staff activity into
 * time-windowed reports (day / week / month). Uses existing hooks for raw data
 * and computes derived analytics client-side.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type AnalyticsTimeframe = "day" | "week" | "month";

export type MoneyFlow = {
  moneyIn: number;
  moneyOut: number;
  net: number;
  expectedIn: number;
  outstanding: number;
};

export type OccupancyStats = {
  totalRooms: number;
  occupied: number;
  vacant: number;
  occupancyRate: number;
};

export type GuestStats = {
  totalGuests: number;
  arrivedToday: number;
  departingToday: number;
  inHouse: number;
};

export type AnalyticsReport = {
  timeframe: AnalyticsTimeframe;
  label: string;
  money: MoneyFlow;
  occupancy: OccupancyStats;
  guests: GuestStats;
  activeStaff: number;
  totalStaff: number;
  lateStaff: number;
  absentStaff: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function timeframeLabel(tf: AnalyticsTimeframe): string {
  switch (tf) {
    case "day": return "Today";
    case "week": return "This week";
    case "month": return "This month";
  }
}

export function todayDateInput(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

function weekBounds(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((day + 6) % 7)); // Monday
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  return { start: fmt(mon), end: fmt(sun) };
}

function monthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Filter expense rows by a date range (expense_date field).
 */
type ExpenseRow = {
  id: string;
  propertyId: string;
  category: string;
  title: string;
  description: string | null;
  amount: number;
  expenseDate: string | null;
  status: string;
  recordedBy: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * Portfolio-level expenses query. Fetches expenses across all managed properties
 * within the last 12 months, then filters client-side by timeframe.
 */
function usePortfolioExpenses(properties?: ManagedProperty[]) {
  const scope = useManageScope();
  const propertyIds = useMemo(() => (properties ?? []).map((p) => p.id).sort(), [properties]);

  // Compute a date 12 months ago for the query window
  const sinceDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }, []);

  return useQuery({
    queryKey: ["manage", "expenses", "portfolio", scope.key, propertyIds.join(",")],
    enabled: Boolean(scope.ready && properties && propertyIds.length > 0),
    queryFn: async (): Promise<ExpenseRow[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loose = supabase as unknown as { from: (t: string) => any };
      const { data, error } = await loose.from("property_expenses")
        .select("*")
        .in("property_id", propertyIds)
        .gte("expense_date", sinceDate)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: String(r.id ?? ""),
        propertyId: String(r.property_id ?? ""),
        category: String(r.category ?? "other"),
        title: String(r.title ?? "Expense"),
        description: r.description ? String(r.description) : null,
        amount: Number(r.amount ?? 0),
        expenseDate: r.expense_date ? String(r.expense_date).slice(0, 10) : null,
        status: String(r.status ?? "unpaid"),
        recordedBy: r.recorded_by ? String(r.recorded_by) : null,
        note: r.note ? String(r.note) : null,
        createdAt: String(r.created_at ?? ""),
      }));
    },
  });
}

/**
 * Main analytics hook. Returns a report for the given timeframe.
 */
export function useAnalytics(timeframe: AnalyticsTimeframe) {
  const properties = useOrgProperties();
  const ledger = usePortfolioRent(properties.data);
  const expenses = usePortfolioExpenses(properties.data);

  const hotelRooms = useMemo(
    () => (properties.data ?? []).filter((p) => p.type === "hotel"),
    [properties.data],
  );
  const roomIds = useMemo(() => hotelRooms.map((p) => p.id), [hotelRooms]);
  const bookings = useHotelBookings(roomIds);
  const staff = useHotelStaffList();

  const today = todayDateInput();

  const report = useMemo<AnalyticsReport | null>(() => {
    if (!properties.data || !ledger.data) return null;

    const props = properties.data;
    const rentRows = ledger.data;
    const expenseRows = expenses.data ?? [];

    // ── Money ───────────────────────────────────────────────────────────
    const summary = buildPortfolioSummary(props, rentRows);

    // Filter expenses by timeframe
    const filterDate = (date: string | null): boolean => {
      if (!date) return false;
      if (timeframe === "day") return date === today;
      if (timeframe === "week") {
        const { start, end } = weekBounds();
        return date >= start && date <= end;
      }
      return true; // month — our query already scoped to this month
    };

    const filteredExpenses = expenseRows.filter((e) => filterDate(e.expenseDate));
    const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);

    // For "day" and "week", money-in is today's/week's rent collections.
    // For "month", it's the portfolio summary's collectedThisMonth.
    let moneyIn = summary.collectedThisMonth;
    if (timeframe === "day" || timeframe === "week") {
      const { start, end } = timeframe === "day"
        ? { start: today, end: today }
        : weekBounds();
      const periodPaid = rentRows
        .filter((r) => r.paidAt && r.paidAt.slice(0, 10) >= start && r.paidAt.slice(0, 10) <= end)
        .reduce((s, r) => s + r.amountPaid, 0);
      moneyIn = periodPaid;
    }

    // ── Occupancy ───────────────────────────────────────────────────────
    const occupiedCount = props.filter((p) => p.occupancyStatus === "occupied").length;
    const totalRooms = props.length;

    // ── Guests (hotel only) ─────────────────────────────────────────────
    const bookingList = bookings.data ?? [];
    const arrivingOn = bookingList.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status) && b.checkIn === today);
    const departingOn = bookingList.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status) && b.checkOut === today);
    const inHouseOn = bookingList.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status) && staysOnDate(today, b));

    // ── Staff ───────────────────────────────────────────────────────────
    const allStaff = staff.data ?? [];
    const activeStaff = allStaff.filter((s) => s.active).length;

    // ── Label ───────────────────────────────────────────────────────────
    let label: string;
    if (timeframe === "day") {
      const d = new Date();
      label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    } else if (timeframe === "week") {
      const { start, end } = weekBounds();
      label = `${start} – ${end}`;
    } else {
      const d = new Date();
      label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    return {
      timeframe,
      label,
      money: {
        moneyIn,
        moneyOut: totalExpenses,
        net: moneyIn - totalExpenses,
        expectedIn: summary.expectedThisMonth,
        outstanding: summary.outstandingThisMonth + summary.arrears,
      },
      occupancy: {
        totalRooms,
        occupied: occupiedCount,
        vacant: totalRooms - occupiedCount,
        occupancyRate: totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0,
      },
      guests: {
        totalGuests: bookingList.length,
        arrivedToday: arrivingOn.length,
        departingToday: departingOn.length,
        inHouse: inHouseOn.length,
      },
      activeStaff,
      totalStaff: allStaff.length,
      lateStaff: 0,
      absentStaff: 0,
    };
  }, [properties.data, ledger.data, expenses.data, bookings.data, staff.data, timeframe, today]);

  const isPending = properties.isPending || ledger.isPending || expenses.isPending || staff.isPending;

  return {
    data: report,
    isPending,
    isError: properties.isError || ledger.isError,
    refetch: () => {
      properties.refetch();
      ledger.refetch();
      expenses.refetch();
      staff.refetch();
    },
  };
}

/**
 * Chart data helpers
 */

export type RevenueChartPoint = {
  label: string;
  revenue: number;
  expenses: number;
  net: number;
};

/**
 * Build 12 data points (one per month) for a revenue-over-time chart.
 */
export function useRevenueChartData() {
  const properties = useOrgProperties();
  const ledger = usePortfolioRent(properties.data);
  const expenses = usePortfolioExpenses(properties.data);

  return useMemo(() => {
    const rentRows = ledger.data ?? [];
    const expenseRows = expenses.data ?? [];
    const months: RevenueChartPoint[] = [];

    // Build the last 12 months
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const periodKey = `${y}-${m}-01`;
      const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });

      const revenue = rentRows
        .filter((r) => r.periodMonth === periodKey)
        .reduce((s, r) => s + r.amountPaid, 0);

      const expMonthStart = `${y}-${m}-01`;
      const expMonthEnd = `${y}-${m}-${String(new Date(y, d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
      const expPaid = expenseRows
        .filter((e) => e.expenseDate && e.expenseDate >= expMonthStart && e.expenseDate <= expMonthEnd)
        .reduce((s, e) => s + e.amount, 0);

      months.push({
        label,
        revenue,
        expenses: expPaid,
        net: revenue - expPaid,
      });
    }

    return months;
  }, [ledger.data, expenses.data]);
}

/**
 * Booking status breakdown for a pie/bar chart.
 */
export function useBookingStatusData() {
  const properties = useOrgProperties();
  const hotelRooms = useMemo(
    () => (properties.data ?? []).filter((p) => p.type === "hotel"),
    [properties.data],
  );
  const roomIds = useMemo(() => hotelRooms.map((p) => p.id), [hotelRooms]);
  const bookings = useHotelBookings(roomIds);

  return useMemo(() => {
    const list = bookings.data ?? [];
    const counts: Record<string, number> = {};
    for (const b of list) {
      counts[b.status] = (counts[b.status] ?? 0) + 1;
    }
    return Object.entries(counts).map(([status, count]) => ({
      status,
      count,
      fill: "var(--color-" + status + ")",
    }));
  }, [bookings.data]);
}

/**
 * Staff attendance breakdown for the analytics page.
 */
export type StaffAttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  total: number;
};

export function useAttendanceSummary(date: string) {
  const { isSignedIn } = useAppAuth();
  const staff = useHotelStaffList();

  return useQuery({
    queryKey: ["staff-attendance", "summary", date],
    enabled: Boolean(isSignedIn && date),
    queryFn: async (): Promise<StaffAttendanceSummary> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loose = supabase as unknown as { from: (t: string) => any };
      const { data, error } = await loose.from("staff_attendance")
        .select("status")
        .eq("date", date);
      if (error) throw error;

      const rows = (data ?? []) as { status: string }[];
      const present = rows.filter((r) => r.status === "present").length;
      const late = rows.filter((r) => r.status === "late").length;
      const absent = rows.filter((r) => r.status === "absent").length;
      const onLeave = rows.filter((r) => r.status === "on_leave").length;
      const total = staff.data?.filter((s) => s.active).length ?? 0;

      return { present, late, absent, onLeave, total };
    },
  });
}