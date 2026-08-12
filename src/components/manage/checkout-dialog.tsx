import { useMemo, useState } from "react";
import { LogOut } from "lucide-react";

import { formatMoney, type ManagedProperty } from "@/hooks/use-rent";
import { useTransitionBooking, type Booking } from "@/hooks/use-bookings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type CheckoutDialogProps = {
  property: ManagedProperty;
  booking: Booking;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Check the guest out. Shows what's settled vs outstanding, lets the desk
 * record the final payment, and marks the room for a housekeeping turnaround.
 */
export function CheckoutDialog({
  property, booking, open, onOpenChange,
}: CheckoutDialogProps) {
  const transition = useTransitionBooking(property.id);

  const [additional, setAdditional] = useState("");

  const balance = useMemo(
    () => Math.max(0, booking.totalAmount - booking.amountPaid),
    [booking],
  );

  const parsed = additional.trim() === "" ? 0 : Number(additional);
  const paymentError =
    additional.trim() !== "" && (!Number.isFinite(parsed) || parsed < 0)
      ? "Enter a valid amount."
      : parsed > balance
        ? "That's more than the outstanding balance."
        : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (paymentError) return;
    transition.mutate(
      {
        bookingId: booking.id,
        transition: {
          to: "checked_out",
          amountPaid: booking.amountPaid + (parsed || 0),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Check out {booking.guestName}</DialogTitle>
          <DialogDescription>
            {property.title} · settle any balance to release the room.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <dl className="space-y-1.5 rounded-xl bg-muted/50 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Stay total</dt>
              <dd className="font-medium text-foreground">{formatMoney(booking.totalAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Already paid</dt>
              <dd className="font-medium text-foreground">{formatMoney(booking.amountPaid)}</dd>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-1.5">
              <dt className="text-foreground font-medium">Outstanding</dt>
              <dd className="font-semibold text-foreground">{formatMoney(balance)}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            <Label htmlFor="checkout-amount" className="text-xs text-muted-foreground">
              Payment now {balance === 0 && <span className="text-success">(settled)</span>}
            </Label>
            <Input
              id="checkout-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={additional}
              disabled={balance === 0}
              onChange={(e) => setAdditional(e.target.value)}
              placeholder="0"
              className="h-11 rounded-xl"
              aria-invalid={!!paymentError}
            />
            {paymentError && <p className="text-xs text-destructive">{paymentError}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={transition.isPending || !!paymentError}
            >
              <LogOut className="w-4 h-4" />
              {transition.isPending ? "Checking out..." : "Check out"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
