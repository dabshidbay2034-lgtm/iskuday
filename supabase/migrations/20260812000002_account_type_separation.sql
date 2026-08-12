-- =============================================================================
-- Migration: 20260812000002_account_type_separation.sql
--
-- Agencies are agencies; hotels are hotels.
--
-- The platform used to let one account do everything: list apartments, run a
-- hotel front desk and publish a hotel website. Those are different businesses,
-- so the platform role now decides which:
--
--   agent          → letting AGENCY   → villa / apartment / commercial
--   owner          → solo landlord    → villa / apartment / commercial
--   hotel_manager  → HOTEL            → hotel rooms + hotel pages
--   admin          → unrestricted
--
-- The UI already filters the choices (src/lib/account-type.ts), but the UI is
-- not a security boundary: PostgREST is reachable directly with the anon key
-- that ships in the browser bundle, so the rule is enforced here too.
--
-- ── WHY BEFORE INSERT AND NEVER BEFORE UPDATE ──────────────────────────────
-- Accounts created before this split already own a mix. An UPDATE trigger
-- would strand a hotelier from rooms they are actively letting the first time
-- they corrected a typo — a far worse bug than the ambiguity being fixed. So
-- these triggers govern CREATION only. Existing rows stay fully editable, the
-- portfolio keeps listing them, and an account on the wrong side of the line
-- changes its own role in Settings (ProfileSettings self-upgrade) with nothing
-- breaking in between.
--
-- RE-RUNNABLE: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight — name what's missing rather than failing halfway.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.has_role(text, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'has_role(TEXT, app_role) missing — apply 20260804000001_migrate_to_clerk_auth.sql first.';
  END IF;
  IF to_regclass('public.hotels') IS NULL THEN
    RAISE EXCEPTION 'public.hotels missing — apply 20260808000001_hotel_pages.sql first.';
  END IF;
END $$;


-- =============================================================================
-- STEP 1 — properties: hotel rooms are for hotels, rentals are for everyone else.
-- =============================================================================
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

  IF NEW.type = 'hotel' AND NOT v_hotel THEN
    RAISE EXCEPTION
      'Only hotel accounts can list hotel rooms. Switch your account type in Settings to list rooms.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.type <> 'hotel' AND v_hotel THEN
    RAISE EXCEPTION
      'Hotel accounts list hotel rooms only. Switch your account type in Settings to list houses or apartments.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_enforce_account_type ON public.properties;
CREATE TRIGGER properties_enforce_account_type
  BEFORE INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_enforce_account_type();


-- =============================================================================
-- STEP 2 — hotels: only a hotel account may publish a hotel website.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotels_enforce_account_type()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user TEXT := auth.jwt()->>'sub';
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (public.has_role(v_user, 'hotel_manager') OR public.has_role(v_user, 'admin')) THEN
    RAISE EXCEPTION
      'Only hotel accounts can create a hotel page. Switch your account type in Settings.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hotels_enforce_account_type ON public.hotels;
CREATE TRIGGER hotels_enforce_account_type
  BEFORE INSERT ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.hotels_enforce_account_type();


COMMENT ON FUNCTION public.properties_enforce_account_type() IS
  'Creation-only: hotel rooms require a hotel_manager; rentals require a non-hotel account. Existing rows are untouched.';
COMMENT ON FUNCTION public.hotels_enforce_account_type() IS
  'Creation-only: hotel pages require a hotel_manager or admin.';

-- =============================================================================
-- Verify with:
--
--   -- both triggers present, INSERT only:
--   SELECT tgname, tgtype FROM pg_trigger
--    WHERE tgname IN ('properties_enforce_account_type','hotels_enforce_account_type');
--   -- tgtype should decode to BEFORE INSERT (no UPDATE bit).
--
--   -- an agency may NOT create a hotel room (expect check_violation):
--   SET LOCAL role = 'authenticated';
--   SET LOCAL request.jwt.claims = '{"sub":"<an agent clerk id>"}';
--   INSERT INTO public.properties (owner_id, title, type, price, location)
--   VALUES ('<same id>', 'x', 'hotel', 10, 'Hodan');
--
--   -- the same agency MAY still create an apartment (expect success):
--   INSERT INTO public.properties (owner_id, title, type, price, location)
--   VALUES ('<same id>', 'x', 'apartment', 10, 'Hodan');
--
--   -- existing rows remain editable regardless of type (expect success):
--   UPDATE public.properties SET title = title WHERE id = '<an existing hotel row>';
-- =============================================================================
