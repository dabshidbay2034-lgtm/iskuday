import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { looseFrom } from "@/lib/supabase-loose";
import {
  describeWriteError,
  formatMoney,
} from "@/hooks/use-rent";

/**
 * Hotel booking data layer (migration 20260807000001).
 *
 * A hotel's rooms ARE `properties` rows (`type = 'hotel'`, `is_daily_rate`), so
 * every booking keys off the same `room_id` (= `property_id`) the rest of the
 * PMS uses. Dates are NIGHT-BASED: `checkOut` is the morning the room is
 * released, so a stay contributes to the occupied range `[checkIn, checkOut)`.
 *
 * The `bookings` table is added by 20260807000001 and isn't in the generated
 * Supabase types until `supabase gen types` runs, so the reads/writes go through
 * a loose accessor (same approach as use-maintenance.ts etc.).
 *
 * Writes are gated on `canManageBookings` at the call site; the database enforces
 * it for real, including the server-side double-booking EXCLUDE constraint.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export type BookingStatus =
  | "requested"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export type BookingSource = "online" | "walk_in" | "phone" | "agent" | "admin";

export type Booking = {
  id: string;
  roomId: string;
  orgId: string | null;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  ratePerNight: number;
  totalAmount: number;
  amountPaid: number;
  status: BookingStatus;
  source: BookingSource;
  notes: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type RawBooking = {
  id: string;
  room_id: string;
  org_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  guest_email: string | null;
  check_in: string;
  check_out: string;
  adults: number | null;
  children: number | null;
  rate_per_night: number | null;
  total_amount: number | null;
  amount_paid: number | null;
  status: BookingStatus | null;
  source: BookingSource | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toBooking(row: RawBooking): Booking {
  return {
    id: row.id,
    roomId: row.room_id,
    orgId: row.org_id ?? null,
    guestName: row.guest_name ?? "",
    guestPhone: row.guest_phone ?? null,
    guestEmail: row.guest_email ?? null,
    checkIn: String(row.check_in).slice(0, 10),
    checkOut: String(row.check_out).slice(0, 10),
    adults: Number(row.adults ?? 1),
    children: Number(row.children ?? 0),
    ratePerNight: Number(row.rate_per_night ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    amountPaid: Number(row.amount_paid ?? 0),
    status: row.status ?? "requested",
    source: row.source ?? "walk_in",
    notes: row.notes ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// ── Status presentation ──────────────────────────────────────────────────────

/** Statuses that hold the room, so they participate in the overlap guard. */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "requested",
  "confirmed",
  "checked_in",
];

export const BOOKING_STATUS_META: Record<
  BookingStatus,
  { label: string; tone: "default" | "secondary" | "info" | "success" | "destructive" | "warning" }
> = {
  requested: { label: "Requested", tone: "secondary" },
  confirmed: { label: "Confirmed", tone: "info" },
  checked_in: { label: "Checked in", tone: "success" },
  checked_out: { label: "Checked out", tone: "default" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  no_show: { label: "No show", tone: "warning" },
};

export const BOOKING_SOURCE_LABEL: Record<BookingSource, string> = {
  online: "Online",
  walk_in: "Walk-in",
  phone: "Phone",
  agent: "Agent",
  admin: "Admin",
};

// ── Date math (night-based) ──────────────────────────────────────────────────

/** Whole nights between two `YYYY-MM-DD` strings. Negative if inverted. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const [iy, im, id] = checkIn.split("-").map(Number);
  const [oy, om, od] = checkOut.split("-").map(Number);
  const a = new Date(iy, im - 1, id).getTime();
  const b = new Date(oy, om - 1, od).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Does a stay occupy the room on `date`? The check-out morning is free. */
export function staysOnDate(date: string, booking: Pick<Booking, "checkIn" | "checkOut">): boolean {
  return date >= booking.checkIn && date < booking.checkOut;
}

/** Number of nights of `stay` that fall inside [from, to), both inclusive-ish. */
export function overlapNights(
  stay: Pick<Booking, "checkIn" | "checkOut">,
  from: string,
  to: string,
): number {
  const start = stay.checkIn > from ? stay.checkIn : from;
  const end = stay.checkOut < to ? stay.checkOut : to;
  return Math.max(0, nightsBetween(start, end));
}

export function totalFor(ratePerNight: number, checkIn: string, checkOut: string): number {
  return Math.max(0, nightsBetween(checkIn, checkOut)) * (ratePerNight || 0);
}

/** `YYYY-MM-DD` for today, local time — the default date for inputs. */
export function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Shift a `YYYY-MM-DD` date string by whole days, staying in LOCAL time.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Both booking forms auto-filled check-out as "check-in + 1 day" by doing
 *
 *     const n = new Date(`${value}T00:00:00`);   // local midnight
 *     n.setDate(n.getDate() + 1);                // local midnight, next day
 *     n.toISOString().slice(0, 10);              // ← converts to UTC
 *
 * `toISOString()` renders in UTC. Mogadishu is UTC+3, so local midnight on the
 * 23rd is 21:00 UTC on the 22nd, and slicing the date part gave back the 22nd —
 * the SAME DAY as check-in. `nightsBetween` then returned 0 and the form
 * refused to submit with "Check-out must be after check-in", blaming the guest
 * for a value the app had just filled in for them.
 *
 * Formatting the local fields by hand never round-trips through UTC, so this is
 * correct at every offset. Same reasoning as `todayInput` above and
 * `todayIso()` in use-room-availability.ts — this is the third place that trap
 * appeared, which is why it is now one exported helper instead of three
 * open-coded copies.
 */
export function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const shifted = new Date(y, m - 1, d + days);
  const month = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${shifted.getFullYear()}-${month}-${day}`;
}

// ── Loose accessor (bookings table is post-generated-types) ─────────────────

export const looseFromBookings = (table: string) => looseFrom(table);

// ── Keys ─────────────────────────────────────────────────────────────────────

export const roomBookingsKey = (propertyId?: string) => ["bookings", "room", propertyId] as const;
export const hotelBookingsKey = (roomIds: readonly string[]) => ["bookings", "hotel", roomIds.join(",")] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

/** All bookings for one room, ends-first for display. */
export function useRoomBookings(propertyId?: string) {
  return useQuery({
    queryKey: roomBookingsKey(propertyId),
    enabled: Boolean(propertyId),
    queryFn: async (): Promise<Booking[]> => {
      const { data, error } = await looseFromBookings("bookings")
        .select("*")
        .eq("room_id", propertyId)
        .order("check_in", { ascending: false });
      if (error) throw error;
      return ((data as RawBooking[]) ?? []).map(toBooking);
    },
  });
}

/**
 * Bookings across many rooms (the hotel dashboard). Room ids come from
 * `useOrgProperties()` filtered to hotel type, so the query waits for them.
 */
export function useHotelBookings(roomIds: readonly string[]) {
  return useQuery({
    queryKey: hotelBookingsKey(roomIds),
    enabled: roomIds.length > 0,
    queryFn: async (): Promise<Booking[]> => {
      const { data, error } = await looseFromBookings("bookings")
        .select("*")
        .in("room_id", roomIds as string[])
        .order("check_in", { ascending: true });
      if (error) throw error;
      return ((data as RawBooking[]) ?? []).map(toBooking);
    },
  });
}

/**
 * Live overlap check for the booking form. Returns the rooms/stays that would
 * clash, or [] when the range is free. Excludes `excludeId` (used when editing
 * an existing booking so its own stay isn't flagged).
 */
export async function checkAvailability(
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeId?: string,
): Promise<Booking[]> {
  const { data, error } = await looseFromBookings("bookings")
    .select("*")
    .eq("room_id", roomId)
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  if (error) throw error;
  const candidates = ((data as RawBooking[]) ?? []).map(toBooking);
  return candidates.filter(
    (b) =>
      b.id !== excludeId &&
      ACTIVE_BOOKING_STATUSES.includes(b.status) &&
      nightsBetween(b.checkIn, b.checkOut) > 0,
  );
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface BookingFormInput {
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  ratePerNight: number;
  status: BookingStatus;
  source: BookingSource;
  notes?: string;
}

/** Create (walk-in) or update a booking. `id` omitted to create. */
export function useSaveBooking(roomId?: string) {
  const queryClient = useQueryClient();
  const { orgId, userId } = useAppAuth();

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: roomBookingsKey(roomId) });
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["bookings", "room", id] });
  };

  return useMutation({
    mutationFn: async (input: BookingFormInput & { id?: string }): Promise<Booking> => {
      if (!roomId) throw new Error("No room selected.");

      const nights = nightsBetween(input.checkIn, input.checkOut);
      if (nights <= 0) throw new Error("Check-out must be after check-in.");
      if (!input.guestName.trim()) throw new Error("Enter the guest's name.");

      // Server-enforced anyway, but fail fast with a friendly message.
      const clashes = await checkAvailability(roomId, input.checkIn, input.checkOut, input.id);
      if (clashes.length > 0) {
        const who = clashes[0]?.guestName ?? "another reservation";
        throw new Error(
          `Those dates overlap a stay by ${who} (${clashes[0]?.checkIn} → ${clashes[0]?.checkOut}).`,
        );
      }

      const total = totalFor(input.ratePerNight, input.checkIn, input.checkOut);
      const payload = {
        room_id: roomId,
        org_id: orgId ?? null,
        guest_name: input.guestName.trim(),
        guest_phone: input.guestPhone?.trim() || null,
        guest_email: input.guestEmail?.trim() || null,
        check_in: input.checkIn,
        check_out: input.checkOut,
        adults: input.adults || 1,
        children: input.children || 0,
        rate_per_night: input.ratePerNight || 0,
        total_amount: total,
        status: input.status,
        source: input.source,
        notes: input.notes?.trim() || null,
      };

      const { data, error } = input.id
        ? await looseFromBookings("bookings")
            .update(payload)
            .eq("id", input.id)
            .select("*")
            .single()
        : await looseFromBookings("bookings")
            .insert({ ...payload, created_by: userId })
            .select("*")
            .single();

      if (error) throw error;
      const saved = toBooking(data as RawBooking);
      return saved;
    },
    onSuccess: (saved, input) => {
      invalidate();
      toast.success(input.id ? "Booking updated" : `Booking for ${saved.guestName}`);
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't save the booking")),
  });
}

export type BookingTransition =
  | { to: "confirmed" }
  | { to: "checked_in" }
  | { to: "checked_out"; amountPaid?: number }
  | { to: "cancelled" }
  | { to: "no_show" };

/** Advance/cancel a booking's lifecycle (confirm, check-in, check-out, cancel). */
export function useTransitionBooking(roomId?: string) {
  const queryClient = useQueryClient();
  const { userId } = useAppAuth();

  return useMutation({
    mutationFn: async (args: { bookingId: string; transition: BookingTransition }) => {
      const { bookingId, transition } = args;

      const patch: Record<string, unknown> = { status: transition.to };
      if (transition.to === "checked_out" && transition.amountPaid !== undefined) {
        patch.amount_paid = transition.amountPaid;
      }

      const { data, error } = await looseFromBookings("bookings")
        .update(patch)
        .eq("id", bookingId)
        .select("*")
        .single();

      if (error) throw error;
      const booking = toBooking(data as RawBooking);

      // A checked-out room needs a turnaround task next — create a pending
      // "clean" housekeeping task so the desk never forgets to flip it.
      if (transition.to === "checked_out" && roomId) {
        await looseFromBookings("housekeeping_tasks").insert({
          room_id: roomId,
          org_id: booking.orgId,
          task_type: "clean",
          status: "pending",
          created_by: userId,
          notes: `Turnaround after ${booking.guestName}`,
        });
      }
      return booking;
    },
    onSuccess: (booking, args) => {
      queryClient.invalidateQueries({ queryKey: roomBookingsKey(roomId) });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      queryClient.invalidateQueries({ queryKey: ["housekeeping"] });
      toast.success(
        args.transition.to === "checked_out"
          ? `${booking.guestName} checked out`
          : `${booking.guestName} → ${BOOKING_STATUS_META[booking.status].label}`,
      );
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't update the booking")),
  });
}

/** Hard-delete (used to discard a mistaken/cancelled reservation log). */
export function useDeleteBooking(roomId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { error } = await looseFromBookings("bookings").delete().eq("id", bookingId);
      if (error) throw error;
      return bookingId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roomBookingsKey(roomId) });
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      toast.success("Booking removed");
    },
    onError: (err: unknown) =>
      toast.error(describeWriteError(err, "Couldn't remove the booking")),
  });
}

// ── Derived helpers ──────────────────────────────────────────────────────────

/** Show one guest-facing line: name · nights · nights×rate. */
export function bookingGuestSummary(booking: Booking): string {
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const unit = booking.source === "online" ? "request" : "stay";
  return `${booking.guestName} · ${nights} night${nights === 1 ? "" : "s"} · ${formatMoney(
    booking.totalAmount,
  )}`;
}

/** Occupied room ids on a given date from a set of bookings. */
export function occupiedRoomIdsOn(
  date: string,
  bookings: Booking[],
): Set<string> {
  return new Set(
    bookings
      .filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status) && staysOnDate(date, b))
      .map((b) => b.roomId),
  );
}

/** Use the bookings list locally instead of yet another hook for one screen. */
export function useBookingDerived(bookings: Booking[] | undefined, date: string) {
  return useMemo(() => {
    const list = bookings ?? [];
    const active = list.filter((b) => ACTIVE_BOOKING_STATUSES.includes(b.status));
    return {
      arrivingOn: active.filter((b) => b.checkIn === date),
      departingOn: active.filter((b) => b.checkOut === date),
      inHouseOn: active.filter((b) => staysOnDate(date, b)),
      occupiedRoomIds: occupiedRoomIdsOn(date, active),
    };
  }, [bookings, date]);
}
