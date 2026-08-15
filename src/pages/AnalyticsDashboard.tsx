import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Clock, BarChart3,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { formatMoney } from "@/hooks/use-rent";
import {
  useAnalytics,
  useRevenueChartData,
  useBookingStatusData,
  useAttendanceSummary,
  todayDateInput,
  type AnalyticsTimeframe,
} from "@/hooks/use-analytics";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// ── Booking status colours ──────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  requested: "#f59e0b",
  confirmed: "#3b82f6",
  checked_in: "#22c55e",
  checked_out: "#6b7280",
  cancelled: "#ef4444",
  no_show: "#f97316",
};

const BOOKING_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "No show",
};

// ── Chart config ────────────────────────────────────────────────────────────

const barChartConfig = {
  revenue: { label: "Revenue", color: "#22c55e" },
  expenses: { label: "Expenses", color: "#ef4444" },
};

// ── Timeframe tabs ──────────────────────────────────────────────────────────

const TIMEFRAMES: { key: AnalyticsTimeframe; label: string }[] = [
  { key: "day", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

// ── Money tile ──────────────────────────────────────────────────────────────

function MoneyTile({
  label, value, icon: Icon, colorClass,
}: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>; colorClass: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`rounded-full p-2 ${colorClass}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold tabular-nums truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Stat tile ───────────────────────────────────────────────────────────────

function StatTile({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-lg font-bold tabular-nums">{primary}</p>
        {secondary !== undefined && (
          <p className="text-xs text-muted-foreground mt-0.5">{secondary}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Skeleton tile ───────────────────────────────────────────────────────────

function SkeletonTile() {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-28" />
      </CardContent>
    </Card>
  );
}

function renderPieLabel(props: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (percent < 0.05) return null;
  const RAD = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RAD);
  const y = cy + radius * Math.sin(-midAngle * RAD);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-xs font-medium">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ── Page component ──────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>("month");
  const { data: report, isPending, isError } = useAnalytics(timeframe);
  const chartData = useRevenueChartData();
  const bookingStatusData = useBookingStatusData();
  const today = todayDateInput();
  const { data: attendance } = useAttendanceSummary(today);

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-5xl py-6 space-y-6">
        {/* Heading */}
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Analytics</h1>
        </div>

        {/* Timeframe selector */}
        <div className="flex gap-2">
          {TIMEFRAMES.map(({ key, label }) => (
            <Button
              key={key}
              variant={timeframe === key ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeframe(key)}
              className="rounded-full"
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Loading / Error / Content */}
        {isPending ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)}
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)}
            </div>
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Failed to load analytics data. Try refreshing.
            </CardContent>
          </Card>
        ) : report ? (
          <>
            {/* Report period label */}
            <p className="text-sm text-muted-foreground -mt-4">{report.label}</p>

            {/* Money flow */}
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Money flow</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MoneyTile label="Money in" value={formatMoney(report.money.moneyIn)} icon={TrendingUp} colorClass="bg-emerald-600" />
                <MoneyTile label="Money out" value={formatMoney(report.money.moneyOut)} icon={TrendingDown} colorClass="bg-red-600" />
                <MoneyTile label="Net" value={formatMoney(report.money.net)} icon={DollarSign} colorClass={report.money.net >= 0 ? "bg-blue-600" : "bg-red-600"} />
                <MoneyTile label="Outstanding" value={formatMoney(report.money.outstanding)} icon={Clock} colorClass="bg-amber-600" />
              </div>
            </section>

            {/* Revenue chart */}
            <section>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Revenue vs Expenses (12 months)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={barChartConfig} className="aspect-[16/6]">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v: number) => v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : String(v)} />
                      <ChartTooltip content={<ChartTooltipContent formatter={(value: number) => formatMoney(value)} />} />
                      <Legend />
                      <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </section>

            {/* Occupancy, Guests, Staff & Booking status */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Occupancy */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Occupancy</h2>
                <div className="space-y-3">
                  <StatTile label="Total rooms" primary={String(report.occupancy.totalRooms)} />
                  <StatTile label="Occupied" primary={String(report.occupancy.occupied)} />
                  <StatTile label="Vacant" primary={String(report.occupancy.vacant)} />
                  <StatTile label="Occupancy rate" primary={formatPercent(report.occupancy.occupancyRate)} />
                </div>
              </section>

              {/* Guests */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Guests</h2>
                <div className="space-y-3">
                  <StatTile label="Total bookings" primary={String(report.guests.totalGuests)} />
                  <StatTile label="Arrived today" primary={String(report.guests.arrivedToday)} />
                  <StatTile label="Departing today" primary={String(report.guests.departingToday)} />
                  <StatTile label="In house" primary={String(report.guests.inHouse)} />
                </div>
              </section>

              {/* Staff */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Staff</h2>
                <div className="space-y-3">
                  <StatTile label="Active staff" primary={String(report.activeStaff)} secondary={`of ${report.totalStaff} total`} />
                  <StatTile label="Present today" primary={String(attendance?.present ?? "—")} secondary={attendance ? `${formatPercent(Math.round((attendance.present / Math.max(attendance.total, 1)) * 100))} of active` : undefined} />
                  <StatTile label="Late" primary={String(attendance?.late ?? "—")} />
                  <StatTile label="Absent" primary={String(attendance?.absent ?? "—")} />
                </div>
              </section>

              {/* Booking status */}
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Booking status</h2>
                <Card>
                  <CardContent className="p-3">
                    {bookingStatusData.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No bookings yet</p>
                    ) : (
                      <div className="space-y-2">
                        {bookingStatusData.map((item) => (
                          <div key={item.status} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: STATUS_COLOURS[item.status] ?? "#6b7280" }} />
                              <span className="text-muted-foreground">{BOOKING_STATUS_LABEL[item.status] ?? item.status}</span>
                            </div>
                            <span className="font-medium tabular-nums">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
                {bookingStatusData.length > 0 && (
                  <div className="mt-3">
                    <ResponsiveContainer width="100%" height={140}>
                      <PieChart>
                        <Pie data={bookingStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={28} outerRadius={52} label={renderPieLabel} labelLine={false}>
                          {bookingStatusData.map((entry) => (
                            <Cell key={entry.status} fill={STATUS_COLOURS[entry.status] ?? "#6b7280"} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number, name: string) => [value, BOOKING_STATUS_LABEL[name] ?? name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
      <BottomNav />
    </div>
  );
}