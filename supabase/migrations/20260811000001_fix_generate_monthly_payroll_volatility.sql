-- =============================================================================
-- Migration: 20260811000001_fix_generate_monthly_payroll_volatility.sql
--
-- Fixes: generate_monthly_payroll() was declared STABLE but INSERTs.
--
-- Postgres runs a non-VOLATILE function against a read-only snapshot, so the
-- moment the loop body actually had a row to write it raised:
--
--   ERROR: INSERT is not allowed in a non-volatile function  (SQLSTATE 0A000)
--
-- The failure hid in the case people try first: when every active staff member
-- already had a salary row for the month, the loop body never executed, the
-- function returned 0, and the UI reported the cheerful "Nothing to add —
-- everyone active already has a salary row". So "Generate month" looked like it
-- worked right up until it had actual work to do.
--
-- VOLATILE is the default, so the keyword is simply dropped. THE BODY BELOW IS
-- COPIED VERBATIM from 20260810000001_hotel_staff_payroll.sql — same two-date
-- signature, same JWT-derived owner/org, same `salary > 0` guard, same
-- period_end/note columns, same SECURITY DEFINER + search_path. The ONLY
-- difference is the removed STABLE keyword. Keep it that way: a CREATE OR
-- REPLACE that also "tidies" the body would change payroll behaviour silently.
--
-- RE-RUNNABLE: CREATE OR REPLACE, no other DDL.
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.generate_monthly_payroll(date, date)') IS NULL THEN
    RAISE EXCEPTION
      'generate_monthly_payroll(date, date) not found — apply 20260810000001_hotel_staff_payroll.sql first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.generate_monthly_payroll(
  _month_start DATE,
  _month_end   DATE
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user  TEXT := auth.jwt()->>'sub';
  v_org   TEXT := public.current_org_id();
  v_count INTEGER := 0;
  v_row   RECORD;
BEGIN
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_row IN
    SELECT s.id, s.salary
    FROM public.hotel_staff s
    WHERE s.active = true
      AND s.payroll_type = 'monthly'
      AND (s.owner_id = v_user
           OR (s.org_id IS NOT NULL AND v_org IS NOT NULL AND s.org_id = v_org)
           OR public.has_role(v_user, 'admin'))
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_payroll p
        WHERE p.staff_id = s.id
          AND p.period_start = _month_start
          AND p.pay_type = 'salary'
      )
  LOOP
    IF v_row.salary IS NOT NULL AND v_row.salary > 0 THEN
      INSERT INTO public.staff_payroll
        (staff_id, owner_id, org_id, period_start, period_end, pay_type, amount, status, note)
      VALUES
        (v_row.id, v_user, v_org, _month_start, _month_end, 'salary', v_row.salary, 'pending', 'Monthly salary');
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.generate_monthly_payroll(DATE, DATE) IS
  'Seeds one pending salary row per active monthly-rate staff member for the month. VOLATILE: it writes.';

-- =============================================================================
-- Verify with:
--   SELECT provolatile FROM pg_proc
--    WHERE oid = 'public.generate_monthly_payroll(date,date)'::regprocedure;
--   -- expect 'v' (volatile). 's' means this migration did not take.
-- =============================================================================
