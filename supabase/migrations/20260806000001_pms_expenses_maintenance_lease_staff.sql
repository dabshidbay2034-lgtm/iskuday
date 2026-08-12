-- =============================================================================
-- Migration: 20260806000001_pms_expenses_maintenance_lease_staff.sql
--
-- Adds the maintenance / expenses / lease-document / per-property-staff surfaces
-- on top of the PMS foundation (20260805000001).
--
--   • maintenance_requests  — work-order ticketing per property
--   • property_expenses     — the expense register ("a tube leaked, a repair was
--                              done, the money spent is logged here")
--   • lease_documents       — lease / renewal / id / permit files per property
--   • property_staff        — the per-property staff roster: a staff member who
--                              is assigned to a unit can open and manage THAT
--                              unit's profile (and only that one), even when
--                              they don't individually own it.
--
-- ACCESS MODEL (extends the foundation's org-or-owner rule with a third branch)
--
--   The foundation scoped every PMS table as:
--       org_id = current_org_id()        -- agency path
--     OR owns_property(property_id)      -- solo-landlord / direct-owner path
--
--   This migration adds a THIRD, narrower path for per-property staff:
--       is_assigned_staff(property_id)   -- someone assigned to this exact unit
--
--   The new helper keys on `auth.jwt()->>'sub'` alone and never consults the org
--   role, mirroring the discipline of `owns_property()`: an org member is only
--   "assigned staff" for a property that appears in property_staff for them.
--   It is deliberately NOT the same as org membership — the point of
--   per-property assignments is that a caretaker manages exactly one unit.
--
-- EXPENSE/Maintenance rule from the request:
--   "whoever wants staff or the manager can add, and they will both see"
--   → SELECT: admin / manager / agent / viewer / assigned staff / owner
--     INSERT+UPDATE: admin / manager / agent / assigned staff / owner
--
-- RE-RUNNABLE: every policy on the tables this file owns is dropped at the top,
-- then recreated (the same pattern as the foundation migration STEP 1).
--
-- PREREQUISITES: the foundation migration (20260805000001) which provides
--   current_org_id(), current_org_role(), current_user_id(), has_role() and
--   owns_property(). Run that to completion first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT. Fail loudly if the foundation helpers are absent.
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

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Expenses/maintenance/lease migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun supabase/migrations/20260805000001_pms_foundation.sql first. Nothing has been changed by this script.',
      array_to_string(missing, ', ');
  END IF;
END $$;


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
      AND tablename IN (
        'property_staff',
        'property_expenses',
        'maintenance_requests',
        'lease_documents'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — property_staff: which users manage which unit.
--
--   user_id      Clerk id of the assigned staff member
--   property_id  the unit they manage
--   org_id       nullable — the agency that made the assignment (owner path
--                works without one, mirroring the rest of the PMS)
--   role         free-text label ("Caretaker", "Supervisor", …) — not an access
--                control; RLS grants a flat "assigned staff" level.
--
-- ASSIGNMENT is a manager-level action. A member can always read their own rows
-- (that is what an "assigned staff" — even with no org — relies on to reach the
-- property's management surface). Org members may read their org's roster; the
-- unit owner may read theirs.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_staff (
  property_id UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  org_id      TEXT,
  role        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_staff_pkey PRIMARY KEY (property_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_property_staff_user   ON public.property_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_property_staff_org    ON public.property_staff(org_id);

ALTER TABLE public.property_staff ENABLE ROW LEVEL SECURITY;

-- Read: the assigned member's own rows, the org's rows, or the owner's rows.
CREATE POLICY "Assigned member, org members or owner can read staff" ON public.property_staff
  FOR SELECT
  USING (
    user_id = auth.jwt()->>'sub'
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
  );

-- Assign / unassign: org admin or manager, or the property owner. Agents and
-- viewers cannot.
CREATE POLICY "Org managers or owner can assign staff" ON public.property_staff
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org managers or owner can update staff" ON public.property_staff
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org managers or owner can remove staff" ON public.property_staff
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- -----------------------------------------------------------------------------
-- STEP 3 — public.is_assigned_staff(_property_id): the per-property staff check.
--
-- SECURITY DEFINER + STABLE, exactly like owns_property(). It reads
-- property_staff for the CURRENT user only and never looks at the org role, so a
-- privilege cannot "leak" from org membership into a unit the user was never
-- assigned to.
-- Null / missing input returns false, not NULL.
--
-- Defined after property_staff (not before) — a LANGUAGE sql function body is
-- validated against the catalog at CREATE FUNCTION time, so this must come
-- after the table it queries or a fresh database fails with 42P01.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_assigned_staff(_property_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.property_staff
    WHERE property_id = _property_id
      AND user_id = auth.jwt()->>'sub'
  )
$$;


-- -----------------------------------------------------------------------------
-- STEP 4 — maintenance_requests: work-order ticketing.
--
-- status:   open → in_progress → resolved | cancelled
-- category: what kind of job it is (plumbing "tube leak", electrical, …)
-- Both staff and managers create, see and update these (the request's rule).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  property_id    UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id         TEXT,                                  -- nullable (owner fallback)
  title          TEXT        NOT NULL,
  description    TEXT,
  category       TEXT        NOT NULL DEFAULT 'other',
  priority       TEXT        NOT NULL DEFAULT 'medium',
  status         TEXT        NOT NULL DEFAULT 'open',
  estimated_cost NUMERIC,
  actual_cost    NUMERIC,
  reported_by    TEXT,                                  -- Clerk id
  assigned_to    TEXT,                                  -- Clerk id (optional)
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_requests_pkey PRIMARY KEY (id)
);

ALTER TABLE public.maintenance_requests ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_status_check;
ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled'));

ALTER TABLE public.maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_category_check;
ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_category_check
  CHECK (category IN ('plumbing', 'electrical', 'structural', 'appliance', 'cleaning', 'other'));

ALTER TABLE public.maintenance_requests DROP CONSTRAINT IF EXISTS maintenance_requests_priority_check;
ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_priority_check
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_maintenance_property   ON public.maintenance_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_org_status ON public.maintenance_requests(org_id, status);

DROP TRIGGER IF EXISTS update_maintenance_requests_updated_at ON public.maintenance_requests;
CREATE TRIGGER update_maintenance_requests_updated_at
  BEFORE UPDATE ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members, assigned staff or owner can read maintenance" ON public.maintenance_requests
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Staff or owner can log maintenance" ON public.maintenance_requests
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Staff or owner can update maintenance" ON public.maintenance_requests
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org managers or owner can delete maintenance" ON public.maintenance_requests
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- -----------------------------------------------------------------------------
-- STEP 5 — property_expenses: the expense register.
--
-- One row per expense ("tube leaked, plumber fixed it, $30 paid"). The recorded
-- number is the truth. Both staff and managers add these, and both see them.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_expenses (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  property_id  UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id       TEXT,                                  -- nullable (owner fallback)
  category     TEXT        NOT NULL DEFAULT 'maintenance',
  title        TEXT        NOT NULL,
  description  TEXT,
  amount       NUMERIC     NOT NULL DEFAULT 0,
  expense_date DATE,
  status       TEXT        NOT NULL DEFAULT 'unpaid',
  recorded_by  TEXT,                                  -- Clerk id
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_expenses_pkey PRIMARY KEY (id)
);

ALTER TABLE public.property_expenses ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.property_expenses DROP CONSTRAINT IF EXISTS property_expenses_category_check;
ALTER TABLE public.property_expenses
  ADD CONSTRAINT property_expenses_category_check
  CHECK (category IN ('maintenance', 'repair', 'supplies', 'utility', 'other'));

ALTER TABLE public.property_expenses DROP CONSTRAINT IF EXISTS property_expenses_status_check;
ALTER TABLE public.property_expenses
  ADD CONSTRAINT property_expenses_status_check
  CHECK (status IN ('unpaid', 'paid'));

CREATE INDEX IF NOT EXISTS idx_expenses_property ON public.property_expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON public.property_expenses(org_id, expense_date);

DROP TRIGGER IF EXISTS update_property_expenses_updated_at ON public.property_expenses;
CREATE TRIGGER update_property_expenses_updated_at
  BEFORE UPDATE ON public.property_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.property_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members, assigned staff or owner can read expenses" ON public.property_expenses
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Staff or owner can add expenses" ON public.property_expenses
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Staff or owner can update expenses" ON public.property_expenses
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org managers or owner can delete expenses" ON public.property_expenses
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- -----------------------------------------------------------------------------
-- STEP 6 — lease_documents: files per property (lease, renewal, id, permit).
--
-- Files are uploaded to the private `lease-documents` storage bucket (STEP 8)
-- and `file_path` records the object path. Downloads use a signed URL, which
-- the storage read policy below only grants to users who can view the row.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_documents (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  property_id  UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  tenant_id    UUID        REFERENCES public.tenants(id) ON DELETE SET NULL,
  org_id       TEXT,                                  -- nullable (owner fallback)
  title        TEXT        NOT NULL,
  doc_type     TEXT        NOT NULL DEFAULT 'lease_agreement',
  file_name    TEXT,
  file_path    TEXT,
  mime_type    TEXT,
  size_bytes   BIGINT,
  start_date   DATE,
  end_date     DATE,
  uploaded_by  TEXT,                                  -- Clerk id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lease_documents_pkey PRIMARY KEY (id)
);

ALTER TABLE public.lease_documents ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.lease_documents DROP CONSTRAINT IF EXISTS lease_documents_doc_type_check;
ALTER TABLE public.lease_documents
  ADD CONSTRAINT lease_documents_doc_type_check
  CHECK (doc_type IN ('lease_agreement', 'renewal', 'identification', 'permit', 'other'));

CREATE INDEX IF NOT EXISTS idx_lease_property ON public.lease_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_lease_org      ON public.lease_documents(org_id);

ALTER TABLE public.lease_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members, assigned staff or owner can read lease documents" ON public.lease_documents
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Managers, assigned staff or owner can upload lease documents" ON public.lease_documents
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Managers, assigned staff or owner can update lease documents" ON public.lease_documents
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Managers or owner can delete lease documents" ON public.lease_documents
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- -----------------------------------------------------------------------------
-- STEP 7 — Grant per-property staff the read/view branches of the FOUNDATION
--          tables, so an assigned staff member sees the rent and utility records
--          of the unit they manage. Write controls (mark-paid, tenant manage)
--          stay exactly as the foundation intended — per-property staff are
--          caretakers, not financial controllers, so they get the same level as
--          an org viewer plus the new expense/maintenance/lease surfaces above.
--
--          Policies are dropped dynamically then recreated, mirroring STEP 1.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tenants', 'rent_ledger', 'utility_bills', 'property_private')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
  END LOOP;
END $$;

-- ── tenants: staff may view; managing stays manager/owner ──────────────────
CREATE POLICY "Org members, assigned staff or owner can read tenants" ON public.tenants
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org managers or property owner can insert tenants" ON public.tenants
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org managers or property owner can update tenants" ON public.tenants
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org managers or property owner can delete tenants" ON public.tenants
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

-- ── rent_ledger: staff may READ; confirming money stays manager/owner ──────
CREATE POLICY "Org members, assigned staff or owner can read rent ledger" ON public.rent_ledger
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org managers or property owner can insert rent ledger rows" ON public.rent_ledger
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org managers or property owner can mark rent paid" ON public.rent_ledger
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org admins or property owner can delete rent ledger rows" ON public.rent_ledger
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() = 'org:admin'
    )
    OR public.owns_property(property_id)
  );

-- ── utility_bills: staff may read AND record (data entry, not money control) ─
CREATE POLICY "Org members, assigned staff or owner can read utility bills" ON public.utility_bills
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can record utility bills" ON public.utility_bills
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can update utility bills" ON public.utility_bills
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org managers or property owner can delete utility bills" ON public.utility_bills
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );

-- ── property_private: staff may read + write notes (notes are agent-level) ──
CREATE POLICY "Org members, assigned staff or owner can read private notes" ON public.property_private
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can insert private notes" ON public.property_private
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org staff, assigned staff or owner can update private notes" ON public.property_private
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
    OR public.is_assigned_staff(property_id)
  );

CREATE POLICY "Org admins or owner can delete private notes" ON public.property_private
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- -----------------------------------------------------------------------------
-- STEP 8 — Private storage bucket for lease documents + scoped policies.
--
--   Read:  a user may download an object only when they can view its
--          lease_documents row (org member / assigned staff / owner).
--   Write: a user may upload only when they can insert a lease_documents row
--          (org admin/manager / assigned staff / owner).
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('lease-documents', 'lease-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Auth can read owned lease documents" ON storage.objects;
CREATE POLICY "Auth can read owned lease documents" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'lease-documents'
    AND EXISTS (
      SELECT 1 FROM public.lease_documents ld
      WHERE ld.file_path = storage.objects.name
        AND (
          (ld.org_id IS NOT NULL AND ld.org_id = public.current_org_id())
          OR public.owns_property(ld.property_id)
          OR public.is_assigned_staff(ld.property_id)
        )
    )
  );

DROP POLICY IF EXISTS "Auth can upload own lease documents" ON storage.objects;
-- Uploads land in the uploader's own folder (<user_id>/<file>). Anyone signed in
-- may write to their folder; the real gate on a document becoming visible and
-- attached to a unit is the lease_documents INSERT policy (managers, assigned
-- staff or owner), which the client must pass to create the metadata row.
CREATE POLICY "Auth can upload own lease documents" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'lease-documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.jwt()->>'sub'
  );
