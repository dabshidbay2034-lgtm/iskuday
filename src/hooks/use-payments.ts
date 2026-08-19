import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { GatewayKey, PaymentOption } from "@/lib/payments";

/**
 * Driving a mobile-money payment from the browser.
 *
 * ── WHY THIS TALKS TO AN EDGE FUNCTION AND NOT THE PROVIDER ─────────────────
 * The Sifalo API User and API Key cannot exist in this bundle. `create` posts a
 * booking id and a chosen option to `sifalo-payment/create`, which holds the
 * credentials, recomputes the amount from the booking row, and charges. Nothing
 * here says what anything costs — a number sent from a browser is a suggestion.
 *
 * ── WHY IT POLLS ────────────────────────────────────────────────────────────
 * A wallet payment is asynchronous and the confirmation arrives out of band: the
 * guest gets a push on their handset, approves it with a PIN, and Sifalo calls
 * our callback. The browser is not part of that conversation and gets no
 * response to await. So the page opens a payment, then asks `payment_status()`
 * — an RPC that returns one word and nothing else — until it stops saying
 * "pending".
 *
 * The interval is 3s and it gives up after 3 minutes. Both are chosen for the
 * network this runs on: a guest on a slow connection in Mogadishu approving a
 * USSD prompt routinely takes 30–60 seconds, and a page that gave up at 30s
 * would declare failure on payments that then succeed. Giving up is a DISPLAY
 * decision only — the callback still settles the payment server-side whenever
 * it lands, so a guest who closes the tab still gets their room.
 */

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded";

export type StartPaymentInput = {
  bookingId: string;
  option: Exclude<PaymentOption, "at_hotel">;
  gateway: GatewayKey;
  /** The msisdn the guest pays from. Empty for card. */
  account: string;
};

export type StartedPayment = {
  paymentId: string;
  amount: number;
  /** Card flows hand back somewhere to send the guest. Wallets do not. */
  redirectUrl: string | null;
};

/** Errors from the function come back as `{ error }`; anything else is a bug. */
function messageFrom(payload: unknown, fallback: string): string {
  const message = (payload as { error?: unknown } | null)?.error;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export function useStartPayment() {
  const [isStarting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (input: StartPaymentInput): Promise<StartedPayment | null> => {
    setStarting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("sifalo-payment/create", {
        body: {
          booking_id: input.bookingId,
          payment_option: input.option,
          gateway: input.gateway,
          account: input.account,
        },
      });

      // `functions.invoke` reports a non-2xx as an error but still carries the
      // body, which is where our own message lives. Prefer ours: "Online
      // payment is not switched on yet" is actionable, "Edge Function returned
      // a non-2xx status code" is not.
      if (fnError) {
        const body = (fnError as { context?: { body?: unknown } }).context?.body;
        setError(messageFrom(body ?? data, "The payment could not be started."));
        return null;
      }

      const payload = data as { payment_id?: string; amount?: number; redirect_url?: string | null };
      if (!payload?.payment_id) {
        setError(messageFrom(data, "The payment could not be started."));
        return null;
      }

      return {
        paymentId: payload.payment_id,
        amount: Number(payload.amount ?? 0),
        redirectUrl: payload.redirect_url ?? null,
      };
    } catch {
      setError("Couldn't reach the payment service. Check your connection and try again.");
      return null;
    } finally {
      setStarting(false);
    }
  };

  return { start, isStarting, error, clearError: () => setError(null) };
}

const POLL_MS = 3000;
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * Watch one payment until it settles.
 *
 * Returns `"pending"` while waiting and `timedOut` once we stop asking. The
 * caller should treat `timedOut` as "we don't know yet", never as failure —
 * see the note above about the callback settling regardless.
 */
export function usePaymentStatus(paymentId: string | null) {
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setStatus("pending");
      setTimedOut(false);
      startedAt.current = null;
      return;
    }

    startedAt.current = Date.now();
    setStatus("pending");
    setTimedOut(false);

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!alive) return;

      const { data, error } = await supabase.rpc(
        // Added by 20260905000001; not in the generated types.
        "payment_status" as never,
        { _payment_id: paymentId } as never,
      );

      if (!alive) return;

      // A transient error is not an outcome. Keep asking until the deadline
      // rather than reporting a failed payment because one request 502'd.
      if (!error && typeof data === "string" && data && data !== "pending") {
        setStatus(data as PaymentStatus);
        return;
      }

      if (startedAt.current && Date.now() - startedAt.current > GIVE_UP_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [paymentId]);

  return { status, timedOut, isSettled: status !== "pending" };
}

/**
 * What a room's hotel is willing to accept, for the public booking form.
 *
 * Goes through `hotel_rooms` because the guest is looking at a PROPERTY and the
 * payment terms belong to the HOTEL that owns it. A room that is not attached to
 * any hotel — a standalone nightly listing — has no hotel to ask, so it falls
 * back to "pay at the hotel", which is how every one of them worked before
 * online payment existed. Never fail the booking form over this: a guest who
 * cannot choose how to pay should still be able to request the room.
 */
export function useRoomPaymentTerms(roomId?: string) {
  const [terms, setTerms] = useState<{ options: string[]; depositPercent: number }>({
    options: ["at_hotel"],
    depositPercent: 25,
  });

  useEffect(() => {
    if (!roomId) return;
    let alive = true;

    (async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
          };
        };
      })
        .from("hotel_rooms")
        .select("hotels!hotel_id(payment_options, deposit_percent)")
        .eq("property_id", roomId)
        .maybeSingle();

      if (!alive || error) return;

      const hotel = (data as { hotels?: { payment_options?: string[]; deposit_percent?: number } } | null)
        ?.hotels;
      if (!hotel) return;

      setTerms({
        options: hotel.payment_options ?? ["at_hotel"],
        depositPercent: Number(hotel.deposit_percent ?? 25),
      });
    })();

    return () => {
      alive = false;
    };
  }, [roomId]);

  return terms;
}
