import { useState } from "react";
import { CalendarCheck, Loader2, Send } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/hooks/use-rent";
import { nightsBetween, todayInput } from "@/hooks/use-bookings";

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
  const [confirmed, setConfirmed] = useState<{ total: number; nights: number } | null>(null);

  const nights = nightsBetween(checkIn, checkOut);
  const total = Math.max(0, nights) * nightlyRate;

  if (confirmed) {
    return (
      <div className="p-5 rounded-2xl bg-card border border-success/30 shadow-card space-y-3">
        <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
          <CalendarCheck className="w-5 h-5 text-success" />
        </div>
        <div>
          <h3 className="font-heading font-bold text-foreground">Request received</h3>
          <p className="text-sm text-muted-foreground">
            We've passed your dates to {roomTitle}. A member of the team will
            confirm by phone.
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
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setConfirmed(null)}
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
      const result = data as { total_amount: number; nights: number } | null;
      setConfirmed({ total: Number(result?.total_amount ?? 0), nights: Number(result?.nights ?? nights) });
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
                  const n = new Date(`${e.target.value}T00:00:00`);
                  n.setDate(n.getDate() + 1);
                  setCheckOut(n.toISOString().slice(0, 10));
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
                Phone
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
                Email
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
