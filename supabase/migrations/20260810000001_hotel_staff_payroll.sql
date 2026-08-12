-- =============================================================================
-- Migration: 20260810000001_hotel_staff_payroll.sql
--
-- Staff management + payroll for hotel operators.
--
-- The team lives in `hotel_staff` (an hotel EMPLOYEE — receptionist,
-- housekeeping, chef, …). This is deliberately a different concept to Clerk's
-- organization "staff" who can sign into the marketplace; naming it hotel_staff
-- keeps the two from colliding in code and SQL.
--
-- WHAT THIS ADDS:
--   • hotel_staff — the team. Each member has a position (manager /
--     receptionist / housekeeping / chef / security / maintenance / other), a
--     payroll type (monthly salary or daily wage) and their rate, plus
--     contact/active/notes fields.
--   • staff_payroll — one row per payment. `pay_type` says what it is
--     (salary / advance / bonus / penalty), `period_start..period_end` the pay
--     cycle (a month, usually), and `status` tracks pending → paid. Salary rows
--     are seeded by generate_monthly_payroll() (one per member/month, enforced
--     by a partial unique index); advances/bonuses/penalties are added by hand.
--   • generate_monthly_payroll(month_start, month_end) — SECURITY DEFINER RPC
--     that pre-fills a "salary" row for every ACTIVE monthly-rate member who
--     doesn't have one for the month yet, returning how many it added.
--     Daily-wage members are skipped (their take-home depends on shifts worked,
--     so the owner adds those by hand).
--
-- VISIBILITY (same trust line as hotels / hotel bookings — 20260808000001):
--   • Read: rows the operator owns (owner_id = me) OR any member of the agency
--     they belong to (org_id matches active org) OR platform admins.
--   • Create/update/delete: PARITY with hotels — the solo owner, org
--     admin/manager/agent inside the matching agency, or admins. Payroll rows
--     additionally require their member to actually be managed by the user, so
--     you can't book a salary against someone else's team.
--
-- RE-RUNNABLE: policies are dropped dynamically at the top, tables/columns/
-- indexes via IF [NOT] EXISTS, the function via CREATE OR REPLACE.
--
-- PREREQUISITES: 20260805000001 (current_org_id, current_org_role,
--   has_role, update_updated_at_column). Run that to completion first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the tables this file owns, so the CREATE
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
      AND tablename IN ('hotel_staff', 'staff_payroll')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 2 — hotel_staff.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotel_staff (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  owner_id     TEXT        NOT NULL,               -- Clerk id of whoever runs them
  org_id       TEXT,                               -- NULL for solo owners
  name         TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'other',
  phone        TEXT,
  email        TEXT,
  hire_date    DATE,
  payroll_type TEXT        NOT NULL DEFAULT 'monthly',  -- monthly | daily
  salary       NUMERIC(12,2),                      -- monthly salary or daily rate
  active       BOOLEAN     NOT NULL DEFAULT true,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_staff_pkey PRIMARY KEY (id)
);

ALTER TABLE public.hotel_staff DROP CONSTRAINT IF EXISTS hotel_staff_role_check;
ALTER TABLE public.hotel_staff
  ADD CONSTRAINT hotel_staff_role_check
  CHECK (role IN ('manager','receptionist','housekeeping','chef','security','maintenance','other'));

ALTER TABLE public.hotel_staff DROP CONSTRAINT IF EXISTS hotel_staff_payroll_type_check;
ALTER TABLE public.hotel_staff
  ADD CONSTRAINT hotel_staff_payroll_type_check
  CHECK (payroll_type IN ('monthly','daily'));

ALTER TABLE public.hotel_staff DROP CONSTRAINT IF EXISTS hotel_staff_salary_check;
ALTER TABLE public.hotel_staff
  ADD CONSTRAINT hotel_staff_salary_check
  CHECK (salary IS NULL OR salary >= 0);

DROP TRIGGER IF EXISTS update_hotel_staff_updated_at ON public.hotel_staff;
CREATE TRIGGER update_hotel_staff_updated_at
  BEFORE UPDATE ON public.hotel_staff
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_hotel_staff_owner ON public.hotel_staff(owner_id);
CREATE INDEX IF NOT EXISTS idx_hotel_staff_org ON public.hotel_staff(org_id);


-- =============================================================================
-- STEP 3 — staff_payroll.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.staff_payroll (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  staff_id     UUID         NOT NULL REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
  owner_id     TEXT         NOT NULL,
  org_id       TEXT,
  period_start DATE         NOT NULL,
  period_end   DATE         NOT NULL,
  pay_type     TEXT         NOT NULL DEFAULT 'salary',
  amount       NUMERIC(12,2) NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'pending',
  paid_at      TIMESTAMPTZ,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_payroll_pkey PRIMARY KEY (id)
);

ALTER TABLE public.staff_payroll DROP CONSTRAINT IF EXISTS staff_payroll_pay_type_check;
ALTER TABLE public.staff_payroll
  ADD CONSTRAINT staff_payroll_pay_type_check
  CHECK (pay_type IN ('salary','advance','bonus','penalty'));

ALTER TABLE public.staff_payroll DROP CONSTRAINT IF EXISTS staff_payroll_status_check;
ALTER TABLE public.staff_payroll
  ADD CONSTRAINT staff_payroll_status_check
  CHECK (status IN ('pending','paid','cancelled'));

ALTER TABLE public.staff_payroll DROP CONSTRAINT IF EXISTS staff_payroll_amount_check;
ALTER TABLE public.staff_payroll
  ADD CONSTRAINT staff_payroll_amount_check
  CHECK (amount >= 0);

-- One seeded salary row per member per pay period.
DROP INDEX IF EXISTS uq_staff_salary_period;
CREATE UNIQUE INDEX uq_staff_salary_period
  ON public.staff_payroll (staff_id, period_start)
  WHERE pay_type = 'salary';

DROP TRIGGER IF EXISTS update_staff_payroll_updated_at ON public.staff_payroll;
CREATE TRIGGER update_staff_payroll_updated_at
  BEFORE UPDATE ON public.staff_payroll
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_staff_payroll_period ON public.staff_payroll(period_start);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_staff ON public.staff_payroll(staff_id);


-- =============================================================================
-- STEP 4 — public.hotel_staff_managed(): can the current user manage this
--          member? Mirrors hotel_managed(). SECURITY DEFINER so the lookup
--          isn't filtered by hotel_staff's own RLS. Must come after
--          `hotel_staff` exists (LANGUAGE sql resolves tables at create time).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotel_staff_managed(_staff_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hotel_staff s
    WHERE s.id = _staff_id
      AND (
        s.owner_id = auth.jwt()->>'sub'
        OR (
          s.org_id IS NOT NULL
          AND s.org_id = public.current_org_id()
          AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
        )
        OR public.has_role(auth.jwt()->>'sub', 'admin')
      )
  )
$$;


-- =============================================================================
-- STEP 5 — RLS + policies on hotel_staff.
-- =============================================================================
ALTER TABLE public.hotel_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operator or org sees hotel staff" ON public.hotel_staff
  FOR SELECT
  USING (
    owner_id = auth.jwt()->>'sub'
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Operators can add hotel staff" ON public.hotel_staff
  FOR INSERT
  WITH CHECK (
    owner_id = auth.jwt()->>'sub'
    OR (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Operators can update hotel staff" ON public.hotel_staff
  FOR UPDATE
  USING (public.hotel_staff_managed(id))
  WITH CHECK (public.hotel_staff_managed(id));

CREATE POLICY "Operators can delete hotel staff" ON public.hotel_staff
  FOR DELETE
  USING (public.hotel_staff_managed(id));


-- =============================================================================
-- STEP 6 — RLS + policies on staff_payroll (needs hotel_staff_managed: STEP 4).
-- =============================================================================
ALTER TABLE public.staff_payroll ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operator or org sees payroll" ON public.staff_payroll
  FOR SELECT
  USING (
    owner_id = auth.jwt()->>'sub'
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Operators can add payroll" ON public.staff_payroll
  FOR INSERT
  WITH CHECK (
    (owner_id = auth.jwt()->>'sub'
     OR (org_id IS NOT NULL AND org_id = public.current_org_id()
         AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent'))
     OR public.has_role(auth.jwt()->>'sub', 'admin'))
    AND public.hotel_staff_managed(staff_id)
  );

CREATE POLICY "Operators can update payroll" ON public.staff_payroll
  FOR UPDATE
  USING (
    (owner_id = auth.jwt()->>'sub'
     OR (org_id IS NOT NULL AND org_id = public.current_org_id()
         AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent'))
     OR public.has_role(auth.jwt()->>'sub', 'admin'))
    AND public.hotel_staff_managed(staff_id)
  )
  WITH CHECK (
    (owner_id = auth.jwt()->>'sub'
     OR (org_id IS NOT NULL AND org_id = public.current_org_id()
         AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent'))
     OR public.has_role(auth.jwt()->>'sub', 'admin'))
    AND public.hotel_staff_managed(staff_id)
  );

CREATE POLICY "Operators can delete payroll" ON public.staff_payroll
  FOR DELETE
  USING (
    (owner_id = auth.jwt()->>'sub'
     OR (org_id IS NOT NULL AND org_id = public.current_org_id()
         AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent'))
     OR public.has_role(auth.jwt()->>'sub', 'admin'))
    AND public.hotel_staff_managed(staff_id)
  );


-- =============================================================================
-- STEP 7 — generate_monthly_payroll(month_start, month_end)
--
-- Pre-fills the month's "salary" rows for every ACTIVE monthly-rate member the
-- caller manages, skipping anyone who already has one (enforced again by the
-- partial unique index). Daily-wage members are intentionally skipped — their
-- pay depends on shifts worked.
--
-- SECURITY DEFINER: the filter above already restricts to the caller's own
-- members, so this can write without tripping over RLS re-checks.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_monthly_payroll(
  _month_start DATE,
  _month_end   DATE
)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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

-- =============================================================================
-- Verify with:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('hotel_staff','staff_payroll');
--   SELECT generate_monthly_payroll('2026-08-01','2026-08-31');
-- =============================================================================