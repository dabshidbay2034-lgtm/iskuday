-- =============================================================================
-- Migration: 20260821000001_subscription_settlement.sql
--
-- Lets a PAYMENT PROCESSOR settle a subscription, safely.
--
-- Everything about subscription money today assumes a human: `useRecord-
-- SubscriptionPayment` refuses anyone who is not a platform admin, and the RLS
-- policy behind it agrees. That is correct for cash and for an EVC transfer
-- somebody eyeballs — and it is unusable for an automated rail, because a
-- webhook arriving from Sifalo Pay has no Clerk session, no platform role, and
-- nobody watching.
--
-- This migration adds the two things any processor integration needs, both of
-- which are true whatever the processor's wire format turns out to be:
--
--   1. IDEMPOTENCY. A payment reference can be banked at most once.
--   2. A settlement entry point that runs as the service role, records the
--      receipt and extends the entitlement in ONE transaction.
--
-- It deliberately does NOT contain anything Sifalo-specific. The HTTP shape of
-- Sifalo's API is documented only inside the merchant dashboard at
-- pay.sifalo.com/business/merchant/api; nothing here depends on it, so this can
-- be applied now and works unchanged for Sifalo, a card processor, or a
-- reconciliation script.
--
-- ── WHY IDEMPOTENCY IS THE FIRST THING, NOT A REFINEMENT ───────────────────
-- Webhooks are delivered AT LEAST once. Every processor retries on a timeout,
-- a 500, or a slow response — and the retry carries the same reference. Without
-- a uniqueness rule the retry inserts a SECOND receipt for the same money and
-- pushes `current_period_end` out by another month, so a customer who paid once
-- silently receives two months. That is a money bug, it is invisible (both rows
-- look legitimate), and it is only ever found by a human reconciling by hand.
--
-- The constraint is the fix, not application-level "check before insert" —
-- two retries racing would both pass a check and both insert.
--
-- RE-RUNNABLE: guarded index, CREATE OR REPLACE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.subscription_payments') IS NULL THEN
    RAISE EXCEPTION
      E'public.subscription_payments is missing.\n\nApply supabase/migrations/20260816000001_subscriptions.sql first. Nothing has been changed by this script.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — One reference, one receipt.
--
-- PARTIAL, on purpose. `external_ref` is nullable because cash has no
-- reference and 20260816000001 refused to invent fake ones — a plain UNIQUE
-- would be satisfied by many NULLs in Postgres, but the partial index also
-- makes the intent explicit: this rule is about referenced payments only.
--
-- Scoped to (subscription_id, external_ref) rather than external_ref alone:
-- processors namespace references per merchant, not globally, and a collision
-- across two different subscriptions is far likelier than a genuine duplicate
-- being legitimate.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_ref_once
  ON public.subscription_payments(subscription_id, external_ref)
  WHERE external_ref IS NOT NULL;


-- -----------------------------------------------------------------------------
-- STEP 2 — Settle a payment.
--
-- SECURITY DEFINER and granted to NOBODY. That is not an oversight:
--
--   • `anon` / `authenticated` must never reach this — it writes money and
--     grants entitlement, and it is reachable over PostgREST with the anon key
--     that ships in the browser bundle. A GRANT here would let any visitor
--     activate their own subscription for free.
--   • The only intended caller is an edge function holding the SERVICE ROLE
--     key, which bypasses GRANTs entirely. So it needs none.
--
-- If you ever find yourself adding `GRANT EXECUTE … TO authenticated` to make
-- something work, the thing that needs fixing is upstream.
--
-- Returns the payment row's id, or NULL when the reference was already banked.
-- NULL is the SUCCESS path for a duplicate webhook — the caller answers 200 so
-- the processor stops retrying, without double-crediting.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_subscription_payment(
  p_subscription_id UUID,
  p_amount          NUMERIC,
  p_currency        TEXT,
  p_method          TEXT,
  p_external_ref    TEXT,
  p_paid_at         TIMESTAMPTZ DEFAULT now(),
  p_extend_to       DATE        DEFAULT NULL,
  p_note            TEXT        DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_id UUID;
BEGIN
  IF p_external_ref IS NULL OR btrim(p_external_ref) = '' THEN
    RAISE EXCEPTION 'A processor payment must carry an external reference.'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be zero or more.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE id = p_subscription_id) THEN
    RAISE EXCEPTION 'Unknown subscription %.', p_subscription_id USING ERRCODE = '23503';
  END IF;

  -- ON CONFLICT DO NOTHING against the index from STEP 1. A redelivered webhook
  -- lands here, changes nothing, and leaves v_payment_id NULL.
  INSERT INTO public.subscription_payments (
    subscription_id, amount, currency, method, external_ref, paid_at,
    covers_period_start, covers_period_end, recorded_by, note
  ) VALUES (
    p_subscription_id,
    round(p_amount::numeric, 2),
    COALESCE(NULLIF(btrim(p_currency), ''), 'USD'),
    p_method,
    btrim(p_external_ref),
    COALESCE(p_paid_at, now()),
    CURRENT_DATE,
    p_extend_to,
    -- No Clerk id: nobody confirmed this by hand. The processor name is the
    -- audit trail, and it must be visibly different from an admin's id.
    'processor:' || p_method,
    p_note
  )
  ON CONFLICT (subscription_id, external_ref) WHERE external_ref IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    RETURN NULL;             -- already banked; caller should still answer 200
  END IF;

  -- Entitlement second, in the same transaction as the receipt. If anything
  -- below raises, the receipt rolls back too — the alternative (money recorded,
  -- access not granted, or worse the reverse) is what makes billing bugs so
  -- expensive to unpick.
  --
  -- GREATEST so an early renewal EXTENDS rather than truncates: paying on the
  -- 20th for a period ending on the 30th must not move the end date backwards.
  IF p_extend_to IS NOT NULL THEN
    UPDATE public.subscriptions
       SET status             = 'active',
           current_period_end = GREATEST(
             p_extend_to,
             COALESCE(current_period_end, p_extend_to)
           )
     WHERE id = p_subscription_id;
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_subscription_payment(
  UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, DATE, TEXT
) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.settle_subscription_payment(
  UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, DATE, TEXT
) IS
  'Service-role only. Records a processor payment and extends entitlement in one transaction. Idempotent on (subscription_id, external_ref) — returns NULL when the reference was already banked. Never GRANT this to anon or authenticated.';

-- =============================================================================
-- Verify with:
--
--   -- 1. The public roles genuinely cannot call it:
--   SELECT has_function_privilege('anon',
--     'public.settle_subscription_payment(uuid,numeric,text,text,text,timestamptz,date,text)',
--     'EXECUTE') AS anon_can_call;          -- expect FALSE
--   SELECT has_function_privilege('authenticated',
--     'public.settle_subscription_payment(uuid,numeric,text,text,text,timestamptz,date,text)',
--     'EXECUTE') AS authed_can_call;        -- expect FALSE
--
--   -- 2. Idempotency actually bites. Twice with the SAME ref:
--   SELECT public.settle_subscription_payment(
--     '<sub id>', 99.99, 'USD', 'sifalo', 'TEST-REF-1', now(),
--     (CURRENT_DATE + 30), 'idempotency test');     -- returns a uuid
--   SELECT public.settle_subscription_payment(
--     '<sub id>', 99.99, 'USD', 'sifalo', 'TEST-REF-1', now(),
--     (CURRENT_DATE + 30), 'idempotency test');     -- returns NULL
--   SELECT count(*) FROM public.subscription_payments
--    WHERE external_ref = 'TEST-REF-1';             -- expect exactly 1
--
--   -- 3. Early renewal extends, never truncates:
--   --    with current_period_end far in the future, settle with a nearer
--   --    p_extend_to and confirm the end date did NOT move backwards.
--
--   -- 4. Clean up the test rows:
--   DELETE FROM public.subscription_payments WHERE external_ref = 'TEST-REF-1';
-- =============================================================================
