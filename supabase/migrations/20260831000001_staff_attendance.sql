-- =============================================================================
-- Migration: 20260831000001_staff_attendance.sql
--
-- Tracks daily attendance for hotel staff (clock-in/out, scheduled shifts).
-- Complements hotel_staff (20260810000001) and staff_payroll.
--
-- Each row = one staff member × one day. The combination of date + check-out
-- determines attendance status:
--
--   present      clocked in and out (or still clocked in)
--   absent       no clock-in recorded (entire day missed)
--   late         clocked in after scheduled_start
--   early_leave  clocked out before scheduled_end
--
-- The primary key is (staff_id, date) — one attendance record per person per day.
--
-- PRECONDITIONS: 20260810000001_hotel_staff_payroll.sql (public.hotel_staff)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — staff_attendance table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  staff_id        UUID        NOT NULL REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
  owner_id        TEXT        NOT NULL,               -- Clerk id of the operator (denormalised for RLS)
  org_id          TEXT,                               -- mirror from hotel_staff
  date            DATE        NOT NULL DEFAULT CURRENT_DATE,
  clock_in        TIMESTAMPTZ,                        -- actual clock-in time
  clock_out       TIMESTAMPTZ,                        -- actual clock-out time
  scheduled_start TIME        NOT NULL DEFAULT '09:00', -- expected shift start
  scheduled_end   TIME        NOT NULL DEFAULT '18:00', -- expected shift end
  status          TEXT        NOT NULL DEFAULT 'present',
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_attendance_pkey PRIMARY KEY (id),
  CONSTRAINT uq_staff_attendance_date UNIQUE (staff_id, date),
  CONSTRAINT staff_attendance_status_check CHECK (status IN (
    'present', 'absent', 'late', 'early_leave', 'on_leave'
  )),
  CONSTRAINT staff_attendance_clock_check CHECK (
    clock_out IS NULL OR clock_in IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON public.staff_attendance(date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff ON public.staff_attendance(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_owner ON public.staff_attendance(owner_id);

DROP TRIGGER IF EXISTS update_staff_attendance_updated_at ON public.staff_attendance;
CREATE TRIGGER update_staff_attendance_updated_at
  BEFORE UPDATE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.staff_attendance IS
  'Daily attendance records for hotel staff. One row per staff_id per date.';
COMMENT ON COLUMN public.staff_attendance.clock_in IS
  'Actual time the staff member clocked in / arrived. NULL = no record yet.';
COMMENT ON COLUMN public.staff_attendance.scheduled_start IS
  'When the staff member was supposed to start (from their shift schedule). Default 09:00.';
COMMENT ON COLUMN public.staff_attendance.status IS
  'present | absent | late | early_leave | on_leave. Auto-derived but can be overridden.';


-- -----------------------------------------------------------------------------
-- STEP 2 — RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;

-- SELECT: operator (owner + org) sees their staff, platform admin sees all.
DROP POLICY IF EXISTS "Staff owner or org sees attendance" ON public.staff_attendance;
CREATE POLICY "Staff owner or org sees attendance" ON public.staff_attendance
  FOR SELECT
  USING (
    owner_id = auth.jwt()->>'sub'
    OR (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent', 'org:viewer')
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- INSERT/UPDATE/DELETE: same as hotel_staff — the operator or org admin/manager.
DROP POLICY IF EXISTS "Staff operators can manage attendance" ON public.staff_attendance;
CREATE POLICY "Staff operators can manage attendance" ON public.staff_attendance
  FOR INSERT
  WITH CHECK (
    owner_id = auth.jwt()->>'sub'
    OR (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Staff operators can update attendance" ON public.staff_attendance
  FOR UPDATE
  USING (
    owner_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  )
  WITH CHECK (
    owner_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Staff operators can delete attendance" ON public.staff_attendance
  FOR DELETE
  USING (
    owner_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );


-- -----------------------------------------------------------------------------
-- STEP 3 — Auto-derive status on INSERT/UPDATE (trigger).
--
-- When clock_in is set, derive late status from scheduled_start.
-- When clock_out is set, derive early_leave status from scheduled_end.
-- Status can be manually overridden by setting it explicitly.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_attendance_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only auto-derive if status wasn't explicitly set in the UPDATE
  IF TG_OP = 'INSERT' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.clock_in IS NULL THEN
      NEW.status := 'absent';
    ELSE
      NEW.status := 'present';
      IF NEW.clock_in::time > NEW.scheduled_start THEN
        NEW.status := 'late';
      END IF;
      IF NEW.clock_out IS NOT NULL AND NEW.clock_out::time < NEW.scheduled_end THEN
        NEW.status := 'early_leave';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_attendance_status ON public.staff_attendance;
CREATE TRIGGER trg_derive_attendance_status
  BEFORE INSERT OR UPDATE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.derive_attendance_status();


-- =============================================================================
-- Verify with:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'staff_attendance';
--   -- Expect 12+ columns.
-- =============================================================================