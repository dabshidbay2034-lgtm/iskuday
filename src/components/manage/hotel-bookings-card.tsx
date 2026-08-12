import { useState } from "react";
import { BedDouble, Pencil, Phone, Plus } from "lucide-react";

import {
  formatDay,
  formatMoney,
  usePropertyAccess,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  useRoomBookings,
  useTransitionBooking,
  nightsBetween,
  BOOKING_STATUS_META,
  BOOKING_SOURCE_LABEL,
  type Booking,
  type BookingStatus,
} from "@/hooks/use-bookings";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BookingDialog } from "./booking-dialog";
import { CheckoutDialog } from "./checkout-dialog";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<BookingStatus, string> = {
  requested: "bg-secondary text-muted-foreground border-border",
  confirmed: "bg-info/10 text-info border-info/20",
  checked_in: "bg-success/10 text-success border-success/20",
  checked_out: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-secondary text-muted-foreground border-border line-through",
  no_show: "bg-warning/10 text-warning border-warning/20",
};

/**
 * Reservations for one hotel room. Shows the full history with the lifecycle
 * actions (confirm an online request, check a guest in/out, cancel). Only desk
 * staff manage; viewers read. Rendered only for nightly-rate hotel rooms.
 */
export function HotelBookingsCard({ property }: { property: ManagedProperty }) {
  const { canViewBookings: canView, canManageBookings: canManage } = usePropertyAccess(property);
  const { data, isPending, isError } = useRoomBookings(property.id);
  const transition = useTransitionBooking(property.id);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [checkingOut, setCheckingOut] = useState<Booking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  if (!canView || property.type !== "hotel") return null;

  const bookings = data ?? [];
  const upcoming = bookings
    .filter((b) => b.status === "requested" || b.status === "confirmed")
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <BedDouble className="w-4 h-4 text-muted-foreground shrink-0" />
              Bookings
            </CardTitle>
            <CardDescription className="text-xs">
              Reservations & future arrivals
              {upcoming.length > 0 && (
                <> · <span className="text-info">{upcoming.length} upcoming</span></>
              )}
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4" /> Book
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">Bookings couldn't be loaded.</p>
        ) : bookings.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <BedDouble className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No bookings yet</p>
            <p className="text-xs text-muted-foreground mb-3">
              {canManage
                ? "Create the first reservation for this room."
                : "Desk staff record reservations for this room."}
            </p>
            {canManage && (
              <Button
                variant="hero"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4" /> Create a booking
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {bookings.map((booking) => {
              const nights = nightsBetween(booking.checkIn, booking.checkOut);
              const active =
                booking.status === "confirmed" || booking.status === "checked_in";
              return (
                <li key={booking.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {booking.guestName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDay(booking.checkIn)} → {formatDay(booking.checkOut)} ·{" "}
                        {nights} night{nights === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px] font-normal shrink-0", STATUS_STYLES[booking.status])}
                    >
                      {BOOKING_STATUS_META[booking.status].label}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      {formatMoney(booking.totalAmount)}{" "}
                      <span className="text-muted-foreground/70">
                        (paid {formatMoney(booking.amountPaid)})
                      </span>
                    </span>
                    <span>· {BOOKING_SOURCE_LABEL[booking.source]}</span>
                    {booking.guestPhone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {booking.guestPhone}
                      </span>
                    )}
                  </div>

                  {canManage && active && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {booking.status === "requested" && (
                        <Button
                          size="sm"
                          variant="hero"
                          className="h-8 px-3 text-xs"
                          onClick={() =>
                            transition.mutate({ bookingId: booking.id, transition: { to: "confirmed" } })
                          }
                          disabled={transition.isPending}
                        >
                          Confirm
                        </Button>
                      )}
                      {booking.status === "confirmed" && (
                        <Button
                          size="sm"
                          variant="hero"
                          className="h-8 px-3 text-xs"
                          onClick={() =>
                            transition.mutate({ bookingId: booking.id, transition: { to: "checked_in" } })
                          }
                          disabled={transition.isPending}
                        >
                          Check in
                        </Button>
                      )}
                      {booking.status === "checked_in" && (
                        <Button
                          size="sm"
                          variant="hero"
                          className="h-8 px-3 text-xs"
                          onClick={() => setCheckingOut(booking)}
                          disabled={transition.isPending}
                        >
                          Check out
                        </Button>
                      )}
                      {(booking.status === "requested" || booking.status === "confirmed") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            setEditing(booking);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs text-destructive"
                        onClick={() => setCancelTarget(booking)}
                        disabled={transition.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {canManage && (
        <BookingDialog
          property={property}
          booking={editing}
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) setEditing(null);
          }}
        />
      )}

      {checkingOut && canManage && (
        <CheckoutDialog
          property={property}
          booking={checkingOut}
          open={!!checkingOut}
          onOpenChange={(o) => !o && setCheckingOut(null)}
        />
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{cancelTarget?.guestName}</span>'s stay for{" "}
              {cancelTarget ? `${formatDay(cancelTarget.checkIn)} → ${formatDay(cancelTarget.checkOut)}` : ""}{" "}
              will be cancelled and the room released.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                cancelTarget &&
                transition.mutate({ bookingId: cancelTarget.id, transition: { to: "cancelled" } })
              }
              disabled={transition.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {transition.isPending ? "Cancelling..." : "Cancel booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
