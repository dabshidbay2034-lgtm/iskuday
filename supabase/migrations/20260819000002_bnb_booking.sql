-- =============================================================================
-- Migration: 20260819000002_bnb_booking.sql
--
-- Makes BnB units bookable.
--
-- `create_booking_request()` is the ONLY way a member of the public creates a
-- booking — it is the SECURITY DEFINER function granted to `anon`, and it
-- refuses anything that is not a nightly-rate hotel room. A BnB earns by the
-- night and takes reservations, so that guard has to widen by exactly one
-- type, and nothing else about the function may change.
--
-- ── WHY THE WHOLE FUNCTION IS RESTATED ─────────────────────────────────────
-- Postgres has no "patch this line" for a function body; CREATE OR REPLACE
-- takes the complete definition. The body below is 20260812000001's version
-- verbatim — all four anonymous-request guards (past dates, 30-night ceiling,
-- 18-month horizon, check-out after check-in) are carried over UNCHANGED.
-- The single edit is the bookable-type test. If you are reviewing this, that
-- is the only line to compare; a diff against 20260812000001 STEP 6 should
-- show one changed condition and one comment.
--
-- Dropping any of those guards while widening the type would re-open the
-- vulnerabilities 20260812000001 closed, on a wider set of rows than before.
--
-- ── THE PAIRING WITH is_daily_rate IS KEPT ─────────────────────────────────
-- The test stays `type IN (...) AND is_daily_rate` rather than trusting the
-- type alone. `is_daily_rate` is the column the price display, the marketplace
-- filter and the structured data all read; a row whose type says BnB but whose
-- rate is monthly is misconfigured, and quoting a nightly total against a
-- monthly price would bill a guest ~30x wrong. Refusing to book it is right.
--
-- PREREQUISITE: 20260819000001_bnb_type.sql must ALREADY BE COMMITTED. The
-- preflight below fails loudly if it is not, rather than creating a function
-- that can never match.
--
-- RE-RUNNABLE: CREATE OR REPLACE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'property_type' AND e.enumlabel = 'bnb'
  ) THEN
    RAISE EXCEPTION
      E'property_type has no ''bnb'' label yet.\n\nApply supabase/migrations/20260819000001_bnb_type.sql FIRST, and let it commit — a new enum label cannot be used in the transaction that adds it. Nothing has been changed by this script.';
  END IF;

  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'public.bookings is missing — apply 20260807000001_hotel_booking.sql first.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- The public booking entry point, widened to BnBs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_room_id   uuid,
  p_check_in  date,
  p_check_out date,
  p_adults    int,
  p_children  int,
  p_guest_name  text,
  p_guest_phone text,
  p_guest_email text,
  p_notes       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prop     public.properties%ROWTYPE;
  v_nights   int;
  v_total    numeric;
  v_booking_id uuid;
BEGIN
  SELECT * INTO v_prop FROM public.properties WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_check_out IS NULL OR p_check_in IS NULL OR p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Guards from 20260812000001 — carried over verbatim ─────────────────────
  IF p_check_in < CURRENT_DATE THEN
    RAISE EXCEPTION 'Check-in cannot be in the past. Please choose today or a later date.'
      USING ERRCODE = 'P0001';
  END IF;

  IF (p_check_out - p_check_in) > 30 THEN
    RAISE EXCEPTION 'Online bookings are limited to 30 nights. Please contact us directly for a longer stay.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_check_in > (CURRENT_DATE + INTERVAL '18 months')::date THEN
    RAISE EXCEPTION 'Bookings can only be made up to 18 months in advance.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ── end of carried-over guards ─────────────────────────────────────────────

  -- CHANGED 20260819000002: hotel rooms AND BnB units are bookable. Both must
  -- still be on a nightly rate — see the header on why the pairing is kept.
  IF (v_prop.type NOT IN ('hotel', 'bnb')) OR (v_prop.is_daily_rate IS NOT TRUE) THEN
    RAISE EXCEPTION 'This unit cannot be booked online.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_adults IS NULL OR p_adults < 1 THEN
    p_adults := 1;
  END IF;
  IF p_children IS NULL OR p_children < 0 THEN
    p_children := 0;
  END IF;

  v_nights := p_check_out - p_check_in;
  v_total  := v_nights * COALESCE(v_prop.price, 0);

  INSERT INTO public.bookings (
    room_id, org_id, guest_name, guest_phone, guest_email,
    check_in, check_out, adults, children,
    rate_per_night, total_amount, amount_paid,
    status, source, notes
  ) VALUES (
    p_room_id, v_prop.org_id,
    NULLIF(btrim(p_guest_name), ''),
    NULLIF(btrim(p_guest_phone), ''), NULLIF(btrim(p_guest_email), ''),
    p_check_in, p_check_out, p_adults, p_children,
    COALESCE(v_prop.price, 0), v_total, 0,
    'requested', 'online', NULLIF(btrim(p_notes), '')
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'id', v_booking_id,
    'total_amount', v_total,
    'nights', v_nights
  );
END $$;

-- Unchanged from 20260807000001 / 20260812000001 — the public booking form
-- still needs anon. Restated because CREATE OR REPLACE does not disturb grants
-- but a future DROP + CREATE would silently lose them.
GRANT EXECUTE ON FUNCTION public.create_booking_request(
  uuid, date, date, int, int, text, text, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.create_booking_request(
  uuid, date, date, int, int, text, text, text, text
) IS
  'Public booking entry point (anon). Accepts nightly-rate hotel rooms and BnB units only. Guards: no past check-in, max 30 nights, max 18 months ahead.';

-- =============================================================================
-- Verify with:
--
--   -- 1. The guard now names both types:
--   SELECT pg_get_functiondef(oid) LIKE '%NOT IN (''hotel'', ''bnb'')%' AS widened
--     FROM pg_proc WHERE proname = 'create_booking_request';
--
--   -- 2. The four anonymous-request guards SURVIVED the replace. All must be true:
--   SELECT
--     pg_get_functiondef(oid) LIKE '%Check-in cannot be in the past%'        AS past_guard,
--     pg_get_functiondef(oid) LIKE '%limited to 30 nights%'                  AS length_guard,
--     pg_get_functiondef(oid) LIKE '%18 months in advance%'                  AS horizon_guard,
--     pg_get_functiondef(oid) LIKE '%Check-out must be after check-in%'      AS order_guard
--     FROM pg_proc WHERE proname = 'create_booking_request';
--
--   -- 3. anon can still call it:
--   SELECT has_function_privilege('anon',
--     'public.create_booking_request(uuid,date,date,int,int,text,text,text,text)',
--     'EXECUTE') AS anon_may_book;
--
--   -- 4. A monthly-rate BnB is still refused (the pairing holds). On a test row:
--   --   UPDATE properties SET type='bnb', is_daily_rate=false WHERE id='<test>';
--   --   SELECT create_booking_request('<test>', CURRENT_DATE+1, CURRENT_DATE+3,
--   --                                 2, 0, 'T', '+252', 't@e.com');
--   -- expect: This unit cannot be booked online.
-- =============================================================================
