import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import {
  formatMoney,
  todayInputValue,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  addDaysLocal,
  nightsBetween,
  totalFor,
  useSaveBooking,
  checkAvailability,
  type Booking,
  type BookingStatus,
  type BookingSource,
} from "@/hooks/use-bookings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const EDITABLE_STATUSES: { value: BookingStatus; label: string }[] = [
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
];

const SOURCES: { value: BookingSource; label: string }[] = [
  { value: "walk_in", label: "Walk-in" },
  { value: "phone", label: "Phone" },
  { value: "online", label: "Online request" },
  { value: "agent", label: "Agent" },
  { value: "admin", label: "Admin" },
];

type BookingDialogProps = {
  property: ManagedProperty;
  /** Pass an existing booking to edit; `null` creates a new walk-in. */
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Create or correct a reservation. Walk-ins are created straight as
 * "confirmed"; online requests are managed from here too. A live availability
 * check flags an overlap before the server rejects it.
 */
export function BookingDialog({
  property, booking, open, onOpenChange,
}: BookingDialogProps) {
  const save = useSaveBooking(property.id);

  const defaultRate = property.monthlyRent || 0;

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [checkIn, setCheckIn] = useState(todayInputValue());
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState("1");
  const [children, setChildren] = useState("0");
  const [ratePerNight, setRatePerNight] = useState("");
  const [status, setStatus] = useState<BookingStatus>("confirmed");
  const [source, setSource] = useState<BookingSource>("walk_in");
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<{
    state: "idle" | "checking" | "free" | "clash";
    message?: string;
  }>({ state: "idle" });

  // Load values whenever the dialog opens for a different target.
  useEffect(() => {
    if (!open) return;
    setGuestName(booking?.guestName ?? "");
    setGuestPhone(booking?.guestPhone ?? "");
    setGuestEmail(booking?.guestEmail ?? "");
    setCheckIn(booking?.checkIn ?? todayInputValue());
    setCheckOut(booking?.checkOut ?? "");
    setAdults(String(booking?.adults ?? 1));
    setChildren(String(booking?.children ?? 0));
    setRatePerNight(booking ? String(booking.ratePerNight) : String(defaultRate));
    setStatus(booking?.status === "requested" ? "requested" : "confirmed");
    setSource(booking?.source ?? "walk_in");
    setNotes(booking?.notes ?? "");
    setAvailability({ state: "idle" });
  }, [open, booking, defaultRate]);

  const parsedRate = Number(ratePerNight) || 0;
  const nights = nightsBetween(checkIn, checkOut);
  const total = totalFor(parsedRate, checkIn, checkOut);

  const nameError =
    guestName.trim().length === 0 ? "Enter the guest's name." : null;
  const datesError =
    checkOut && checkIn && nights <= 0 ? "Check-out must be after check-in." : null;

  // Mirrors the bookings_contact_required constraint (20260905000002). Enforced
  // here too so a receptionist gets a sentence instead of a Postgres check
  // violation — the database is the authority, this is the manners.
  //
  // Walk-in is exempt on purpose: a guest at the counter with cash may have no
  // number worth recording and does not need one, they are already here. Every
  // other source describes a guest who is somewhere else.
  const contactError =
    source !== "walk_in" && !guestPhone.trim() && !guestEmail.trim()
      ? "Add a phone or an email — only walk-ins can be booked without one."
      : null;

  // Live availability check. Runs whenever the dates (or the booking being
  // edited) change, and ignores stale responses via the `alive` flag.
  useEffect(() => {
    if (!open || !checkIn || !checkOut || nights <= 0) {
      setAvailability({ state: "idle" });
      return;
    }
    let alive = true;
    setAvailability({ state: "checking" });
    checkAvailability(property.id, checkIn, checkOut, booking?.id)
      .then((clashes) => {
        if (!alive) return;
        if (clashes.length === 0) {
          setAvailability({ state: "free" });
        } else {
          const c = clashes[0];
          setAvailability({
            state: "clash",
            message: `Unavailable — ${c.guestName ?? "a booking"} is in from ${c.checkIn} to ${c.checkOut}.`,
          });
        }
      })
      .catch(() => {
        if (alive) setAvailability({ state: "idle" });
      });
    return () => {
      alive = false;
    };
  }, [open, checkIn, checkOut, nights, property.id, booking?.id]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (nameError || datesError || contactError) return;
    if (availability.state === "clash") return;

    save.mutate(
      {
        id: booking?.id,
        guestName,
        guestPhone,
        guestEmail,
        checkIn,
        checkOut,
        adults: Number(adults) || 1,
        children: Number(children) || 0,
        ratePerNight: parsedRate,
        status,
        source,
        notes,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{booking ? "Edit booking" : "New booking"}</DialogTitle>
          <DialogDescription>
            {property.title} · {formatMoney(parsedRate)}/night
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="booking-guest" className="text-xs text-muted-foreground">
              Guest name
            </Label>
            <Input
              id="booking-guest"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Full name"
              maxLength={120}
              className="h-11 rounded-xl"
              aria-invalid={!!nameError}
              autoFocus
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="booking-phone" className="text-xs text-muted-foreground">
                Phone <span className="text-muted-foreground/70">(private)</span>
              </Label>
              <Input
                id="booking-phone"
                type="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+252…"
                maxLength={32}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Input
                id="booking-email"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="guest@email.com"
                maxLength={160}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          {contactError && (
            <p className="text-xs text-destructive -mt-1">{contactError}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="booking-checkin" className="text-xs text-muted-foreground">
                Check-in
              </Label>
              <Input
                id="booking-checkin"
                type="date"
                value={checkIn}
                onChange={(e) => {
                  setCheckIn(e.target.value);
                  if (!checkOut || e.target.value >= checkOut) {
                    setCheckOut(addDaysLocal(e.target.value, 1));
                  }
                }}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-checkout" className="text-xs text-muted-foreground">
                Check-out
              </Label>
              <Input
                id="booking-checkout"
                type="date"
                value={checkOut}
                min={checkIn}
                onChange={(e) => setCheckOut(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>
          {datesError && <p className="text-xs text-destructive -mt-2">{datesError}</p>}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="booking-adults" className="text-xs text-muted-foreground">
                Adults
              </Label>
              <Input
                id="booking-adults"
                type="number"
                min="1"
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-children" className="text-xs text-muted-foreground">
                Children
              </Label>
              <Input
                id="booking-children"
                type="number"
                min="0"
                value={children}
                onChange={(e) => setChildren(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-rate" className="text-xs text-muted-foreground">
                Rate/night
              </Label>
              <Input
                id="booking-rate"
                type="number"
                min="0"
                step="0.01"
                value={ratePerNight}
                onChange={(e) => setRatePerNight(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="booking-status" className="text-xs text-muted-foreground">
                Status
              </Label>
              <Select value={status} onValueChange={(v) => setStatus(v as BookingStatus)}>
                <SelectTrigger id="booking-status" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-source" className="text-xs text-muted-foreground">
                Source
              </Label>
              <Select value={source} onValueChange={(v) => setSource(v as BookingSource)}>
                <SelectTrigger id="booking-source" className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {availability.state === "clash" && (
            <p className="text-xs text-destructive">{availability.message}</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="booking-notes" className="text-xs text-muted-foreground">
              Notes <span className="text-muted-foreground/70">(optional)</span>
            </Label>
            <Textarea
              id="booking-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Arrival time, requests, reference…"
              className="rounded-xl min-h-[56px]"
            />
          </div>

          {nights > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4" />
                {nights} night{nights === 1 ? "" : "s"}
              </span>
              <span className="font-semibold text-foreground">{formatMoney(total)}</span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={
                save.isPending ||
                !!nameError ||
                !!datesError ||
                !!contactError ||
                availability.state === "clash" ||
                availability.state === "checking"
              }
            >
              {save.isPending ? "Saving..." : booking ? "Save changes" : "Create booking"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
