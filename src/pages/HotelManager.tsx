import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, BedDouble, CalendarDays, ChevronRight, ConciergeBell,
  DoorOpen, Globe, LogOut, Plus, Sparkles, User, Users, Wallet,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  formatDay,
  formatMoney,
  useOrgProperties,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  useHotelBookings,
  useBookingDerived,
  useTransitionBooking,
  useDeleteBooking,
  nightsBetween,
  BOOKING_STATUS_META,
  todayInput,
  type Booking,
  type BookingStatus,
} from "@/hooks/use-bookings";
import { useHousekeeping, TASK_TYPE_LABEL } from "@/hooks/use-housekeeping";
import { BookingDialog } from "@/components/manage/booking-dialog";
import { cn } from "@/lib/utils";

// todayInput is re-exported below from use-bookings; keep the import tidy.

const STATUS_STYLES: Record<BookingStatus, string> = {
  requested: "bg-secondary text-muted-foreground border-border",
  confirmed: "bg-info/10 text-info border-info/20",
  checked_in: "bg-success/10 text-success border-success/20",
  checked_out: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-secondary text-muted-foreground border-border line-through",
  no_show: "bg-warning/10 text-warning border-warning/20",
};

/**
 * /manage/hotel — the front-desk "hotel board" (migration 20260807000001).
 *
 * Aggregates every nightly-rate room the user manages (agency units + their own
 * + assigned) into one pulse screen: today's arrivals/departures/in-house,
 * occupancy, a room grid, an open housekeeping queue and the live booking roll.
 * Finer actions (check-out, edits) live on each room page; here we add bookings
 * and manage the day.
 */
const HotelManager = () => {
  const properties = useOrgProperties();

  const hotelRooms = useMemo(
    () => (properties.data ?? []).filter((p) => p.type === "hotel"),
    [properties.data],
  );
  const roomIds = useMemo(() => hotelRooms.map((p) => p.id), [hotelRooms]);

  const bookings = useHotelBookings(roomIds);
  const housekeeping = useHousekeeping(roomIds);

  const today = todayInput();
  const derived = useBookingDerived(bookings.data, today);

  const transition = useTransitionBooking();
  const deleteBooking = useDeleteBooking();

  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | BookingStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const roomById = useMemo(
    () => new Map(hotelRooms.map((r) => [r.id, r])),
    [hotelRooms],
  );
  // A displayed room for the dialog. Default to the first hotel room.
  const dialogRoom: ManagedProperty | null = useMemo(() => {
    const id =
      selectedRoomId && roomById.has(selectedRoomId)
        ? selectedRoomId
        : hotelRooms[0]?.id;
    return id ? (roomById.get(id) ?? null) : null;
  }, [selectedRoomId, roomById, hotelRooms]);

  const openTasks = useMemo(
    () =>
      (housekeeping.data ?? []).filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      ),
    [housekeeping.data],
  );

  const visibleBookings = useMemo(() => {
    const all = bookings.data ?? [];
    return statusFilter === "all"
      ? all
      : all.filter((b) => b.status === statusFilter);
  }, [bookings.data, statusFilter]);

  const isPending = properties.isPending || bookings.isPending;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />
      <div className="container max-w-5xl py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground">
              Hotel desk
            </h1>
            <p className="text-sm text-muted-foreground">
              Bookings, housekeeping and occupancy for {formatDay(new Date().toISOString())}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link to="/manage/hotels">
                <Globe className="w-4 h-4" /> Hotel pages
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
            <Button variant="ghost" size="sm" asChild>
              <Link to="/manage">
                <ArrowLeft className="w-4 h-4" /> Portfolio
              </Link>
            </Button>
          </div>
        </div>

        {isPending ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : hotelRooms.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-border">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <BedDouble className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">
              No hotel rooms yet
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Rooms on the bookable board are nightly-rate units of type "Hotel".
              List one and it will appear here with bookings and housekeeping.
            </p>
            <Button variant="hero" asChild>
              <Link to="/add-property">
                <Plus className="w-4 h-4" /> Add a hotel room
              </Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Today's board */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <BoardTile
                icon={User}
                label="Arriving today"
                value={derived.arrivingOn.length}
                tone="info"
              />
              <BoardTile
                icon={LogOut}
                label="Departing today"
                value={derived.departingOn.length}
                tone="warning"
              />
              <BoardTile
                icon={DoorOpen}
                label="In-house"
                value={derived.inHouseOn.length}
                tone="success"
              />
              <BoardTile
                icon={CalendarDays}
                label="Occupancy"
                value={hotelRooms.length ? `${derived.occupiedRoomIds.size}/${hotelRooms.length}` : "0"}
                tone="default"
              />
            </div>

            {/* Room grid */}
            <section className="space-y-3">
              <h2 className="font-heading font-semibold text-foreground">Rooms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {hotelRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    isOccupied={derived.occupiedRoomIds.has(room.id)}
                    activeBooking={
                      derived.inHouseOn.find((b) => b.roomId === room.id) ??
                      derived.arrivingOn.find((b) => b.roomId === room.id) ??
                      derived.departingOn.find((b) => b.roomId === room.id)
                    }
                  />
                ))}
              </div>
            </section>

            {/* Desk actions */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-heading font-semibold text-foreground">
                  Reservations{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({visibleBookings.length})
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => setStatusFilter(v as "all" | BookingStatus)}
                  >
                    <SelectTrigger className="h-9 w-[140px] rounded-full text-xs" aria-label="Filter status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {(Object.keys(BOOKING_STATUS_META) as BookingStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {BOOKING_STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={dialogRoom?.id ?? ""}
                    onValueChange={setSelectedRoomId}
                  >
                    <SelectTrigger className="h-9 w-[150px] rounded-full text-xs" aria-label="Pick a room to book">
                      <SelectValue placeholder="Room" />
                    </SelectTrigger>
                    <SelectContent>
                      {hotelRooms.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="hero"
                    size="sm"
                    className="shrink-0"
                    disabled={!dialogRoom}
                    onClick={() => setDialogOpen(true)}
                  >
                    <Plus className="w-4 h-4" /> Book
                  </Button>
                </div>
              </div>

              {visibleBookings.length === 0 ? (
                <div className="text-center py-10 bg-card rounded-xl border border-dashed border-border">
                  <ConciergeBell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {statusFilter === "all"
                      ? "No reservations yet."
                      : `No ${BOOKING_STATUS_META[statusFilter].label.toLowerCase()} bookings.`}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2">Guest</th>
                        <th className="px-3 py-2">Room</th>
                        <th className="px-3 py-2">Dates</th>
                        <th className="px-3 py-2">Nights</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleBookings.map((b) => (
                        <BookingRow
                          key={b.id}
                          booking={b}
                          roomTitle={roomById.get(b.roomId)?.title ?? "Room"}
                          onCancel={() => transition.mutate({ bookingId: b.id, transition: { to: "cancelled" } })}
                          onDelete={() => deleteBooking.mutate(b.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Open housekeeping queue */}
            {openTasks.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-heading font-semibold text-foreground">
                  Housekeeping queue{" "}
                  <span className="text-warning text-xs font-normal">({openTasks.length})</span>
                </h2>
                <Card>
                  <CardContent className="p-3 space-y-1.5">
                    {openTasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border p-2.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm text-foreground font-medium capitalize">
                              {TASK_TYPE_LABEL[t.taskType]} ·{" "}
                              <span className="text-muted-foreground">
                                {roomById.get(t.roomId)?.title ?? "Room"}
                              </span>
                            </p>
                            {t.scheduledAt && (
                              <p className="text-[11px] text-muted-foreground">
                                for {formatDay(t.scheduledAt)}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full text-[10px] font-normal shrink-0",
                            t.status === "in_progress"
                              ? "bg-info/10 text-info border-info/20"
                              : "bg-secondary text-muted-foreground border-border",
                          )}
                        >
                          {t.status === "in_progress" ? "In progress" : "Pending"}
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}
          </>
        )}

        {dialogRoom && (
          <BookingDialog
            property={dialogRoom}
            booking={null}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
          />
        )}
      </div>
      <BottomNav />
    </div>
  );
};

function BoardTile({
  icon: Icon, label, value, tone,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  tone: "info" | "warning" | "success" | "default";
}) {
  const tones: Record<string, string> = {
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    default: "bg-primary/10 text-primary",
  };
  return (
    <div className="bg-card rounded-2xl border border-border p-4">
      <div className={`w-9 h-9 rounded-xl ${tones[tone]} flex items-center justify-center mb-2`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-2xl font-heading font-bold text-foreground leading-none">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function RoomCard({
  room, isOccupied, activeBooking,
}: {
  room: ManagedProperty;
  isOccupied: boolean;
  activeBooking?: Booking;
}) {
  return (
    <Link
      to={`/manage/property/${room.id}`}
      className="block bg-card rounded-2xl border border-border p-4 hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm text-foreground truncate">{room.title}</p>
          <p className="text-[11px] text-muted-foreground truncate">{room.location}</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "rounded-full text-[10px] font-normal shrink-0",
            isOccupied
              ? "bg-success/10 text-success border-success/20"
              : "bg-muted text-muted-foreground border-border",
          )}
        >
          {isOccupied ? "In-house" : "Free"}
        </Badge>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{formatMoney(room.monthlyRent)}/night</span>
        {activeBooking ? (
          <span className="text-muted-foreground truncate ml-2">
            {activeBooking.guestName} · {nightsBetween(activeBooking.checkIn, activeBooking.checkOut)}n
          </span>
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
    </Link>
  );
}

function BookingRow({
  booking, roomTitle, onCancel, onDelete,
}: {
  booking: Booking;
  roomTitle: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const isActive = booking.status === "requested" || booking.status === "confirmed" || booking.status === "checked_in";
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2.5">
        <p className="font-medium text-foreground">{booking.guestName}</p>
        {booking.guestPhone && (
          <p className="text-[11px] text-muted-foreground">{booking.guestPhone}</p>
        )}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{roomTitle}</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
        {formatDay(booking.checkIn)} → {formatDay(booking.checkOut)}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">{nights}</td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatMoney(booking.totalAmount)}</td>
      <td className="px-3 py-2.5">
        <Badge
          variant="outline"
          className={cn("rounded-full text-[10px] font-normal", STATUS_STYLES[booking.status])}
        >
          {BOOKING_STATUS_META[booking.status].label}
        </Badge>
      </td>
      <td className="px-3 py-2.5 text-right">
        {isActive ? (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" onClick={onDelete}>
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}

export default HotelManager;
