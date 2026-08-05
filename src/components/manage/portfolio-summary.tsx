import { Building2, Clock, TrendingDown, Wallet } from "lucide-react";

import { formatMoney, formatMonthLabel, currentMonthKey, type OccupancyStatus, type PortfolioSummary } from "@/hooks/use-rent";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Occupancy pill — shared by the portfolio table and the single-unit header, so
 * "occupied" looks the same everywhere on the manage surface.
 */
export function OccupancyBadge({ status }: { status: OccupancyStatus }) {
  const occupied = status === "occupied";
  return (
    <Badge
      variant="outline"
      className={
        occupied
          ? "bg-info/10 text-info border-info/20 text-[10px] rounded-full"
          : "bg-success/10 text-success border-success/20 text-[10px] rounded-full"
      }
    >
      {occupied ? "Occupied" : "Vacant"}
    </Badge>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];

  return (
    <div className="p-4 rounded-xl bg-card border border-border shadow-card">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </p>
      </div>
      <p className={`text-xl md:text-2xl font-heading font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

export function PortfolioSummarySkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="p-4 rounded-xl bg-card border border-border shadow-card space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * The four numbers an owner opens /manage to see: how many units they hold,
 * how much of this month's rent has landed, what's still outstanding this
 * month, and how much is owed from earlier months.
 */
export function PortfolioSummaryTiles({ summary }: { summary: PortfolioSummary }) {
  const month = formatMonthLabel(currentMonthKey());

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        icon={Building2}
        label="Units"
        value={String(summary.totalUnits)}
        hint={`${summary.occupied} occupied · ${summary.vacant} vacant`}
      />
      <Tile
        icon={Wallet}
        label="Collected"
        value={formatMoney(summary.collectedThisMonth)}
        hint={month}
        tone={summary.collectedThisMonth > 0 ? "success" : "default"}
      />
      <Tile
        icon={Clock}
        label="Outstanding"
        value={formatMoney(summary.outstandingThisMonth)}
        hint={`of ${formatMoney(summary.expectedThisMonth)} expected`}
        tone={summary.outstandingThisMonth > 0 ? "warning" : "default"}
      />
      <Tile
        icon={TrendingDown}
        label="Arrears"
        value={formatMoney(summary.arrears)}
        hint="Unpaid from earlier months"
        tone={summary.arrears > 0 ? "destructive" : "default"}
      />
    </div>
  );
}
