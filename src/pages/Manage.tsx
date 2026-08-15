import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { BedDouble, Building2, ChevronRight, Globe, Home, Plus, Users, Wallet, BarChart3, Clock } from "lucide-react";

import { useAppAuth } from "@/hooks/use-auth";
import { useMyHotelIds } from "@/hooks/use-hotel-invites";
import { accountKind, canManageHotelPages } from "@/lib/account-type";
import { PERMISSIONS } from "@/lib/permissions";
import {
  buildPortfolioSummary,
  currentMonthByProperty,
  formatMoney,
  formatMonthLabel,
  currentMonthKey,
  placeholderRentRow,
  useManageScope,
  useOrgProperties,
  usePortfolioRent,
  type ManagedProperty,
  type OccupancyStatus,
  type RentLedgerRow,
} from "@/hooks/use-rent";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  OccupancyBadge,
  PortfolioSummaryTiles,
  PortfolioSummarySkeleton,
} from "@/components/manage/portfolio-summary";
import { RentStatusBadge } from "@/components/manage/rent-ledger-table";

type OccupancyFilter = "all" | OccupancyStatus;

/**
 * /manage — portfolio dashboard (docs/PLAN_PMS_SERVICES.md §6).
 *
 * Layout:
 *   - summary tiles (units, occupancy, this month's rent, arrears)
 *   - the portfolio with occupancy, rent and this month's status
 *   - occupancy filter, empty state when there are no units yet
 *
 * Serves both kinds of landlord (R1): an agency's staff see the agency's units
 * plus any they own personally, while a solo owner who never created an
 * organization sees their own. There is deliberately no "create an agency"
 * gate — most small landlords never will.
 *
 * Inside an agency, every staff role holds RENT_VIEW, so viewers and agents see
 * the same numbers; they just can't act on them. The financial controls live
 * one level down, on /manage/property/:id.
 *
 * PWA/mobile-first: tiles reflow 2→4 across the breakpoint and the table sits
 * in a horizontal scroll container.
 */
const Manage = () => {
  const { isLoaded, isSignedIn, can, platformRole } = useAppAuth();
  // A hotel calls its units rooms. Same portfolio, different vocabulary.
  const isHotelAccount = accountKind(platformRole) === "hotel";
  const scope = useManageScope();
  const properties = useOrgProperties();
  // The rent query is keyed on the portfolio's property ids, so it waits for the
  // properties to land rather than filtering on an org that may not exist.
  const rent = usePortfolioRent(properties.data);
  // Every hotel the user can REACH, which is not the same as every hotel they
  // own — a `hotel_members` invitee owns nothing at all.
  const hotelIds = useMyHotelIds();
  const [filter, setFilter] = useState<OccupancyFilter>("all");

  const rows = useMemo(() => properties.data ?? [], [properties.data]);
  /**
   * Hotel surfaces need BOTH conditions.
   *
   * The role check is the new rule: a letting agency has no front desk. The
   * rooms check is the old one, and it stays — an account that predates the
   * split may still hold hotel rooms, and hiding the desk from someone who is
   * actively letting rooms would be worse than the ambiguity being fixed. So a
   * hotel account with no rooms yet sees nothing, and neither does an agency.
   */
  const hasHotelRooms = useMemo(() => rows.some((p) => p.type === "hotel"), [rows]);
  const showHotelTools = hasHotelRooms && canManageHotelPages(platformRole);
  const ledger = useMemo(() => rent.data ?? [], [rent.data]);

  const summary = useMemo(() => buildPortfolioSummary(rows, ledger), [rows, ledger]);
  const thisMonthRows = useMemo(() => currentMonthByProperty(ledger), [ledger]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((p) => p.occupancyStatus === filter)),
    [rows, filter],
  );

  /**
   * The one hotel to send an invited team member to.
   *
   * Only meaningful when the portfolio is empty: someone who owns units belongs
   * on their portfolio even if they also sit on a hotel's team.
   */
  const soloHotelId = useMemo(() => {
    const ids = hotelIds.data ?? [];
    return ids.length === 1 ? ids[0] : null;
  }, [hotelIds.data]);

  // A signed-in user always has a scope — their agency's units, or their own —
  // so this terminates for solo owners too.
  const isPending =
    !isLoaded || !scope.ready || properties.isPending || rent.isPending ||
    // Wait on the hotel-id RPC ONLY when the portfolio came back empty. That is
    // the single case whose answer changes what we render, and making everyone
    // else wait for it would slow the common path down for nothing.
    (properties.data?.length === 0 && hotelIds.isPending);

  // Route guards signed-out visitors; don't flash a dashboard at them.
  if (isLoaded && !isSignedIn) return null;

  // Loading — skeletons until Clerk resolves and both queries land.
  if (isPending) {
    return (
      <ManageShell>
        <PortfolioSummarySkeleton />
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableBody>
                {[1, 2, 3].map((i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-3.5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </ManageShell>
    );
  }

  /**
   * An invited hotel team member has no properties of their own, so the empty
   * "Add a property" state is a dead end for them — the one thing they can
   * actually reach is the hotel they were invited to. Send them there.
   *
   * Exactly one hotel, deliberately: with several there is nothing to guess, and
   * /manage/hotels lists them. No loop is possible — if that hotel then fails to
   * load, EditHotel's not-found state points at /manage/hotels, never back here.
   */
  if (rows.length === 0 && soloHotelId) {
    return <Navigate to={`/manage/hotels/${soloHotelId}`} replace />;
  }

  // No "you need an agency" gate: a landlord who never created an organization
  // manages their own units here, and the queries are scoped to them (R1).
  return (
    <ManageShell>
            <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground">
            {scope.isSoloScope ? "My properties" : "Portfolio"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Occupancy, rent and bills for {formatMonthLabel(currentMonthKey())}.
          </p>
        </div>
        {showHotelTools && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/manage/hotels">
                        <Globe className="w-4 h-4" /> <span className="hidden sm:inline">Hotel pages</span>
                        <span className="sm:hidden">Pages</span>
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                                          <Link to="/manage/hotel">
                                            <BedDouble className="w-4 h-4" /> Hotel desk
                                          </Link>
                                        </Button>
                                        <Button variant="outline" size="sm" asChild>
                                          <Link to="/manage/staff">
                                            <Users className="w-4 h-4" /> Staff
                                          </Link>
                                        </Button>
                                        <Button variant="outline" size="sm" asChild>
                                          <Link to="/manage/payroll">
                                            <Wallet className="w-4 h-4" /> Payroll
                                          </Link>
                                        </Button>
                                        <Button variant="outline" size="sm" asChild>
                                          <Link to="/manage/attendance">
                                            <Clock className="w-4 h-4" /> Attendance
                                          </Link>
                                        </Button>
                                        <Button variant="outline" size="sm" asChild>
                                          <Link to="/manage/analytics">
                                            <BarChart3 className="w-4 h-4" /> Analytics
                                          </Link>
                                        </Button>
                                      </div>
                                    )}
      </div>

      <PortfolioSummaryTiles summary={summary} />

      {rows.length === 0 ? (
        <EmptyCard
          icon={Home}
          title={isHotelAccount ? "No rooms yet" : "No properties yet"}
          body={
            isHotelAccount
              ? "Add your first room and it will show up here with its bookings and housekeeping."
              : "List your first unit and it will show up here with its rent ledger and utility bills."
          }
          action={
            // A solo owner has no org role to check — listing their own unit is
            // exactly what this page exists for.
            scope.isSoloScope || can(PERMISSIONS.PROPERTY_EDIT) ? (
              <Button variant="hero" asChild>
                <Link to="/add-property">
                  <Plus className="w-4 h-4" /> {isHotelAccount ? "Add a room" : "Add a property"}
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading font-semibold text-foreground">
              {isHotelAccount ? "Rooms" : "Units"}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({visible.length} of {rows.length})
              </span>
            </h2>
            <Select value={filter} onValueChange={(v) => setFilter(v as OccupancyFilter)}>
              <SelectTrigger className="h-9 w-[150px] rounded-full" aria-label="Filter by occupancy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All units</SelectItem>
                <SelectItem value="occupied">Occupied</SelectItem>
                <SelectItem value="vacant">Vacant</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visible.length === 0 ? (
            <div className="text-center py-12 bg-card rounded-xl border border-border">
              <p className="text-sm text-muted-foreground">
                No {filter} {isHotelAccount ? "rooms" : "units"}. Change the filter to see the rest of your portfolio.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Property</TableHead>
                    <TableHead className="hidden md:table-cell">Location</TableHead>
                    <TableHead>Occupancy</TableHead>
                    <TableHead className="text-right">Monthly rent</TableHead>
                    <TableHead className="min-w-[150px]">This month</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((property) => (
                    <PortfolioRow
                      key={property.id}
                      property={property}
                      row={thisMonthRows.get(property.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {/* Only meaningful inside an agency — a solo owner has full control. */}
      {!scope.isSoloScope && !can(PERMISSIONS.RENT_MARK_PAID) && rows.length > 0 && (
        <Alert>
          <Building2 className="h-4 w-4" />
          <AlertTitle>Read-only on money</AlertTitle>
          <AlertDescription>
            You can follow rent and bills across the portfolio, but only agency
            admins and managers can record rent as received.
          </AlertDescription>
        </Alert>
      )}
    </ManageShell>
  );
};

/** Page chrome shared by every state of this route. */
function ManageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-5xl py-6 space-y-6">{children}</div>
      <BottomNav />
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-16 bg-card rounded-2xl border border-border">
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-7 h-7 text-primary" />
      </div>
      <h2 className="font-heading font-semibold text-foreground mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">{body}</p>
      {action}
    </div>
  );
}

/** One property row: identity, occupancy, rent and where this month stands. */
function PortfolioRow({
  property,
  row,
}: {
  property: ManagedProperty;
  row?: RentLedgerRow;
}) {
  // No ledger row yet for the current month — show what is owed rather than a
  // blank cell. The row itself is opened lazily on the property page.
  const month = row ?? placeholderRentRow(property, currentMonthKey());
  const href = `/manage/property/${property.id}`;

  return (
    <TableRow>
      <TableCell>
        <Link to={href} className="block min-w-0 group">
          <p className="font-medium text-sm text-foreground truncate group-hover:text-primary transition-colors">
            {property.title}
          </p>
          <p className="text-xs text-muted-foreground capitalize truncate md:hidden">
            {property.type} · {property.location}
          </p>
          <p className="text-xs text-muted-foreground capitalize hidden md:block">
            {property.type}
          </p>
        </Link>
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
        {property.location}
      </TableCell>
      <TableCell>
        <OccupancyBadge status={property.occupancyStatus} />
      </TableCell>
      <TableCell className="text-right text-sm text-foreground whitespace-nowrap">
        {formatMoney(property.monthlyRent)}
        {property.isDailyRate && (
          <span className="block text-[10px] text-muted-foreground">nightly rate</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <RentStatusBadge status={month.status} />
          <span className="text-xs text-muted-foreground">
            {formatMoney(month.amountPaid)} / {formatMoney(month.amountDue)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to={href} aria-label={`Manage ${property.title}`}>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export default Manage;
