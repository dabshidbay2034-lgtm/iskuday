-- =============================================================================
-- Migration: 20260910000001_attendance_time_order.sql
--
-- A shift cannot end before it starts.
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────
-- 20260831000001 already constrains attendance well:
--   • UNIQUE (staff_id, date)  — one row per person per day, so the "staff can
--     clock in twice" worry is already impossible at the database level.
--   • CHECK (clock_out IS NULL OR clock_in IS NOT NULL) — no clock-out without
--     a clock-in.
--
-- What neither covers is ORDER. `clock_out < clock_in` is accepted today, which
-- makes the shift a negative length. It is reachable without any bad intent:
-- useOverrideAttendance lets a manager type both times by hand to correct a
-- missed punch, and typing 09:00 into the wrong field is an ordinary slip.
--
-- ── WHY IT IS WORTH A CONSTRAINT ────────────────────────────────────────────
-- Hours worked is the number a person is paid against and argues about. A
-- negative shift does not announce itself — it silently drags a monthly total
-- down, and the staff member who notices has to prove it. Being refused at the
-- moment of the typo, with the row rejected, is the only version of this where
-- nobody has to notice.
--
-- generate_monthly_payroll() does not read these times today, so this is not
-- currently a wrong-wages bug. It is the guard that keeps it from becoming one
-- the day payroll starts reading hours, which is the obvious next feature.
--
-- ── WHY `NOT VALID` ─────────────────────────────────────────────────────────
-- NOT VALID means "enforce from now on, do not scan what is already there". A
-- plain ADD CONSTRAINT scans every existing row and ABORTS THE WHOLE MIGRATION
-- if even one historic row violates it — which would take down a deploy over
-- data that is already recorded and already wrong. New and updated rows are
-- fully checked either way; that is the part that matters.
--
-- Existing bad rows are REPORTED below rather than altered. Guessing which of
-- the two timestamps a human meant is not something a migration should do.
-- Once the report is empty, the constraint can be promoted with:
--     ALTER TABLE public.staff_attendance VALIDATE CONSTRAINT staff_attendance_clock_order_check;
--
-- RE-RUNNABLE: guarded through pg_constraint.
-- PRECONDITIONS: 20260831000001 (staff_attendance).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.staff_attendance') IS NULL THEN
    RAISE EXCEPTION 'Cannot apply 20260910000001: public.staff_attendance is missing [20260831000001]';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.staff_attendance'::regclass
       AND conname  = 'staff_attendance_clock_order_check'
  ) THEN
    ALTER TABLE public.staff_attendance
      ADD CONSTRAINT staff_attendance_clock_order_check
      CHECK (clock_out IS NULL OR clock_in IS NULL OR clock_out > clock_in)
      NOT VALID;
    RAISE NOTICE 'Added staff_attendance_clock_order_check (enforced on new and updated rows).';
  END IF;
END $$;

-- ── Report, do not repair ────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad INT;
  r     RECORD;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.staff_attendance
   WHERE clock_in IS NOT NULL AND clock_out IS NOT NULL AND clock_out <= clock_in;

  IF v_bad = 0 THEN
    RAISE NOTICE 'No attendance rows end before they start. The constraint can be VALIDATEd.';
  ELSE
    RAISE WARNING 'ATTENDANCE: % existing row(s) end at or before their start time. Listed below; fix them by hand, then VALIDATE the constraint.', v_bad;
    FOR r IN
      SELECT id, staff_id, date, clock_in, clock_out
        FROM public.staff_attendance
       WHERE clock_in IS NOT NULL AND clock_out IS NOT NULL AND clock_out <= clock_in
       ORDER BY date DESC
       LIMIT 25
    LOOP
      RAISE WARNING '  % staff=% date=% in=% out=%', r.id, r.staff_id, r.date, r.clock_in, r.clock_out;
    END LOOP;
  END IF;
END $$;
