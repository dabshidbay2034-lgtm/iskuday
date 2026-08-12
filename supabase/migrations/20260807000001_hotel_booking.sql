-- =============================================================================
-- Migration: 20260807000001_hotel_booking.sql
--
-- Adds a hotel management + booking system on top of the PMS foundation
-- (20260805000001) and the maintenance/expenses/lease/staff migration
-- (20260806000001).
--
-- DESIGN (extends plan §8 D3 — a hotel's units stay ordinary `properties` rows):
--   There is deliberately NO parent "hotels" table and NO separate "rooms"
--   table. A hotel's rooms ARE `public.properties` rows with
--   `type = 'hotel'` and `is_daily_rate = true`. Booking keys off the SAME
--   `property_id` the rent ledger, expenses, maintenance, utilities and lease
--   documents already use, so everything that already works per unit keeps
--   working per room without a parallel schema. A "hotel" is simply the set of
--   hotel-type properties a user manages (agency units + their own + assigned).
--
-- WHAT THIS MIGRATION ADDS:
--   • bookings          — one reservation per room per stay. Night-based:
--                          check_out is the morning the room is released
--                          (daterange(check_in, check_out) is right-open, which
--                          is exactly the right semantics for overnight stays).
--                          Overlapping active bookings on the same room are
--                          IMPOSSIBLE at the database level via a gist EXCLUDE
--                          constraint, not just in the UI.
--   • housekeeping_tasks — the room-turnaround log (clean / deep-clean /
--                          inspection / maintenance) between stays.
--   • create_booking_request() — a SECURITY DEFINER RPC used by the PUBLIC
--                          booking form on a room's detail page. It validates
--                          the room, computes the total and stores a
--                          'requested' booking with org_id derived from the
--                          property row — so an anonymous visitor never writes
--                          org_id, and the manager simply confirms the request.
--
-- ACCESS MODEL (same three branches as 20260806000001):
--   (org_id IS NOT NULL AND org_id = current_org_id())   -- agency path
--   OR owns_property(property_id / room_id)               -- solo-owner path
--   OR is_assigned_staff(property_id / room_id)           -- per-property staff
--
--   VIEW: any org member + owner + assigned staff.
--   MANAGE (create/update/transition/cancel + housekeeping): org admin/manager/
--         agent + owner + assigned staff — a caretaker or agent runs the desk.
--
-- RE-RUNNABLE: every policy on the tables this file owns is dropped at the top,
-- then recreated (same pattern as the foundation migration STEP 1).
--
-- PREREQUISITES: 20260805000001 (current_org_id, current_org_role,
--   owns_property, update_updated_at_column) AND 20260806000001
--   (is_assigned_staff). Run both to completion first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT. Fail loudly if the prerequisite helpers are absent.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_id'
  ) THEN missing := array_append(missing, 'public.current_org_id()'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_role'
  ) THEN missing := array_append(missing, 'public.current_org_role()'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'owns_property'
  ) THEN missing := array_append(missing, 'public.owns_property(uuid)'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_assigned_staff'
  ) THEN missing := array_append(missing, 'public.is_assigned_staff(uuid)'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Hotel/booking migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun the foundation + expenses/maintenance/staff migrations first. Nothing has been changed by this script.',
      array_to_string(missing, ', ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — The gist index backing the booking overlap guard. btree_gist lets a
--          normal (room_id, daterange) EXCLUDE constraint use = and &&. Only
--          needs to exist once; IF NOT EXISTS keeps it re-runnable.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- -----------------------------------------------------------------------------
-- STEP 2 — Drop every RLS policy on the tables this file owns, so the CREATE
--          POLICY statements below can never hit 42710 on a re-run.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('bookings', 'housekeeping_tasks')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 3 — bookings.
--
-- Night-based (check_out is the release morning). Guest details live ON the
-- reservation (repeat-guest lookup is a future enhancement; storing them here
-- keeps every booking reachable through room_id without a shared-guests
-- reachability problem under the three-branch RLS).
--
-- Overlap guard: only the ACTIVE states (requested / confirmed / checked_in)
-- block a room. cancelled / no_show / checked_out release the dates.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  room_id        UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- NULLABLE: a solo owner's room has no org; reachability is via owns_property.
  org_id         TEXT,
  guest_name     TEXT        NOT NULL,
  guest_phone    TEXT,                                -- private, never public
  guest_email    TEXT,
  check_in       DATE        NOT NULL,
  check_out      DATE        NOT NULL,
  adults         INT         NOT NULL DEFAULT 1,
  children       INT         NOT NULL DEFAULT 0,
  rate_per_night NUMERIC     NOT NULL DEFAULT 0,
  total_amount   NUMERIC     NOT NULL DEFAULT 0,
  amount_paid    NUMERIC     NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'requested',
  source         TEXT        NOT NULL DEFAULT 'walk_in',
  notes          TEXT,
  created_by     TEXT,                                 -- Clerk id
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bookings_pkey PRIMARY KEY (id)
);

-- Idempotent for databases where an earlier run made org_id NOT NULL.
ALTER TABLE public.bookings ALTER COLUMN org_id DROP NOT NULL;

-- Sanity: a stay must have a positive number of nights.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_dates_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_dates_check
  CHECK (check_out > check_in);

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_amounts_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_amounts_check
  CHECK (amount_paid >= 0 AND total_amount >= 0 AND rate_per_night >= 0
         AND adults >= 1 AND children >= 0);

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('requested', 'confirmed', 'checked_in', 'checked_out',
                    'cancelled', 'no_show'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_source_check
  CHECK (source IN ('online', 'walk_in', 'phone', 'agent', 'admin'));

-- THE DOUBLE-BOOKING GUARD. Two ACTIVE stays on the same room cannot overlap,
-- no matter how the write is attempted.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in, check_out) WITH &&
  ) WHERE (status IN ('requested', 'confirmed', 'checked_in'));

CREATE INDEX IF NOT EXISTS idx_bookings_room      ON public.bookings(room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_org       ON public.bookings(org_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status    ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON public.bookings(room_id, check_in, check_out);

DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Read: any org member, the unit owner, or per-property staff.
CREATE POLICY "Org members, assigned staff or owner can read bookings" ON public.bookings
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

-- Create / update / transition: org staff (incl. agents), owner or assigned
-- staff run the desk.
CREATE POLICY "Org staff, assigned staff or owner can create bookings" ON public.bookings
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can update bookings" ON public.bookings
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

CREATE POLICY "Org managers, assigned staff or owner can cancel bookings" ON public.bookings
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );


-- =============================================================================
-- STEP 4 — housekeeping_tasks: the room-turnaround log between guests.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.housekeeping_tasks (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  room_id       UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id        TEXT,
  task_type     TEXT        NOT NULL DEFAULT 'clean',
  status        TEXT        NOT NULL DEFAULT 'pending',
  scheduled_at  DATE,
  assigned_to   TEXT,                                 -- Clerk id (optional)
  notes         TEXT,
  created_by    TEXT,                                 -- Clerk id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT housekeeping_tasks_pkey PRIMARY KEY (id)
);

ALTER TABLE public.housekeeping_tasks ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.housekeeping_tasks DROP CONSTRAINT IF EXISTS housekeeping_tasks_type_check;
ALTER TABLE public.housekeeping_tasks
  ADD CONSTRAINT housekeeping_tasks_type_check
  CHECK (task_type IN ('clean', 'deep_clean', 'inspection', 'maintenance'));

ALTER TABLE public.housekeeping_tasks DROP CONSTRAINT IF EXISTS housekeeping_tasks_status_check;
ALTER TABLE public.housekeeping_tasks
  ADD CONSTRAINT housekeeping_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'done', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_housekeeping_room  ON public.housekeeping_tasks(room_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_org   ON public.housekeeping_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_housekeeping_status ON public.housekeeping_tasks(org_id, status);

DROP TRIGGER IF EXISTS update_housekeeping_tasks_updated_at ON public.housekeeping_tasks;
CREATE TRIGGER update_housekeeping_tasks_updated_at
  BEFORE UPDATE ON public.housekeeping_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.housekeeping_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members, assigned staff or owner can read housekeeping" ON public.housekeeping_tasks
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can create housekeeping" ON public.housekeeping_tasks
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can update housekeeping" ON public.housekeeping_tasks
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );

CREATE POLICY "Org managers, assigned staff or owner can remove housekeeping" ON public.housekeeping_tasks
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(room_id)
    OR public.is_assigned_staff(room_id)
  );


-- =============================================================================
-- STEP 5 — create_booking_request(): the PUBLIC booking form's entry point.
--
-- SECURITY DEFINER so an anonymous/signed-in visitor can request a stay without
-- ever writing org_id (which is derived from the property row) or lying about
-- amounts (computed here). The overlap guard above still applies, so the room
-- cannot be double-requested. The stored status is 'requested'; the manager
-- confirms or cancels it from the hotel dashboard / room page.
-- =============================================================================
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

  -- Only nightly-rate hotel rooms are bookable.
  IF (v_prop.type IS DISTINCT FROM 'hotel') OR (v_prop.is_daily_rate IS NOT TRUE) THEN
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

GRANT EXECUTE ON FUNCTION public.create_booking_request(
  uuid, date, date, int, int, text, text, text, text
) TO anon, authenticated;

-- =============================================================================
-- Verify with:
--   -- no new table has a public SELECT policy:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('bookings','housekeeping_tasks') AND cmd='SELECT';
--   -- the overlap guard is live:
--   SELECT conname, contype FROM pg_constraint
--    WHERE conname = 'bookings_no_overlap';
-- =============================================================================
