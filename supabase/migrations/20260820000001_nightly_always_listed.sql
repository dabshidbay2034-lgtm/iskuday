-- =============================================================================
-- Migration: 20260820000001_nightly_always_listed.sql
--
-- Nightly units stay on the market. Bookings — not a manual flag — say when
-- they are taken.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
-- `is_available` has meant `vacant AND is_listed` for every type. That is
-- right for a monthly let: a flat with a tenant in it is not on the market for
-- the next year, so it should leave the marketplace.
--
-- It is wrong for a hotel room or a BnB. Those are never "off the market" —
-- a room booked this weekend is still bookable next weekend, and the guest
-- searching in March wants to see it. Under the old rule, marking a room
-- occupied set `is_listed = false` and the room VANISHED from search, so the
-- hotel lost every future booking to hide a stay that ends on Friday.
--
-- ── THE RULE THIS INSTALLS ─────────────────────────────────────────────────
--   monthly (villa/apartment/commercial):  is_available = vacant AND is_listed
--   nightly (hotel/bnb):                   is_available = is_listed
--
-- For nightly units `occupancy_status` no longer decides visibility at all.
-- Whether the room is taken TONIGHT is a question about bookings, answered by
-- room_booked_ranges() below and rendered as "Booked until <date>" — the room
-- stays in the listings the whole time.
--
-- ── ONLY CONFIRMED BOOKINGS HOLD A ROOM ────────────────────────────────────
-- 'confirmed' and 'checked_in' hold it. Everything else does not, and the two
-- exclusions that matter are deliberate:
--
--   'requested'  an online request the desk has NOT accepted yet. Counting it
--                would let any anonymous visitor make a room look taken by
--                submitting a request they never intend to honour — the room
--                would advertise itself as booked on the strength of a
--                stranger's unconfirmed claim. (Note this differs from
--                bookings_no_overlap, which DOES include 'requested': holding
--                the slot against double-booking is a different question from
--                telling the public the room is taken. Both are correct.)
--   'no_show'    the guest never arrived; the room is free and sellable.
--
-- 'cancelled' and 'checked_out' are self-evidently over.
--
-- ── WHY A FUNCTION AND NOT A VIEW ──────────────────────────────────────────
-- `bookings` has no public SELECT policy, and it must not get one: the row
-- carries guest_name, guest_phone, guest_email and notes. A view over it would
-- run with the view owner's rights and quietly bypass that RLS for anyone who
-- later added a column — the classic Postgres footgun.
--
-- A SECURITY DEFINER function that RETURNS ONLY THREE DATE/ID COLUMNS cannot
-- leak a guest no matter what is added to the table later, because the return
-- type is fixed in the signature. What it does publish is that a given room is
-- taken between two dates, which is precisely what an availability calendar is
-- for and is what this change was asked to show.
--
-- RE-RUNNABLE: CREATE OR REPLACE, guarded trigger, idempotent backfill.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION
      E'public.bookings is missing.\n\nApply supabase/migrations/20260807000001_hotel_booking.sql first. Nothing has been changed by this script.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'property_type' AND e.enumlabel = 'bnb'
  ) THEN
    RAISE EXCEPTION
      E'property_type has no ''bnb'' label.\n\nApply 20260819000001_bnb_type.sql first. Nothing has been changed by this script.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Which statuses actually hold a room, in one place.
--
-- IMMUTABLE + inlined by the planner, so the index on bookings(status) is
-- still usable. Having one definition means the public function, the manager's
-- view and any future report cannot disagree about what "booked" means.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_holds_room(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p_status IN ('confirmed', 'checked_in') $$;

COMMENT ON FUNCTION public.booking_holds_room(TEXT) IS
  'True for the statuses that make a room unavailable to the public: confirmed, checked_in. Deliberately excludes requested (unaccepted) and no_show.';


-- -----------------------------------------------------------------------------
-- STEP 2 — The public availability surface.
--
-- Returns current and FUTURE holds for the given rooms — nothing historical,
-- so a caller cannot mine a room's past occupancy. Capped at 12 months so one
-- call cannot be turned into an unbounded scan.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.room_booked_ranges(p_room_ids UUID[])
RETURNS TABLE (room_id UUID, check_in DATE, check_out DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.room_id, b.check_in, b.check_out
    FROM public.bookings b
   WHERE b.room_id = ANY(p_room_ids)
     AND public.booking_holds_room(b.status)
     -- A stay that ended yesterday no longer holds the room. `check_out` is
     -- the departure day and is EXCLUSIVE (see bookings_no_overlap's
     -- daterange(check_in, check_out)), so the room is free ON check_out —
     -- hence `>` and not `>=`, otherwise every room would read as booked for
     -- one extra day and a same-day turnaround would look impossible.
     AND b.check_out > CURRENT_DATE
     AND b.check_in <= (CURRENT_DATE + INTERVAL '12 months')::date
   ORDER BY b.check_in
$$;

REVOKE ALL ON FUNCTION public.room_booked_ranges(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.room_booked_ranges(UUID[]) TO anon, authenticated;

COMMENT ON FUNCTION public.room_booked_ranges(UUID[]) IS
  'Public availability calendar: date ranges only, for confirmed/checked_in stays ending today or later. Returns NO guest data — bookings itself stays unreadable to anon.';


-- -----------------------------------------------------------------------------
-- STEP 3 — Keep is_available honest, per type, in the database.
--
-- Three different client paths write is_available (the create wizard, the
-- occupancy toggle, the listing toggle). 20260805000001 already documents a
-- production row where they drifted into a state the rule says cannot exist.
-- Deriving it here means no client can produce that state again, and the new
-- per-type rule lands everywhere at once instead of in three places that must
-- be kept in step by hand.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.properties_derive_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type IN ('hotel', 'bnb') THEN
    -- Nightly: occupancy_status is bookkeeping for the owner, never a reason
    -- to hide the room. Listing alone decides.
    NEW.is_available := COALESCE(NEW.is_listed, TRUE);
  ELSE
    NEW.is_available := COALESCE(NEW.is_listed, TRUE)
                        AND COALESCE(NEW.occupancy_status, 'vacant') = 'vacant';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_properties_derive_availability ON public.properties;
CREATE TRIGGER trg_properties_derive_availability
  BEFORE INSERT OR UPDATE OF is_listed, occupancy_status, type, is_available
  ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_derive_availability();


-- -----------------------------------------------------------------------------
-- STEP 4 — Put existing rows on the new rule.
--
-- EVERY row is recomputed, not just the nightly ones. `is_available` is now
-- derived by the trigger above and the marketplace filters on it ALONE — the
-- listing pages previously re-checked `occupancy_status` themselves, which is
-- exactly the duplicated rule that let the three columns drift apart in the
-- first place (20260805000001). If this column is going to be the single
-- answer, every row has to actually satisfy it before the clients start
-- trusting it, or a pre-existing drifted row becomes a wrongly-visible or
-- wrongly-hidden listing the moment the second check is removed.
--
-- `is_listed` is NOT changed for anyone. A room the owner deliberately took
-- off the market must stay off it, and nothing in the data distinguishes that
-- from a room the old occupancy toggle unlisted automatically. Re-listing is
-- one switch in Manage.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  nightly_fixed INTEGER := 0;
  monthly_fixed INTEGER := 0;
  still_hidden  INTEGER := 0;
BEGIN
  UPDATE public.properties
     SET is_available = COALESCE(is_listed, TRUE)
   WHERE type IN ('hotel', 'bnb')
     AND is_available IS DISTINCT FROM COALESCE(is_listed, TRUE);
  GET DIAGNOSTICS nightly_fixed = ROW_COUNT;

  UPDATE public.properties
     SET is_available = COALESCE(is_listed, TRUE)
                        AND COALESCE(occupancy_status, 'vacant') = 'vacant'
   WHERE type NOT IN ('hotel', 'bnb')
     AND is_available IS DISTINCT FROM (
           COALESCE(is_listed, TRUE)
           AND COALESCE(occupancy_status, 'vacant') = 'vacant');
  GET DIAGNOSTICS monthly_fixed = ROW_COUNT;

  SELECT COUNT(*) INTO still_hidden
    FROM public.properties
   WHERE type IN ('hotel', 'bnb') AND COALESCE(is_listed, TRUE) = FALSE;

  RAISE NOTICE 'is_available recomputed: % nightly, % monthly row(s) corrected.',
    nightly_fixed, monthly_fixed;
  RAISE NOTICE '% nightly unit(s) are unlisted by owner choice and stay hidden until re-listed in Manage.',
    still_hidden;
END $$;

-- =============================================================================
-- Verify with:
--
--   -- 1. Every nightly row now obeys is_available = is_listed:
--   SELECT count(*) AS violations FROM public.properties
--    WHERE type IN ('hotel','bnb')
--      AND is_available IS DISTINCT FROM COALESCE(is_listed, true);
--   -- expect 0
--
--   -- 2. Occupancy no longer hides a nightly room. On a test hotel row:
--   UPDATE public.properties SET occupancy_status='occupied' WHERE id='<test>';
--   SELECT is_listed, occupancy_status, is_available FROM public.properties WHERE id='<test>';
--   -- expect is_available = true while is_listed is true
--
--   -- 3. …but it still hides a monthly one:
--   UPDATE public.properties SET occupancy_status='occupied' WHERE id='<monthly test>';
--   -- expect is_available = false
--
--   -- 4. anon may call the calendar, and gets dates only:
--   SELECT has_function_privilege('anon','public.room_booked_ranges(uuid[])','EXECUTE');
--   SELECT * FROM public.room_booked_ranges(ARRAY['<room id>']::uuid[]);
--
--   -- 5. anon still CANNOT read the bookings table itself:
--   SET ROLE anon; SELECT count(*) FROM public.bookings; RESET ROLE;
--   -- expect 0 rows (RLS), never guest names
--
--   -- 6. A 'requested' booking does NOT make the room look taken:
--   --    insert one via create_booking_request, then:
--   SELECT * FROM public.room_booked_ranges(ARRAY['<that room>']::uuid[]);
--   -- expect: no row until the desk confirms it
-- =============================================================================
