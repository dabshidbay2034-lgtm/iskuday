-- =============================================================================
-- Migration: 20260903000001_fix_attendance_timezone.sql
--
-- FIXES A CRITICAL CORRECTNESS BUG in derive_attendance_status().
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- 20260831000001 and 20260902000001 both compared a TIMESTAMPTZ to a TIME by
-- casting:
--
--     IF NEW.clock_in::time > v_scheduled_start THEN ...
--
-- `timestamptz::time` resolves through the SESSION TimeZone setting, which on
-- Supabase/PostgREST is UTC. Mogadishu is UTC+3, so every comparison was made
-- three hours off — and in opposite directions for the two branches:
--
--   local 09:00 clock-in  -> 06:00 UTC -> 06:00 > 09:00 false -> 'present'  ok
--   local 12:00 clock-in  -> 09:00 UTC -> 09:00 > 09:00 false -> 'present'  WRONG (3h late)
--   local 18:00 clock-out -> 15:00 UTC -> 15:00 < 18:00 TRUE  -> 'early_leave' WRONG (full shift)
--
-- So staff up to three hours late were recorded present, and staff who worked
-- their exact shift were recorded as leaving early. The feature reported the
-- opposite of the truth.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- Convert explicitly with AT TIME ZONE before taking the time part.
--
--     (NEW.clock_in AT TIME ZONE public.attendance_timezone())::time
--
-- `timestamptz AT TIME ZONE 'zone'` yields a TIMESTAMP (no zone) rendered in
-- that zone, which is exactly the local wall-clock reading the schedule is
-- expressed in. Because the zone is named rather than a fixed offset, DST is
-- handled by Postgres — Somalia has none today, but a future tenant elsewhere
-- may, and a hard-coded '+03' offset would silently break for them.
--
-- The zone lives in a function rather than a literal so there is ONE place to
-- change when the platform serves a second timezone. Making it a real per-hotel
-- column is the correct long-term answer; this keeps the surface small until
-- that is actually needed.
--
-- RE-RUNNABLE: CREATE OR REPLACE only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — The platform's operating timezone, in one place.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_timezone()
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'Africa/Mogadishu'::text
$$;

COMMENT ON FUNCTION public.attendance_timezone() IS
  'The wall-clock timezone staff schedules are expressed in. Attendance compares clock_in/clock_out against hotel_staff.scheduled_start/end in THIS zone, never in the session zone (which is UTC on Supabase). Change here to move the platform, or replace with a per-hotel column when more than one zone is served.';


-- -----------------------------------------------------------------------------
-- STEP 2 — Re-create the trigger function with explicit zone conversion.
--
-- Everything else is unchanged from 20260902000001: the staff schedule is still
-- read from hotel_staff, still falls back to the row defaults, and is still
-- stamped onto the row. Only the two comparisons move into local time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_attendance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_scheduled_start TIME;
  v_scheduled_end   TIME;
  v_zone            TEXT := public.attendance_timezone();
  v_in_local        TIME;
  v_out_local       TIME;
BEGIN
  -- Pull the staff member's schedule from hotel_staff.
  SELECT s.scheduled_start, s.scheduled_end
    INTO v_scheduled_start, v_scheduled_end
    FROM public.hotel_staff s
   WHERE s.id = NEW.staff_id;

  -- Fall back to the row's own defaults if the staff row doesn't exist.
  IF v_scheduled_start IS NULL THEN
    v_scheduled_start := NEW.scheduled_start;
  END IF;
  IF v_scheduled_end IS NULL THEN
    v_scheduled_end := NEW.scheduled_end;
  END IF;

  -- Stamp the resolved schedule onto the row so reads are fast.
  NEW.scheduled_start := v_scheduled_start;
  NEW.scheduled_end   := v_scheduled_end;

  -- THE FIX: read the punch as local wall-clock time, not as UTC.
  v_in_local  := CASE WHEN NEW.clock_in  IS NULL THEN NULL
                      ELSE (NEW.clock_in  AT TIME ZONE v_zone)::time END;
  v_out_local := CASE WHEN NEW.clock_out IS NULL THEN NULL
                      ELSE (NEW.clock_out AT TIME ZONE v_zone)::time END;

  -- Auto-derive status when caller didn't explicitly set it.
  IF TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.clock_in IS NULL THEN
      NEW.status := 'absent';
    ELSE
      NEW.status := 'present';
      IF v_in_local > v_scheduled_start THEN
        NEW.status := 'late';
      END IF;
      IF v_out_local IS NOT NULL AND v_out_local < v_scheduled_end THEN
        NEW.status := 'early_leave';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Verify with:
--   -- 09:00 local on a 09:00-18:00 shift must be 'present', NOT 'late':
--   SELECT ('2026-08-15 09:00+03'::timestamptz AT TIME ZONE public.attendance_timezone())::time
--            > '09:00'::time AS should_be_false;
--   -- 18:00 local must NOT be 'early_leave':
--   SELECT ('2026-08-15 18:00+03'::timestamptz AT TIME ZONE public.attendance_timezone())::time
--            < '18:00'::time AS should_be_false;
--   -- 12:00 local on a 09:00 shift MUST be late:
--   SELECT ('2026-08-15 12:00+03'::timestamptz AT TIME ZONE public.attendance_timezone())::time
--            > '09:00'::time AS should_be_true;
-- =============================================================================
