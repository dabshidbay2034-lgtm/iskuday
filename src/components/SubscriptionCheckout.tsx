import { useState } from "react";
import { CheckCircle2, Loader2, Smartphone, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GATEWAYS, looksLikeAccount, normaliseAccount, type GatewayKey } from "@/lib/payments";
import { formatPlanPrice, planById, type PlanId } from "@/lib/plans";
import { usePaymentStatus, useStartPayment } from "@/hooks/use-payments";

/**
 * Paying for a plan with mobile money.
 *
 * ── WHY THIS REPLACES "PHONE US" ────────────────────────────────────────────
 * The billing page used to say, correctly for its time, that there was no
 * checkout button: Stripe does not operate in Somalia, so payment was a human
 * exchange — send money over EVC or Zaad, then wait for a platform admin to
 * confirm it landed and switch the subscription on. That worked, and it cost a
 * phone call and an admin's attention for every renewal.
 *
 * With Sifalo Pay there is a gateway, so the operator can settle from the page.
 * The manual route stays on the page beneath this: a merchant account can be
 * down, and "call us" must never stop being an answer.
 *
 * ── WHAT HAPPENS AFTER ──────────────────────────────────────────────────────
 * The callback calls `settle_subscription_payment` (20260821000001) — the same
 * function an admin's manual confirmation goes through. A Sifalo payment
 * therefore lands in exactly the same state as one confirmed by hand: same
 * payment row in the history below, same extended period. Nothing about this
 * component is a second billing path.
 */
export function SubscriptionCheckout({
  plan,
  subscriptionId,
}: {
  plan: PlanId;
  /** Absent until a trial has been started, which is when there is nothing to pay. */
  subscriptionId?: string;
}) {
  const [gateway, setGateway] = useState<GatewayKey>("evcplus");
  const [account, setAccount] = useState("");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { start, isStarting, error: startError, clearError } = useStartPayment();
  const { status, timedOut } = usePaymentStatus(paymentId);

  const meta = GATEWAYS.find((g) => g.key === gateway)!;
  const details = planById(plan);

  if (!subscriptionId) return null;

  const begin = async () => {
    setLocalError(null);
    clearError();
    if (meta.usesPhone && !looksLikeAccount(account)) {
      setLocalError(`Enter the ${meta.label} number you're paying from.`);
      return;
    }
    const started = await start({
      purpose: "subscription",
      subscriptionId,
      plan,
      gateway,
      account: meta.usesPhone ? normaliseAccount(account) : "",
    });
    if (!started) return;
    if (started.redirectUrl) {
      window.location.href = started.redirectUrl;
      return;
    }
    setPaymentId(started.paymentId);
  };

  if (status === "paid") {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-success/10 p-3">
        <CheckCircle2 className="w-4.5 h-4.5 text-success shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Paid</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Your {details.label} plan is active. The payment is in the history below.
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 p-3">
          <XCircle className="w-4.5 h-4.5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Payment didn't go through</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Nothing was taken. Try again, or arrange it by phone below.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-xl"
          onClick={() => setPaymentId(null)}
        >
          Try again
        </Button>
      </div>
    );
  }

  if (paymentId && !timedOut) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 p-3">
        <Loader2 className="w-4.5 h-4.5 text-primary shrink-0 mt-0.5 animate-spin" />
        <div className="text-sm">
          <p className="font-medium text-foreground">Check your phone</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Approve the {formatPlanPrice(plan)} {meta.label} request with your PIN.
          </p>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="rounded-xl bg-muted/60 p-3 text-sm">
        <p className="font-medium text-foreground">Still waiting</p>
        <p className="text-muted-foreground text-xs mt-0.5">
          We haven't heard back. If you approved it, it will appear in the history below —
          don't pay twice.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">Pay for {details.label}</span>
        <span className="font-heading font-bold text-foreground">{formatPlanPrice(plan)}</span>
      </div>

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
                : "border-border bg-background hover:border-primary/40"
            }`}
          >
            <span className="block text-sm font-medium text-foreground">{g.label}</span>
            <span className="block text-[10px] text-muted-foreground">{g.network}</span>
          </button>
        ))}
      </div>

      {meta.usesPhone && (
        <div className="space-y-1.5">
          <Label htmlFor="sub-account" className="text-[11px] text-muted-foreground">
            {meta.label} number
          </Label>
          <div className="relative">
            <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="sub-account"
              type="tel"
              inputMode="numeric"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder={meta.accountHint}
              maxLength={20}
              className="h-10 rounded-xl pl-9"
            />
          </div>
        </div>
      )}

      {(localError || startError) && (
        <p className="text-xs text-destructive" role="alert">
          {localError ?? startError}
        </p>
      )}

      <Button type="button" variant="hero" className="w-full" disabled={isStarting} onClick={begin}>
        {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {isStarting ? "Starting…" : `Pay ${formatPlanPrice(plan)}`}
      </Button>
    </div>
  );
}

export default SubscriptionCheckout;
