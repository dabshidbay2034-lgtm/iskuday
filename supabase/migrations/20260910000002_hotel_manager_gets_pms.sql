-- =============================================================================
-- Migration: 20260910000002_hotel_manager_gets_pms.sql
--
-- A hotel account may list ordinary property, because it now pays for the PMS.
--
-- ── THE CONTRADICTION THIS RESOLVES ─────────────────────────────────────────
-- Three rules were each written correctly, at different times, and together
-- they sold something and then refused to deliver it:
--
--   1. The `hotel` plan is priced and advertised as "Hotel Management + PMS",
--      one price, and PLAN_COVERAGE (src/lib/plans.ts) now lets it satisfy
--      every `BillingGate plan="pms"` — the whole of /manage/property/:id.
--
--   2. properties_enforce_account_type() (20260812000002) refuses ANY
--      non-hotel property insert from a hotel_manager:
--          IF NEW.type <> 'hotel' AND v_hotel THEN RAISE ...
--      So the customer reaches the rent ledger, the tenants and the lease
--      screens they paid for, and cannot put a single building behind them.
--
--   3. Both of that trigger's messages end "Switch your account type in
--      Settings" — the documented escape hatch, also named in the header of
--      src/lib/account-type.ts. 20260908000001 FROZE the account type, so that
--      instruction is now an instruction to do something impossible.
--
-- Rule 2 is the one that has to give. It encodes a product decision — "a hotel
-- is not a letting agency" — that the pricing has since reversed. The plan says
-- a hotelier who also owns apartments gets both tools for $99.99; this makes
-- that true.
--
-- ── WHAT IS KEPT ────────────────────────────────────────────────────────────
-- The other direction still holds: an owner or agent may NOT create
-- `type = 'hotel'`. Hotel rooms carry bookings, housekeeping, hotel pages and a
-- front desk, and they belong to an account that has bought that. The rule was
-- never symmetric in value — it is "hotel rooms require a hotel account", not
-- "hotel accounts may only touch hotel rooms".
--
-- Selling is opened to hotel accounts for the same reason (STEP 2). Leaving
-- `purpose = 'sell'` blocked while `purpose = 'rent'` is allowed would let a
-- hotelier list their apartment building to let but not to sell, which is not a
-- rule anybody could have intended — it is only the shadow of rule 2.
--
-- ── MESSAGES ────────────────────────────────────────────────────────────────
-- Both remaining refusals stop telling people to switch their account type.
-- After 20260908000001 nobody can, so the old text sends a paying customer to
-- a Settings screen to look for a control that is deliberately not there.
--
-- RE-RUNNABLE: CREATE OR REPLACE FUNCTION only; triggers already point at these
-- names and are not redefined.
-- PRECONDITIONS: 20260812000002 (properties_enforce_account_type),
--                20260901000001 (properties_enforce_sell_purpose).
-- =============================================================================

DO $$
DECLARE missing TEXT[] := '{}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'properties_enforce_account_type'
  ) THEN
    missing := array_append(missing, 'public.properties_enforce_account_type()  [20260812000002]');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'properties_enforce_sell_purpose'
  ) THEN
    missing := array_append(missing, 'public.properties_enforce_sell_purpose()  [20260901000001]');
  END IF;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'Cannot apply 20260910000002. Missing:\n  %',
      array_to_string(missing, E'\n  ');
  END IF;
END $$;

-- ── STEP 1: a hotel account may list ordinary property ───────────────────────

CREATE OR REPLACE FUNCTION public.properties_enforce_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user  TEXT := auth.jwt()->>'sub';
  v_hotel BOOLEAN;
  v_admin BOOLEAN;
BEGIN
  -- Service-role paths (backfills, support scripts, the Clerk webhook) already
  -- bypass RLS entirely and never run in a browser. Without this escape no
  -- migration could ever seed or repair a listing.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- No JWT: RLS already refuses the write, so don't second-guess it here.
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_admin := public.has_role(v_user, 'admin');
  IF v_admin THEN
    RETURN NEW;
  END IF;

  v_hotel := public.has_role(v_user, 'hotel_manager');

  -- KEPT: hotel rooms require a hotel account. A room carries bookings,
  -- housekeeping, a front desk and a public hotel page; those belong to an
  -- account that has bought the hotel plan.
  IF NEW.type = 'hotel' AND NOT v_hotel THEN
    RAISE EXCEPTION
      'Only hotel accounts can list hotel rooms. Contact support if your account should be a hotel.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- REMOVED: the reverse rule. A hotel account used to be refused every
  -- non-hotel type, which contradicted the "Hotel Management + PMS" plan it
  -- pays for — it could reach the rent ledger and never add a building to it.
  -- See this migration's header.

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.properties_enforce_account_type() IS
  'Hotel rooms require a hotel account. Hotel accounts may also list ordinary property — the hotel plan includes the PMS. See 20260910000002.';

-- ── STEP 2: and may list it for sale ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.properties_enforce_sell_purpose()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_may   BOOLEAN;
  v_user  TEXT := auth.jwt()->>'sub';
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(v_user, 'admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.purpose = 'sell' THEN
    -- hotel_manager joins agent and owner here. Not a new privilege so much as
    -- the removal of an accident: with STEP 1 a hotel account can list an
    -- apartment to LET, and refusing the same building for SALE would be a
    -- distinction with no rule behind it.
    v_may := public.has_role(v_user, 'agent')
          OR public.has_role(v_user, 'owner')
          OR public.has_role(v_user, 'hotel_manager');
    IF NOT v_may THEN
      RAISE EXCEPTION
        'Only business accounts can list a property for sale. Renters cannot — choose an account type first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.properties_enforce_sell_purpose() IS
  'Listing for sale requires a business account (agent, owner or hotel_manager). See 20260910000002.';
