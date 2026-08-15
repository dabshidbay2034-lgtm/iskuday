import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isBookableType } from "@/lib/property-kind";

/**
 * When a nightly unit is taken — for the PUBLIC marketplace.
 *
 * A hotel room and a BnB never leave the listings (20260820000001): they are
 * always bookable for some future date. What changes is whether they are taken
 * RIGHT NOW, which is a question about confirmed bookings rather than about the
 * owner's occupancy flag.
 *
 * The data comes from `room_booked_ranges()`, a SECURITY DEFINER function that
 * returns date ranges and nothing else — `bookings` itself stays unreadable to
 * anonymous visitors because its rows carry guest names, phones and emails.
 */

/** One confirmed hold on a room. `checkOut` is EXCLUSIVE — the room is free that day. */
export type BookedRange = {
  roomId: string;
  /** ISO `YYYY-MM-DD`. */
  checkIn: string;
  /** ISO `YYYY-MM-DD`, exclusive. */
  checkOut: string;
};

type RawRange = { room_id: string; check_in: string; check_out: string };

/**
 * Today as `YYYY-MM-DD` in the VIEWER'S timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that is UTC, and Mogadishu is
 * UTC+3 — so for the first three hours of every local day it returns yesterday,
 * and a room that is free today would read as still booked. Every comparison
 * below is a plain string compare, which is exact for zero-padded ISO dates and
 * sidesteps Date parsing and DST entirely.
 */
export function todayIso(): string {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The date this room frees up, or `null` if it is free right now.
 *
 * `checkIn <= today < checkOut` — check-out day is the departure, so the room
 * is available again that morning and the guard must be strict on the upper
 * bound. Getting this wrong shows a room as booked for one extra day and makes
 * same-day turnaround look impossible.
 */
export function bookedUntil(ranges: BookedRange[], today = todayIso()): string | null {
  const current = ranges.find((r) => r.checkIn <= today && today < r.checkOut);
  return current ? current.checkOut : null;
}

/** The next hold that starts later than today, for "free now, booked from X". */
export function nextBookingFrom(ranges: BookedRange[], today = todayIso()): string | null {
  const upcoming = ranges
    .filter((r) => r.checkIn > today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  return upcoming.length > 0 ? upcoming[0].checkIn : null;
}

/** `2026-08-22` → `22 Aug`. Short on purpose: this sits inside a badge. */
export function formatBookedUntil(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // Constructed as local, not parsed from the string — `new Date("2026-08-22")`
  // is treated as UTC midnight and renders as the 21st west of Greenwich.
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export const roomAvailabilityKey = (ids: string[]) =>
  ["room-availability", [...ids].sort().join(",")] as const;

/**
 * Booked ranges for a set of rooms, grouped by room id.
 *
 * One RPC for the whole page rather than one per card — a listing grid renders
 * 20+ properties and a per-card query would be 20 round trips for a badge.
 * Non-bookable ids are filtered out before the call: asking for the booking
 * calendar of an apartment is always an empty answer.
 */
export function useRoomBookedRanges(
  properties: Array<{ id: string; type?: string | null }> | undefined,
) {
  const roomIds = (properties ?? [])
    .filter((p) => isBookableType(p.type))
    .map((p) => p.id);

  return useQuery({
    queryKey: roomAvailabilityKey(roomIds),
    // `enabled` rather than an early return: with no nightly units on the page
    // there is nothing to ask, and firing the RPC with an empty array would be
    // a round trip whose answer is knowably empty.
    enabled: roomIds.length > 0,
    // Availability changes when a desk confirms a booking, not second to
    // second. A minute keeps a busy listing page from re-querying on every
    // filter change while staying fresh enough to be trusted.
    staleTime: 60_000,
    // One retry, not the default three. The realistic failure is a 404 because
    // 20260820000001 has not been applied — retrying that four times per page
    // load just multiplies the noise, and this query is decoration: when it
    // fails the listings still render, only without the "Booked till" badge.
    retry: 1,
    queryFn: async (): Promise<Record<string, BookedRange[]>> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (supabase as any).rpc("room_booked_ranges", { p_room_ids: roomIds });
      const { data, error } = await rpc;
      if (error) throw error;

      const byRoom: Record<string, BookedRange[]> = {};
      for (const row of (data ?? []) as RawRange[]) {
        (byRoom[row.room_id] ??= []).push({
          roomId: row.room_id,
          checkIn: row.check_in,
          checkOut: row.check_out,
        });
      }
      return byRoom;
    },
  });
}
