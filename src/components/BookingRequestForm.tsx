import { useEffect, useState } from "react";
import { CalendarCheck, Loader2, Send } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/hooks/use-rent";
import { addDaysLocal, nightsBetween, todayInput } from "@/hooks/use-bookings";
import { useRoomPaymentTerms } from "@/hooks/use-payments";
import {
  PAYMENT_OPTION_META,
  amountDueLater,
  amountDueNow,
  clampPercent,
  offeredOptions,
  type PaymentOption,
} from "@/lib/payments";
import { BookingPayment } from "@/components/BookingPayment";

// `create_booking_request` arrives with migration 20260807000001 and isn't in
// the generated types until `supabase gen types` runs, so it's called through a
// loose client whose `.rpc` accepts any function name.
type LooseClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};
const looseRpc = supabase as unknown as LooseClient;

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Public booking request for a nightly-rate hotel room (20260807000001).
 *
 * Dates are nights-based: you pick a check-in and a check-out morning. On
 * submit this calls the SECURITY DEFINER RPC `create_booking_request`, which
 * validates the room, prevents double-booking server-side and returns the
 * computed total — the visitor never writes org_id or an amount. The request is
 * stored as "requested" and the hotel confirms it from their desk.
 */
export function BookingRequestForm({
  roomId, roomTitle, nightlyRate,
}: {
  roomId: string;
  roomTitle: string;
  nightlyRate: number;
}) {
  const [checkIn, setCheckIn] = useState(todayInput());
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    total: number;
    nights: number;
    bookingId: string | null;
  } | null>(null);
  /** Flips once the money has actually landed, so the copy stops promising a call. */
  const [paid, setPaid] = useState(false);

  // What this hotel accepts. Defaults to "pay at the hotel" for a room with no
  // hotel behind it, which is how every nightly listing worked before this.
  const terms = useRoomPaymentTerms(roomId);
  const options = offeredOptions(terms.options);
  const depositPercent = clampPercent(terms.depositPercent);
  const [payOption, setPayOption] = useState<PaymentOption>("at_hotel");

  // Keep the selection inside what the hotel offers. A hotel that turns off
  // online payment while somebody has the form open must not leave them on a
  // choice that the server will refuse.
  useEffect(() => {
    if (!options.includes(payOption)) setPayOption(options[0]);
  }, [options, payOption]);

  const nights = nightsBetween(checkIn, checkOut);
  const total = Math.max(0, nights) * nightlyRate;

  if (confirmed) {
    return (
      <div className="p-5 rounded-2xl bg-card border border-success/30 shadow-card space-y-3">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
          <CalendarCheck className="w-5 h-5 text-success" />
        </div>
        <div>
          <h3 className="font-heading font-bold text-foreground">
            {paid ? "Paid — you're booked" : "Request received"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {paid
              ? `${roomTitle} has your payment and your dates. Show this at reception.`
              : `We've passed your dates to ${roomTitle}. A member of the team will confirm by phone.`}
          </p>
        </div>
        <dl className="rounded-xl bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Estimated total</dt>
            <dd className="font-semibold text-foreground">{formatMoney(confirmed.total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Nights</dt>
            <dd className="text-foreground">{confirmed.nights}</dd>
          </div>
        </dl>
        {/* The room is held either way. Payment is the next step, not a
            condition of having booked — a guest whose EVC Plus push fails still
            has their dates, and the desk can take cash on arrival. */}
        {!paid && confirmed.bookingId && payOption !== "at_hotel" && (
          <div className="pt-1 border-t border-border/60">
            <BookingPayment
              bookingId={confirmed.bookingId}
              option={payOption}
              amount={amountDueNow(confirmed.total, payOption, depositPercent)}
              onPaid={() => setPaid(true)}
              onSkip={() => setPaid(false)}
            />
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            setConfirmed(null);
            setPaid(false);
          }}
        >
          Make another request
        </Button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!checkIn || !checkOut) {
      setError("Pick your dates.");
      return;
    }
    if (nights <= 0) {
      setError("Check-out must be after check-in.");
      return;
    }
    if (!name.trim()) {
      setError("Enter your name so the hotel can reach you.");
      return;
    }
    // At least one way to reach the guest.
    //
    // Both fields were optional, so a request could arrive carrying a name and
    // nothing else — while the confirmation screen promises "a member of the
    // team will confirm by phone". The desk then has a held room and no way to
    // contact whoever booked it. Either channel satisfies this; requiring both
    // would turn away guests who have one and not the other.
    if (!phone.trim() && !email.trim()) {
      setError("Add a phone number or an email so the hotel can confirm your booking.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: rpcError } = await looseRpc.rpc("create_booking_request", {
        p_room_id: roomId,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_adults: Number(adults) || 1,
        p_children: Number(children) || 0,
        p_guest_name: name,
        p_guest_phone: phone || null,
        p_guest_email: email || null,
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      const result = data as { id?: string; total_amount: number; nights: number } | null;
      setConfirmed({
        total: Number(result?.total_amount ?? 0),
        nights: Number(result?.nights ?? nights),
        // Needed to attach a payment. Absent only if the RPC predates the `id`
        // field, in which case the guest still has a booking and simply settles
        // at the desk — never block a confirmed room on a missing id.
        bookingId: typeof result?.id === "string" ? result.id : null,
      });
    } catch {
      setError(
        "Those dates are taken, or something went wrong. Pick different dates and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-5 rounded-2xl bg-card border border-border shadow-card space-y-4">
      <div>
        <h3 className="font-heading font-bold text-foreground">Request a stay</h3>
        <p className="text-xs text-muted-foreground">
          {formatMoney(nightlyRate)}/night · no payment now, confirm with the hotel.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="req-checkin" className="text-[11px] text-muted-foreground">
              Check-in
            </Label>
            <Input
              id="req-checkin"
              type="date"
              value={checkIn}
              onChange={(e) => {
                setCheckIn(e.target.value);
                if (!checkOut || e.target.value >= checkOut) {
                  setCheckOut(addDaysLocal(e.target.value, 1));
                }
              }}
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="req-checkout" className="text-[11px] text-muted-foreground">
              Check-out
            </Label>
            <Input
              id="req-checkout"
              type="date"
              value={checkOut}
              min={checkIn}
              onChange={(e) => setCheckOut(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="req-adults" className="text-[11px] text-muted-foreground">
              Adults
            </Label>
            <Input
              id="req-adults"
              type="number"
              min="1"
              value={adults}
              onChange={(e) => setAdults(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="req-children" className="text-[11px] text-muted-foreground">
              Children
            </Label>
            <Input
              id="req-children"
              type="number"
              min="0"
              value={children}
              onChange={(e) => setChildren(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="req-name" className="text-[11px] text-muted-foreground">
            Your name
          </Label>
          <Input
            id="req-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            maxLength={120}
            className="h-10 rounded-xl"
          />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="req-phone" className="text-[11px] text-muted-foreground">
                Phone <span className="text-foreground">*</span>
              </Label>
              <Input
                id="req-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+252…"
                maxLength={32}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="req-email" className="text-[11px] text-muted-foreground">
                Email <span className="text-foreground">*</span>
              </Label>
              <Input
                id="req-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                maxLength={160}
                className="h-10 rounded-xl"
              />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="req-notes" className="text-[11px] text-muted-foreground">
            Notes <span className="text-muted-foreground/70">(optional)</span>
          </Label>
          <Textarea
            id="req-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Arrival time, requests…"
            className="rounded-xl min-h-[48px]"
          />
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {/* Only rendered when there is a genuine choice. A hotel that takes
            cash only offers one route, and a radio group with one option is a
            control that asks a question with no alternative answer. */}
        {options.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">How would you like to pay?</Label>
            <div className="space-y-1.5">
              {options.map((option) => {
                const meta = PAYMENT_OPTION_META[option];
                const active = payOption === option;
                const dueNow = amountDueNow(total, option, depositPercent);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPayOption(option)}
                    aria-pressed={active}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {option === "deposit" ? `Pay ${depositPercent}% deposit` : meta.label}
                      </span>
                      {nights > 0 && meta.online && (
                        <span className="text-sm font-semibold text-foreground shrink-0">
                          {formatMoney(dueNow)}
                        </span>
                      )}
                    </div>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">
                      {option === "deposit" && nights > 0
                        ? `${formatMoney(amountDueLater(total, option, depositPercent))} on arrival.`
                        : meta.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {nights > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{nights} night{nights === 1 ? "" : "s"}</span>
            <span className="font-semibold text-foreground">{formatMoney(total)}</span>
          </div>
        )}

        <Button type="submit" variant="hero" className="w-full" disabled={loading}>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {loading ? "Sending…" : "Request booking"}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center">
          Requests are held until the hotel confirms. No payment is taken here.
        </p>
      </form>
    </div>
  );
}
