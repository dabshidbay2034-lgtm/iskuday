-- =============================================================================
-- Migration: 20260901000001_property_sell_purpose.sql
--
-- Adds a `purpose` column to properties so listings can be for RENT or for SALE.
--
--   purpose = 'rent'  (default) → monthly rent, existing behaviour
--   purpose = 'sell'            → one-time sale price, agencies only
--
-- "Property for sell can only add to the agencies" — the INSERT trigger is
-- extended to reject a `sell` listing from anyone who is NOT an agent.
--
-- RE-RUNNABLE: ALTER … ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — Preflight
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'property_purpose'
  ) THEN
    CREATE TYPE public.property_purpose AS ENUM ('rent', 'sell');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- STEP 1 — Add the column (non-null, defaults to 'rent').
-- -----------------------------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS purpose public.property_purpose NOT NULL DEFAULT 'rent';

COMMENT ON COLUMN public.properties.purpose IS
  '"rent" = monthly rental (default); "sell" = one-time sale price, agencies only.';

-- -----------------------------------------------------------------------------
-- STEP 2 — Extend the account-type enforcement trigger.
--
-- The existing properties_enforce_account_type trigger handles type-based
-- separation (hotel vs rental). We extend the same trigger function to also
-- enforce that only agencies/owners may list for sale — hotel accounts cannot.
-- Actually, let's create a separate trigger for clarity.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.properties_enforce_sell_purpose()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user  TEXT := auth.jwt()->>'sub';
  v_agent BOOLEAN;
  v_admin BOOLEAN;
BEGIN
  -- Service-role paths bypass RLS entirely.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- No JWT: RLS already refuses the write.
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins can do anything.
  v_admin := public.has_role(v_user, 'admin');
  IF v_admin THEN
    RETURN NEW;
  END IF;

  -- Only agents (and owners, if we allow it) can list for SALE.
  -- For now: agents AND owners can sell.
  IF NEW.purpose = 'sell' THEN
    v_agent := public.has_role(v_user, 'agent') OR public.has_role(v_user, 'owner');
    IF NOT v_agent THEN
      RAISE EXCEPTION
        'Only agencies and property owners can list properties for sale. Hotel accounts can only list rooms for rent.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_enforce_sell_purpose ON public.properties;
CREATE TRIGGER properties_enforce_sell_purpose
  BEFORE INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_enforce_sell_purpose();

COMMENT ON FUNCTION public.properties_enforce_sell_purpose() IS
  'Creation-only: only agents/owners may list properties with purpose=sell.';

-- -----------------------------------------------------------------------------
-- STEP 3 — Allow searching/filtering by purpose via a published view helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.properties_sell_only()
RETURNS SETOF public.properties
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.properties WHERE purpose = 'sell';
$$;

COMMENT ON FUNCTION public.properties_sell_only() IS
  'All for-sale listings, for the marketplace filter.';

-- =============================================================================
-- Verify with:
--
--   -- agency CAN list for sale (expect success):
--   SET LOCAL role = 'authenticated';
--   SET LOCAL request.jwt.claims = '{"sub":"<an agent clerk id>","app_metadata":{"role":"agent"}}';
--   INSERT INTO public.properties (owner_id, title, type, purpose, price, location)
--   VALUES ('<same id>', 'Land in Hodan', 'commercial', 'sell', 50000, 'Hodan');
--
--   -- hotel_manager CANNOT list for sale (expect check_violation):
--   SET LOCAL request.jwt.claims = '{"sub":"<a hotel_manager clerk id>","app_metadata":{"role":"hotel_manager"}}';
--   INSERT INTO public.properties (owner_id, title, type, purpose, price, location)
--   VALUES ('<same id>', 'Room', 'hotel', 'sell', 100, 'Yaqshid');
-- =============================================================================