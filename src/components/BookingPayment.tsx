import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/hooks/use-rent";
import { GATEWAYS, looksLikeAccount, normaliseAccount, type GatewayKey, type PaymentOption } from "@/lib/payments";
import { usePaymentStatus, useStartPayment } from "@/hooks/use-payments";

/**
 * Paying for a booking that has already been created.
 *
 * ── WHY THE BOOKING EXISTS BEFORE THE MONEY ─────────────────────────────────
 * The room is held first, then paid for. Doing it the other way — take the
 * money, then try to create the booking — means a guest whose dates got taken
 * in the intervening seconds has paid for a room they cannot have, and getting
 * mobile money back out of EVC Plus is a phone call to Hormuud, not an API
 * call. This order can strand an unpaid booking, which a hotel can simply
 * cancel. The other order strands cash.
 *
 * ── WHY THE GUEST TYPES THEIR OWN NUMBER ────────────────────────────────────
 * Not pre-filled from the contact phone they entered above. People routinely
 * book on one number and pay from another — a spouse's wallet, a company line,
 * the one that actually has balance on it. Pre-filling looks helpful and
 * quietly charges the wrong account.
 */
export function BookingPayment({
  bookingId,
  option,
  amount,
  onPaid,
  onSkip,
}: {
  bookingId: string;
  option: Exclude<PaymentOption, "at_hotel">;
  /** What the server will charge. Display only — the edge function recomputes it. */
  amount: number;
  onPaid: () => void;
  /** Give up and settle at the hotel instead. The booking survives either way. */
  onSkip: () => void;
}) {
  const [gateway, setGateway] = useState<GatewayKey>("evcplus");
  const [account, setAccount] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { start, isStarting, error: startError, clearError } = useStartPayment();
  const { status, timedOut } = usePaymentStatus(paymentId);

  const meta = GATEWAYS.find((g) => g.key === gateway)!;
  const waiting = Boolean(paymentId) && status === "pending" && !timedOut;

  // In an effect, not during render: calling a parent's setState while
  // rendering a child is a React warning at best and a re-render loop at worst.
  useEffect(() => {
    if (status === "paid") onPaid();
  }, [status, onPaid]);

  const begin = async () => {
    setLocalError(null);
    clearError();
    if (meta.usesPhone && !looksLikeAccount(account)) {
      setLocalError(`Enter the ${meta.label} number you're paying from.`);
      return;
    }
    const started = await start({
      bookingId,
      option,
      gateway,
      account: meta.usesPhone ? normaliseAccount(account) : "",
    });
    if (!started) return;

    // Cards leave our page entirely; wallets stay here and wait for the push.
    if (started.redirectUrl) {
      window.location.href = started.redirectUrl;
      return;
    }
    setPaymentId(started.paymentId);
  };

  // ── Settled, badly ─────────────────────────────────────────────────────────
  if (status === "failed" || status === "cancelled") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 p-3">
          <XCircle className="w-4.5 h-4.5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Payment didn't go through</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Your room is still held. Try again, or pay at the hotel.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 rounded-xl"
            onClick={() => {
              setPaymentId(null);
              setLocalError(null);
            }}
          >
            Try again
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 rounded-xl" onClick={onSkip}>
            Pay at the hotel
          </Button>
        </div>
      </div>
    );
  }

  // ── Pushed, waiting on the handset ─────────────────────────────────────────
  if (waiting) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 p-3">
          <Loader2 className="w-4.5 h-4.5 text-primary shrink-0 mt-0.5 animate-spin" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Check your phone</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Approve the {formatMoney(amount)} {meta.label} request with your PIN. This page
              updates on its own.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── We stopped asking. NOT the same as failed. ─────────────────────────────
  if (timedOut) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-muted/60 p-3 text-sm">
          <p className="font-medium text-foreground">Still waiting</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            We haven't heard back yet. If you approved it, the hotel will see the payment —
            don't pay twice. Call them if you're unsure.
          </p>
        </div>
        <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={onSkip}>
          Done
        </Button>
      </div>
    );
  }

  // ── Choose a wallet and pay ────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">
          {option === "deposit" ? "Deposit due now" : "Total due now"}
        </span>
        <span className="font-heading font-bold text-foreground">{formatMoney(amount)}</span>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Pay with</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {GATEWAYS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGateway(g.key)}
              aria-pressed={gateway === g.key}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                gateway === g.key
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <span className="block text-sm font-medium text-foreground">{g.label}</span>
              <span className="block text-[10px] text-muted-foreground">{g.network}</span>
            </button>
          ))}
        </div>
      </div>

      {meta.usesPhone && (
        <div className="space-y-1.5">
          <Label htmlFor="pay-account" className="text-[11px] text-muted-foreground">
            {meta.label} number
          </Label>
          <div className="relative">
            <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="pay-account"
              type="tel"
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={meta.accountHint}
              maxLength={20}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            The number you're paying from — it doesn't have to be the one above.
          </p>
        </div>
      )}

      {(localError || startError) && (
        <p className="text-xs text-destructive" role="alert">
          {localError ?? startError}
        </p>
      )}

      <Button
        type="button"
        variant="hero"
        className="w-full"
        disabled={isStarting}
        onClick={begin}
      >
        {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {isStarting ? "Starting…" : `Pay ${formatMoney(amount)}`}
      </Button>

      <button
        type="button"
        onClick={onSkip}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        I'll pay at the hotel instead
      </button>
    </div>
  );
}

export default BookingPayment;
