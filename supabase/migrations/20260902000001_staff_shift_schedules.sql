-- =============================================================================
-- Migration: 20260902000001_staff_shift_schedules.sql
--
-- Adds per-staff shift schedule columns to hotel_staff so each employee has
-- their own expected clock-in/clock-out times. The attendance trigger
-- (20260831000001) is updated to prefer the staff member's schedule over the
-- table-level defaults.
--
-- PREREQUISITES: 20260831000001_staff_attendance.sql (staff_attendance table
--   + derive_attendance_status trigger function).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Add schedule columns to hotel_staff
-- -----------------------------------------------------------------------------
ALTER TABLE public.hotel_staff
  ADD COLUMN IF NOT EXISTS scheduled_start TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS scheduled_end   TIME NOT NULL DEFAULT '18:00';

COMMENT ON COLUMN public.hotel_staff.scheduled_start IS
  'Expected shift start time for this staff member (used by attendance).';
COMMENT ON COLUMN public.hotel_staff.scheduled_end IS
  'Expected shift end time for this staff member (used by attendance).';


-- -----------------------------------------------------------------------------
-- STEP 2 — Re-create the attendance trigger function so it reads the staff
--          member's scheduled times from hotel_staff instead of the row defaults.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_attendance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_scheduled_start TIME;
  v_scheduled_end   TIME;
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

  -- Auto-derive status when caller didn't explicitly set it.
  IF TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.clock_in IS NULL THEN
      NEW.status := 'absent';
    ELSE
      NEW.status := 'present';
      IF NEW.clock_in::time > v_scheduled_start THEN
        NEW.status := 'late';
      END IF;
      IF NEW.clock_out IS NOT NULL AND NEW.clock_out::time < v_scheduled_end THEN
        NEW.status := 'early_leave';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- Verify with:
--   SELECT scheduled_start, scheduled_end FROM public.hotel_staff LIMIT 5;
-- =============================================================================