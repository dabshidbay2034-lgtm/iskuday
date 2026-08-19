-- =============================================================================
-- Migration: 20260905000001_payments.sql
--
-- Online payment for bookings and subscriptions, via Somali mobile money.
--
-- WHAT THIS ADDS:
--   • hotels.payment_options TEXT[]  — which ways a hotel lets guests pay
--   • hotels.deposit_percent INT     — the deposit share, when it offers one
--   • bookings.payment_option TEXT   — what the guest chose
--   • bookings.payment_status TEXT   — derived from the payments below
--   • public.payments                — one row per attempt, not per success
--   • public.record_payment_result() — the ONLY writer of a paid/failed result
--
-- ── WHY A PAYMENTS TABLE AND NOT A COLUMN ───────────────────────────────────
-- `bookings.amount_paid` already existed and is not enough. A guest in Mogadishu
-- pushing money from EVC Plus routinely fails the first time — wrong PIN, no
-- balance, the USSD session times out, the operator is down — and then succeeds
-- on the third try. A single column records only the last word and loses the
-- attempts, which are exactly what the front desk needs when a guest says "I
-- paid" and the room still shows unpaid. So every attempt gets a row, including
-- the failures, and `amount_paid` becomes a derived convenience rather than the
-- record.
--
-- ── WHY THE MONEY IS NOT TRUSTED FROM THE CLIENT ────────────────────────────
-- Nothing in the browser may write `status = 'paid'`. The insert policy below
-- lets an anonymous guest create a PENDING payment (they have to — they are not
-- signed in), and `record_payment_result()` is SECURITY DEFINER and the only
-- path to any terminal state. The edge function calls it after the provider's
-- webhook has been verified. A guest who edits the request body gets a pending
-- row and no booking.
--
-- ── WHY amount IS NUMERIC AND currency IS TEXT ──────────────────────────────
-- Matching bookings.total_amount, which is already NUMERIC. Sifalo settles in
-- USD and this market quotes hotel rates in USD, but the column is not assumed:
-- a hotel quoting SOS should not need a migration.
--
-- RE-RUNNABLE: every statement is IF NOT EXISTS or DROP-then-CREATE.
-- PRECONDITIONS: 20260807000001 (bookings), 20260808000001 (hotels).
-- =============================================================================

-- ── STEP 0: preconditions ────────────────────────────────────────────────────
-- A plpgsql function body is not resolved against its tables at CREATE time, so
-- without this the whole file would "succeed" against a database missing
-- bookings and fail later at the first call.
DO $$
DECLARE missing TEXT[] := '{}';
BEGIN
  IF to_regclass('public.bookings') IS NULL THEN
    missing := array_append(missing, 'public.bookings  [20260807000001_hotel_booking.sql]');
  END IF;
  IF to_regclass('public.hotels') IS NULL THEN
    missing := array_append(missing, 'public.hotels  [20260808000001]');
  END IF;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'Cannot apply 20260905000001_payments.sql. Missing:\n  %',
      array_to_string(missing, E'\n  ');
  END IF;
END $$;

-- ── STEP 1: what a hotel is willing to accept ────────────────────────────────

-- The menu a guest is offered. A hotel that wants cash only keeps
-- '{at_hotel}'; one that wants the money up front drops 'at_hotel'.
--
-- Default is all three: a hotel that has not thought about it should not
-- silently stop taking bookings it would have accepted before this migration.
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS payment_options TEXT[] NOT NULL
  DEFAULT ARRAY['pay_now', 'deposit', 'at_hotel'];

-- The deposit share, when the hotel offers one. 25 is the product default the
-- platform advertises, but it is a COLUMN and not a constant because a hotel
-- with a wedding hall books differently from one selling single nights.
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS deposit_percent INT NOT NULL DEFAULT 25;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_deposit_percent_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_deposit_percent_check
  CHECK (deposit_percent BETWEEN 1 AND 100);

-- Rejects a typo'd option rather than offering a guest a button that leads
-- nowhere. Stored as an array because the three are not mutually exclusive.
ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_payment_options_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_payment_options_check
  CHECK (payment_options <@ ARRAY['pay_now', 'deposit', 'at_hotel']);

COMMENT ON COLUMN public.hotels.payment_options IS
  'Which payment routes this hotel offers a guest: pay_now (full), deposit (deposit_percent up front), at_hotel (nothing online).';
COMMENT ON COLUMN public.hotels.deposit_percent IS
  'Share of the total taken up front when payment_options includes ''deposit''. Product default 25.';

-- ── STEP 2: what the guest chose ─────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_option TEXT NOT NULL DEFAULT 'at_hotel';

-- Derived from `payments`, never written directly by a client. 'unpaid' is the
-- correct state for a booking taken at the front desk, which is most of them.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_option_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_option_check
  CHECK (payment_option IN ('pay_now', 'deposit', 'at_hotel'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_status_check
  CHECK (payment_status IN ('unpaid', 'pending', 'deposit_paid', 'paid', 'refunded'));

COMMENT ON COLUMN public.bookings.payment_status IS
  'Derived by record_payment_result() from public.payments. Never written by a client.';

-- ── STEP 3: the ledger ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- Exactly one of these is set; the CHECK below enforces it. A booking payment
  -- belongs to a stay, a subscription payment belongs to an org's plan.
  booking_id    UUID        REFERENCES public.bookings(id) ON DELETE CASCADE,
  org_id        TEXT,
  purpose       TEXT        NOT NULL,
  -- Which of the hotel's offered routes this payment is settling.
  kind          TEXT        NOT NULL DEFAULT 'full',
  provider      TEXT        NOT NULL DEFAULT 'sifalo',
  -- The wallet the guest paid from: evcplus | zaad | edahab | sahal | premier | card.
  gateway       TEXT,
  -- The payer's msisdn as typed. Not normalised in the database: the provider
  -- is the authority on what a valid account looks like per gateway, and
  -- rewriting it here would make a failed payment hard to match to a receipt.
  account       TEXT,
  amount        NUMERIC     NOT NULL,
  currency      TEXT        NOT NULL DEFAULT 'USD',
  status        TEXT        NOT NULL DEFAULT 'pending',
  -- The provider's own id. UNIQUE so a webhook delivered twice — which every
  -- provider does — cannot be applied twice. This is the idempotency key.
  provider_ref  TEXT,
  -- What the provider actually said, kept verbatim. When a guest disputes a
  -- charge months later this is the only record of the exchange.
  raw           JSONB,
  failure_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ,
  CONSTRAINT payments_pkey PRIMARY KEY (id)
);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_purpose_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_purpose_check CHECK (purpose IN ('booking', 'subscription'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_check CHECK (kind IN ('full', 'deposit', 'balance'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_check CHECK (amount > 0);

-- A booking payment without a booking is unattachable; a subscription payment
-- without an org is unbillable. Either way it is a row nobody can act on.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_target_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_target_check CHECK (
    (purpose = 'booking'      AND booking_id IS NOT NULL) OR
    (purpose = 'subscription' AND org_id     IS NOT NULL)
  );

-- The idempotency key. Partial, because a pending row has no provider_ref yet
-- and several of those legitimately coexist (a guest retrying EVC Plus).
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_key
  ON public.payments (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_booking ON public.payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_org     ON public.payments (org_id);

COMMENT ON TABLE public.payments IS
  'One row per payment ATTEMPT, including failures. Terminal states are written only by record_payment_result().';

-- ── STEP 4: RLS ──────────────────────────────────────────────────────────────

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Read: the people who run the hotel, plus platform admins. Deliberately NOT
-- the guest — they are anonymous, there is no session to scope a policy to, and
-- their receipt comes from the provider. Adding a "read by booking id" policy
-- would make every payment readable to anyone who can guess a UUID.
DROP POLICY IF EXISTS "payments readable by hotel staff" ON public.payments;
CREATE POLICY "payments readable by hotel staff" ON public.payments
  FOR SELECT USING (
    (booking_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.id = payments.booking_id
         AND (
           public.owns_property(b.room_id)
           OR (b.org_id IS NOT NULL AND b.org_id = public.current_org_id())
         )
    ))
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.has_role(public.current_org_id(), 'admin'::public.app_role)
  );

-- Insert: anyone may OPEN a payment. A guest booking a room is anonymous by
-- definition, so requiring a session here would mean no guest could ever pay.
-- The WITH CHECK pins the row to a state that grants nothing: pending, and
-- never carrying a provider reference the client could have invented.
DROP POLICY IF EXISTS "anyone may open a pending payment" ON public.payments;
CREATE POLICY "anyone may open a pending payment" ON public.payments
  FOR INSERT WITH CHECK (status = 'pending' AND provider_ref IS NULL);

-- No UPDATE or DELETE policy exists, for either role. A ledger that can be
-- edited is not a ledger, and record_payment_result() is SECURITY DEFINER so it
-- does not need one.

-- ── STEP 5: the only writer of a result ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_payment_result(
  _payment_id     UUID,
  _status         TEXT,
  _provider_ref   TEXT   DEFAULT NULL,
  _raw            JSONB  DEFAULT NULL,
  _failure_reason TEXT   DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments;
  v_booking public.bookings;
  v_paid    NUMERIC;
BEGIN
  IF _status NOT IN ('paid', 'failed', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'record_payment_result: % is not a terminal status', _status;
  END IF;

  -- Idempotency. A provider webhook arrives more than once as a matter of
  -- course, and the second delivery must not add the money twice. Settling an
  -- already-settled payment returns it unchanged rather than raising, because
  -- the caller is a webhook and an error would make it retry forever.
  SELECT * INTO v_payment FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_payment_result: no payment %', _payment_id;
  END IF;
  IF v_payment.status <> 'pending' THEN
    RETURN v_payment;
  END IF;

  UPDATE public.payments
     SET status         = _status,
         provider_ref   = COALESCE(_provider_ref, provider_ref),
         raw            = COALESCE(_raw, raw),
         failure_reason = _failure_reason,
         settled_at     = CASE WHEN _status = 'paid' THEN now() ELSE settled_at END
   WHERE id = _payment_id
   RETURNING * INTO v_payment;

  -- A failure changes nothing about the booking. The guest may try again, and
  -- the room must stay held for them while they do.
  IF v_payment.purpose <> 'booking' OR v_payment.status <> 'paid' THEN
    RETURN v_payment;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN v_payment;
  END IF;

  -- Recomputed from the ledger rather than incremented, so a replayed webhook
  -- or a hand-fixed row can never drift the total away from what was actually
  -- collected.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE booking_id = v_booking.id AND status = 'paid';

  UPDATE public.bookings
     SET amount_paid    = v_paid,
         payment_status = CASE
           WHEN v_paid >= v_booking.total_amount THEN 'paid'
           WHEN v_paid > 0                       THEN 'deposit_paid'
           ELSE 'unpaid'
         END,
         -- Money settles the hold. A guest who has paid has a room, and the
         -- desk should not be able to lose the booking in a list of requests.
         status = CASE WHEN status = 'requested' THEN 'confirmed' ELSE status END,
         updated_at = now()
   WHERE id = v_booking.id;

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_result(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
-- service_role only: this is called by the payment webhook edge function after
-- it has verified the provider's signature, and by nothing else. Granting it to
-- authenticated would let any signed-in user mark their own booking paid.
GRANT EXECUTE ON FUNCTION public.record_payment_result(UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.record_payment_result(UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Settle one payment and re-derive the booking total from the ledger. Idempotent. service_role only.';

-- ── STEP 6: letting the payer watch their own payment ────────────────────────

/**
 * The status of one payment, and nothing else.
 *
 * The SELECT policy above deliberately excludes the guest: they are anonymous,
 * there is no session to scope a policy to, and a "readable by booking id"
 * policy would expose every payment to anyone who can guess a UUID.
 *
 * But the guest still has to SEE their wallet push resolve — they approve on
 * the handset and the page has to stop saying "waiting". So this returns the
 * one field that makes that possible and no other. Someone who brute-forces a
 * v4 UUID learns the word "pending". They learn no amount, no name, no phone
 * number, and no booking id, and they cannot change anything.
 */
CREATE OR REPLACE FUNCTION public.payment_status(_payment_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT status FROM public.payments WHERE id = _payment_id;
$$;

REVOKE ALL ON FUNCTION public.payment_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_status(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.payment_status(UUID) IS
  'One payment''s status, for the anonymous payer to poll. Returns no other column by design.';
