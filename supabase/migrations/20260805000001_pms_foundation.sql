-- =============================================================================
-- ⚠️  DESTRUCTIVE & IRREVERSIBLE MIGRATION — READ BEFORE RUNNING  ⚠️
--
-- PMS foundation (Phases 0-5 of docs/PLAN_PMS_SERVICES.md §7).
--
--   ***  THIS MIGRATION DROPS public.profiles.phone, public.profiles.phone2   ***
--   ***  AND public.profiles.phone3. THAT IS INTENTIONAL AND IRREVERSIBLE.    ***
--
-- Why: `profiles` is world-readable — its live policy is
--
--     CREATE POLICY "Profiles viewable by everyone" ON public.profiles
--       FOR SELECT USING (true);
--
-- so every phone number in the table ships to anyone holding the anon key. That
-- is a live data-exposure bug (plan §2 R-1 / requirement R4: phone numbers are
-- visible to platform admins only). Postgres RLS is ROW-level, not column-level,
-- so there is no policy that hides one column of a publicly-readable table. The
-- only structural fix is to move the numbers out of the public table entirely.
--
-- What happens below, in order:
--   1. public.profile_contacts is created (private, no public SELECT policy).
--   2. Existing profiles.phone / phone2 / phone3 values are copied into it
--      (phone → phone, phone2 → whatsapp, phone3 → alt_phone). Guarded by
--      information_schema checks, so it is a no-op if the columns were already
--      removed.
--   3. profiles.phone, profiles.phone2 AND profiles.phone3 are all DROPPED.
--      All three were world-readable; leaving any one of them behind would keep
--      the exposure open. There is no down migration; recovering them requires
--      a database backup.
--
-- Also created here (all RLS-enabled, none publicly readable):
--   property_private, tenants, rent_ledger, utility_bills
-- and two new columns on public.properties: occupancy_status, is_listed.
--
-- ── ORG-SCOPED **OR** OWNER-SCOPED ──────────────────────────────────────────
-- org_id is NULLABLE on all four PMS tables and every policy has two branches:
-- the agency path (org_id = current_org_id(), narrowed by current_org_role())
-- and the solo-landlord path (public.owns_property(property_id)). An individual
-- owner who never creates a Clerk Organization is a first-class user and must
-- not be gated behind "create an agency first". See STEP 3b for the full
-- rationale and for why the owner branch must never consult org membership.
--
-- ── RE-RUNNABILITY ──────────────────────────────────────────────────────────
-- Postgres has no CREATE POLICY IF NOT EXISTS, and an earlier migration in this
-- repo died with 42710 ("policy ... already exists") on retry for exactly that
-- reason. STEP 1 therefore drops every policy on the tables this file owns,
-- dynamically, before any of them are recreated — the same pattern used by
-- 20260804000001_migrate_to_clerk_auth.sql STEP 1. Everything else uses
-- IF NOT EXISTS / IF EXISTS. This file is safe to run more than once.
--
-- ── PRECONDITIONS ───────────────────────────────────────────────────────────
--   1. 20260804000001_migrate_to_clerk_auth.sql has run: it provides
--      public.current_org_id(), public.current_org_role(), public.current_user_id()
--      and the TEXT-signature public.has_role(TEXT, public.app_role).
--   2. The Clerk JWT template is published and emits sub / o.id / o.rol.
--   3. A full database backup has been taken (see the phone drop above).
--
-- ── CLAIM MAPPING ───────────────────────────────────────────────────────────
--     current Clerk user   →  auth.jwt()->>'sub'
--     active org id        →  public.current_org_id()    (auth.jwt()->'o'->>'id')
--     active org role      →  public.current_org_role()  (auth.jwt()->'o'->>'rol')
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT. Fail loudly and early if the preconditions above are not
--          met.
--
--          This migration calls five functions it does not create. Four of them
--          come from 20260804000001_migrate_to_clerk_auth.sql. Without this
--          guard, running the files out of order dies partway through with a
--          bare "function public.current_org_id() does not exist" — and because
--          the Supabase SQL editor does not wrap the script in a transaction,
--          whatever DDL already ran stays applied, leaving a half-migrated
--          database that is harder to reason about than a clean failure.
--
--          Checked through pg_proc rather than to_regprocedure() so that a
--          missing public.app_role type surfaces as "has_role is missing"
--          instead of throwing an unrelated type-resolution error.
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
    WHERE n.nspname = 'public' AND p.proname = 'current_user_id'
  ) THEN missing := array_append(missing, 'public.current_user_id()'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN missing := array_append(missing, 'public.update_updated_at_column()'); END IF;

  -- has_role must specifically be the TEXT-signature rewrite. If the original
  -- has_role(uuid, app_role) is still in place, the Clerk migration did not
  -- complete, and every policy below that calls has_role(auth.jwt()->>'sub', …)
  -- would fail to resolve.
  --   Checked against proargtypes rather than the formatted argument string:
  --   pg_get_function_identity_arguments() renders type names subject to
  --   search_path, so a LIKE on its output can report a false negative.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
      AND p.pronargs >= 1
      AND p.proargtypes[0] = 'text'::regtype
  ) THEN missing := array_append(missing, 'public.has_role(TEXT, public.app_role)'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'PMS foundation migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun supabase/migrations/20260804000001_migrate_to_clerk_auth.sql to completion first — it creates these helpers. Nothing has been changed by this script.',
      array_to_string(missing, ', ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the tables this migration owns, so the
--          CREATE POLICY statements below can never hit 42710 on a re-run.
--
--          Dropped dynamically rather than by name: policies added through the
--          Supabase dashboard never appear in these migration files, and a
--          single missed one blocks the whole migration. Any policy on these
--          tables is superseded by what this file creates.
--
--          On a first run these tables do not exist yet and pg_policies simply
--          returns no rows for them.
--
--          public.profiles is deliberately NOT in this list — its policies are
--          owned by 20260804000001 and stay exactly as they are. Dropping the
--          phone columns does not require touching them (no policy references
--          those columns).
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
        'profile_contacts',
        'property_private',
        'tenants',
        'rent_ledger',
        'utility_bills'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 2 — profile_contacts: the private home for every phone number (R-1 / R4).
-- =============================================================================

-- 2a. Table. Keyed by Clerk user id (TEXT), same as profiles.user_id.
CREATE TABLE IF NOT EXISTS public.profile_contacts (
  user_id    TEXT        NOT NULL,
  phone      TEXT,
  whatsapp   TEXT,
  alt_phone  TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profile_contacts_pkey PRIMARY KEY (user_id)
);

DROP TRIGGER IF EXISTS update_profile_contacts_updated_at ON public.profile_contacts;
CREATE TRIGGER update_profile_contacts_updated_at
  BEFORE UPDATE ON public.profile_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profile_contacts ENABLE ROW LEVEL SECURITY;


-- 2b. Backfill from the columns we are about to destroy.
--
--     Dynamic SQL is required: a static statement referencing profiles.phone
--     fails to PARSE (not just execute) once the column is gone, which would
--     break the re-run this migration is supposed to survive. Every column is
--     probed against information_schema first.
--
--     Mapping: phone → phone, phone2 → whatsapp, phone3 → alt_phone.
--     All three are dropped in 2c once their values are safely here.
DO $$
DECLARE
  has_phone  BOOLEAN;
  has_phone2 BOOLEAN;
  has_phone3 BOOLEAN;
  cols       TEXT[] := ARRAY[]::TEXT[];
  vals       TEXT[] := ARRAY[]::TEXT[];
  moved      BIGINT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone')
    INTO has_phone;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone2')
    INTO has_phone2;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone3')
    INTO has_phone3;

  IF has_phone THEN
    cols := array_append(cols, 'phone');    vals := array_append(vals, 'NULLIF(p.phone, '''')');
  END IF;
  IF has_phone2 THEN
    cols := array_append(cols, 'whatsapp'); vals := array_append(vals, 'NULLIF(p.phone2, '''')');
  END IF;
  IF has_phone3 THEN
    cols := array_append(cols, 'alt_phone'); vals := array_append(vals, 'NULLIF(p.phone3, '''')');
  END IF;

  IF array_length(cols, 1) IS NULL THEN
    RAISE NOTICE 'profile_contacts backfill skipped — no phone columns left on public.profiles.';
    RETURN;
  END IF;

  -- ON CONFLICT DO NOTHING: whatever is already in profile_contacts is newer
  -- than the legacy columns and must win.
  EXECUTE format(
    'INSERT INTO public.profile_contacts (user_id, %s)
     SELECT p.user_id, %s
     FROM public.profiles p
     WHERE p.user_id IS NOT NULL
       AND COALESCE(%s) IS NOT NULL
     ON CONFLICT (user_id) DO NOTHING',
    array_to_string(cols, ', '),
    array_to_string(vals, ', '),
    array_to_string(vals, ', ')
  );
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'profile_contacts backfill: % row(s) migrated from public.profiles.', moved;
END $$;


-- 2c. THE DROP. Irreversible — see the header. Guarded by IF EXISTS so a re-run
--     (or an environment where these were already removed) is a clean no-op.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone2;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone3;

-- All three phone columns go. Keeping any one of them would leave the original
-- exposure open — "Profiles viewable by everyone" makes every surviving column
-- readable with the anon key, so a partial fix is not a fix. Their values now
-- live in profile_contacts (phone / whatsapp / alt_phone), which has no public
-- SELECT policy at all.


-- 2d. RLS — the whole point of this table.
--     There is deliberately NO public SELECT policy. A row is readable by the
--     user it belongs to, or by a platform admin. No org role grants access to
--     a phone number (plan §5, last row).
CREATE POLICY "Own contacts or platform admin can read" ON public.profile_contacts
  FOR SELECT
  USING (
    user_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Own contacts or platform admin can insert" ON public.profile_contacts
  FOR INSERT
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Own contacts or platform admin can update" ON public.profile_contacts
  FOR UPDATE
  USING (
    user_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

CREATE POLICY "Platform admins can delete contacts" ON public.profile_contacts
  FOR DELETE
  USING (
    user_id = auth.jwt()->>'sub'
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );


-- =============================================================================
-- STEP 3 — properties: split "occupied" from "listed" (plan §2 R-3).
--
--   occupancy_status | is_listed | meaning
--   -----------------+-----------+---------------------------------------------
--   vacant           | true      | advertised, appears in the rental cards
--   vacant           | false     | empty but held back (renovation, reserved)
--   occupied         | false     | tenanted, still tracked for rent & bills
--
-- The public marketplace filters on `is_listed AND occupancy_status = 'vacant'`.
-- Defaults keep every existing row exactly as visible as it is today.
-- =============================================================================
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS occupancy_status TEXT NOT NULL DEFAULT 'vacant';

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT true;

-- CHECK constraints have no IF NOT EXISTS — drop then add for re-runnability.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_occupancy_status_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_occupancy_status_check
  CHECK (occupancy_status IN ('vacant', 'occupied'));

CREATE INDEX IF NOT EXISTS idx_properties_occupancy ON public.properties(occupancy_status);
CREATE INDEX IF NOT EXISTS idx_properties_is_listed ON public.properties(is_listed);

-- has_elevator was a phantom amenity: declared in src/lib/types.ts, held in the
-- AddProperty form state and rendered on the review step and the detail page,
-- but no migration ever created the column and the insert never sent it. It
-- could only ever be false. Creating it here makes the existing UI truthful
-- rather than deleting a feature that was half-wired.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS has_elevator BOOLEAN NOT NULL DEFAULT false;


-- =============================================================================
-- STEP 3b — public.owns_property(): the SOLO-LANDLORD fallback.
--
-- Every PMS table below is org-scoped, but an individual property owner who has
-- never created a Clerk Organization has NO active org: current_org_id() returns
-- NULL for them and current_org_role() returns NULL too. Without this fallback
-- the entire property-management feature — rent ledger, utility bills, tenants —
-- would be gated behind "first create an agency", which contradicts the product:
-- individual landlords are first-class users and most small ones will never make
-- an agency. So org_id is NULLABLE on all four PMS tables and every policy reads
--
--     (org_id IS NOT NULL AND org_id = public.current_org_id())   -- agency path
--     OR public.owns_property(property_id)                        -- solo path
--
-- SECURITY DEFINER matters here: without it the lookup would itself be filtered
-- by properties' RLS, so an owner would lose access to their own row the moment
-- the property was hidden. STABLE lets the planner call it once per row.
--
-- ── THE ONE THING NOT TO GET WRONG ──────────────────────────────────────────
-- This function matches on properties.owner_id = the CURRENT USER. It does NOT
-- consult org membership, and it must never be rewritten to. If it did, it would
-- become a hole straight through the rent-vs-utilities asymmetry in STEPs 6/7:
-- an org:agent is denied UPDATE on rent_ledger, and an owner-branch that keyed
-- off org membership would hand them exactly the privilege that denial exists to
-- withhold. An org:agent only ever passes this check for a property they
-- personally own — at which point they are the solo landlord, not staff acting
-- on someone else's unit, and full control is correct.
-- NULL input (a tenants row with no property_id) returns false, not NULL.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.owns_property(_property_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.properties
    WHERE id = _property_id
      AND owner_id = auth.jwt()->>'sub'
  )
$$;


-- =============================================================================
-- STEP 4 — property_private: notes that must never reach the public feed (R-2).
--          A separate table makes `select('*')` on properties structurally
--          incapable of leaking them.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.property_private (
  property_id   UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id        TEXT,
  private_notes TEXT,
  internal_ref  TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_private_pkey PRIMARY KEY (property_id)
);

CREATE INDEX IF NOT EXISTS idx_property_private_org_id ON public.property_private(org_id);

DROP TRIGGER IF EXISTS update_property_private_updated_at ON public.property_private;
CREATE TRIGGER update_property_private_updated_at
  BEFORE UPDATE ON public.property_private
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.property_private ENABLE ROW LEVEL SECURITY;

-- NO public SELECT policy (plan §4 rule 1). Org members read their own org's
-- notes; the property owner reads their own regardless of org context.
CREATE POLICY "Org members can read private notes" ON public.property_private
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- Write: admin / manager / agent (plan §5 "Private notes"). Viewer cannot.
CREATE POLICY "Org staff can insert private notes" ON public.property_private
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org staff can update private notes" ON public.property_private
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org admins can delete private notes" ON public.property_private
  FOR DELETE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
    )
    OR public.owns_property(property_id)
  );


-- =============================================================================
-- STEP 5 — tenants (plan §2 R-5). Records maintained by staff — D2 says tenants
--          never log in, so there is no self-service policy here.
--          contact_phone lives here rather than in profile_contacts because a
--          tenant has no Clerk account; it is org-scoped and never public.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- NULLABLE: a solo landlord with no Clerk Organization has no org_id.
  -- See STEP 3b. Reachability is guaranteed by tenants_scope_check below.
  org_id        TEXT,
  property_id   UUID        REFERENCES public.properties(id) ON DELETE SET NULL,
  full_name     TEXT        NOT NULL,
  contact_phone TEXT,
  lease_start   DATE,
  lease_end     DATE,
  deposit_held  NUMERIC     NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);

-- Idempotent for databases where an earlier run of this file created the table
-- with org_id NOT NULL.
ALTER TABLE public.tenants ALTER COLUMN org_id DROP NOT NULL;

-- A tenant row with neither an org nor a property would be unreachable under
-- both policy branches — nobody could ever read or edit it. Refuse to create it.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_scope_check;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_scope_check
  CHECK (org_id IS NOT NULL OR property_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tenants_org_id      ON public.tenants(org_id);
CREATE INDEX IF NOT EXISTS idx_tenants_property_id ON public.tenants(property_id);
CREATE INDEX IF NOT EXISTS idx_tenants_active      ON public.tenants(org_id, is_active);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- NO public SELECT policy. Org members (any role, viewer included) read their
-- agency's tenants; a solo landlord reads the tenants of properties they own.
CREATE POLICY "Org members or property owner can read tenants" ON public.tenants
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
  );

-- Manage tenants: org admin / manager (plan §5), or the property owner acting
-- on their own unit — a solo landlord is effectively admin over their property.
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


-- =============================================================================
-- STEP 6 — rent_ledger (plan §2 R-4 / decision D1). One row per property per
--          month. "Mark paid" is an UPDATE on an existing period row.
--          The platform collects nothing — the recorded number is the truth.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.rent_ledger (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  property_id  UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- NULLABLE: a solo landlord with no Clerk Organization has no org_id. The
  -- owner branch resolves through property_id, which is NOT NULL here, so every
  -- row is always reachable by exactly one of the two branches. See STEP 3b.
  org_id       TEXT,
  tenant_id    UUID        REFERENCES public.tenants(id) ON DELETE SET NULL,
  period_month DATE        NOT NULL,           -- always day 1 of the month
  amount_due   NUMERIC     NOT NULL DEFAULT 0,
  amount_paid  NUMERIC     NOT NULL DEFAULT 0,
  status       TEXT        NOT NULL DEFAULT 'unpaid',
  paid_at      TIMESTAMPTZ,
  marked_by    TEXT,                            -- Clerk id of the staff member
  method       TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rent_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT rent_ledger_property_period_key UNIQUE (property_id, period_month)
);

-- Idempotent for databases where an earlier run created org_id NOT NULL.
ALTER TABLE public.rent_ledger ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.rent_ledger DROP CONSTRAINT IF EXISTS rent_ledger_status_check;
ALTER TABLE public.rent_ledger
  ADD CONSTRAINT rent_ledger_status_check
  CHECK (status IN ('unpaid', 'partial', 'paid'));

ALTER TABLE public.rent_ledger DROP CONSTRAINT IF EXISTS rent_ledger_method_check;
ALTER TABLE public.rent_ledger
  ADD CONSTRAINT rent_ledger_method_check
  CHECK (method IS NULL OR method IN ('cash', 'evc', 'zaad', 'bank', 'other'));

-- period_month is always the first of the month; enforce it rather than trust
-- every caller to remember.
ALTER TABLE public.rent_ledger DROP CONSTRAINT IF EXISTS rent_ledger_period_month_check;
ALTER TABLE public.rent_ledger
  ADD CONSTRAINT rent_ledger_period_month_check
  CHECK (date_trunc('month', period_month::timestamp)::date = period_month);

CREATE INDEX IF NOT EXISTS idx_rent_ledger_org_id           ON public.rent_ledger(org_id);
CREATE INDEX IF NOT EXISTS idx_rent_ledger_property_period  ON public.rent_ledger(property_id, period_month);
CREATE INDEX IF NOT EXISTS idx_rent_ledger_org_period       ON public.rent_ledger(org_id, period_month);
CREATE INDEX IF NOT EXISTS idx_rent_ledger_tenant_id        ON public.rent_ledger(tenant_id);

DROP TRIGGER IF EXISTS update_rent_ledger_updated_at ON public.rent_ledger;
CREATE TRIGGER update_rent_ledger_updated_at
  BEFORE UPDATE ON public.rent_ledger
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.rent_ledger ENABLE ROW LEVEL SECURITY;

-- NO public SELECT policy (plan §4 rule 1 — nothing financial is publicly
-- readable). Every org role including viewer may READ the ledger (plan §5);
-- a solo landlord reads the ledger of properties they own.
CREATE POLICY "Org members or property owner can read rent ledger" ON public.rent_ledger
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
  );

-- Creating the period row (opening a month) is a manager-level action, or the
-- property owner's own to take on their own unit.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- MARK RENT PAID = UPDATE on this table.
--
-- ORG PATH: restricted to org:admin / org:manager. 'org:agent' is DELIBERATELY
-- EXCLUDED. This asymmetry is the point (plan §2 R-6, §5): recording a utility
-- bill is data entry, marking money received is a financial control. An agent
-- who can fix a typo in a description must NOT be able to mark twelve months of
-- rent as collected. Compare with utility_bills in STEP 7, where 'org:agent' IS
-- allowed to INSERT. Do not "simplify" these two into one role list.
--
-- OWNER PATH: public.owns_property() grants the solo landlord full control of
-- their own rows — they have no org role, so without this they could not mark
-- their own rent paid at all. This is NOT a hole in the restriction above: the
-- helper matches properties.owner_id against the current user and never looks
-- at org membership (see STEP 3b), so an org:agent gains nothing here for a
-- property belonging to their agency. Never rewrite owns_property() to consult
-- staff_permissions or current_org_role() — that would silently reopen exactly
-- the privilege the org path withholds.
-- ─────────────────────────────────────────────────────────────────────────────
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


-- =============================================================================
-- STEP 7 — utility_bills (plan §2 R-8). One row per property per month per
--          utility, so a third utility (rubbish, generator, security) is a new
--          row rather than a schema change.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.utility_bills (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  property_id   UUID        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  -- NULLABLE: a solo landlord with no Clerk Organization has no org_id. The
  -- owner branch resolves through property_id, which is NOT NULL here, so every
  -- row is always reachable by exactly one of the two branches. See STEP 3b.
  org_id        TEXT,
  period_month  DATE        NOT NULL,          -- always day 1 of the month
  utility_type  TEXT        NOT NULL,
  amount        NUMERIC     NOT NULL DEFAULT 0,
  meter_reading NUMERIC,
  status        TEXT        NOT NULL DEFAULT 'unpaid',
  recorded_by   TEXT,                           -- Clerk id of the staff member
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT utility_bills_pkey PRIMARY KEY (id),
  CONSTRAINT utility_bills_property_period_type_key UNIQUE (property_id, period_month, utility_type)
);

-- Idempotent for databases where an earlier run created org_id NOT NULL.
ALTER TABLE public.utility_bills ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.utility_bills DROP CONSTRAINT IF EXISTS utility_bills_utility_type_check;
ALTER TABLE public.utility_bills
  ADD CONSTRAINT utility_bills_utility_type_check
  CHECK (utility_type IN ('electricity', 'water', 'other'));

ALTER TABLE public.utility_bills DROP CONSTRAINT IF EXISTS utility_bills_status_check;
ALTER TABLE public.utility_bills
  ADD CONSTRAINT utility_bills_status_check
  CHECK (status IN ('unpaid', 'paid'));

ALTER TABLE public.utility_bills DROP CONSTRAINT IF EXISTS utility_bills_period_month_check;
ALTER TABLE public.utility_bills
  ADD CONSTRAINT utility_bills_period_month_check
  CHECK (date_trunc('month', period_month::timestamp)::date = period_month);

CREATE INDEX IF NOT EXISTS idx_utility_bills_org_id          ON public.utility_bills(org_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_property_period ON public.utility_bills(property_id, period_month);
CREATE INDEX IF NOT EXISTS idx_utility_bills_org_period      ON public.utility_bills(org_id, period_month);

DROP TRIGGER IF EXISTS update_utility_bills_updated_at ON public.utility_bills;
CREATE TRIGGER update_utility_bills_updated_at
  BEFORE UPDATE ON public.utility_bills
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;

-- NO public SELECT policy. Org members read their own org's bills; a solo
-- landlord reads the bills of properties they own.
CREATE POLICY "Org members or property owner can read utility bills" ON public.utility_bills
  FOR SELECT
  USING (
    (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.owns_property(property_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- RECORDING A UTILITY BILL INCLUDES 'org:agent' — unlike rent_ledger UPDATE
-- above. Recording a bill is data entry (plan §5: "Record utility bills" is ✅
-- for Agent); marking rent paid is a financial control (— for Agent). The two
-- role lists differ on purpose; keep them apart.
-- The owner branch is the same solo-landlord fallback used everywhere else.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE POLICY "Org staff or property owner can record utility bills" ON public.utility_bills
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
  );

CREATE POLICY "Org staff or property owner can update utility bills" ON public.utility_bills
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.owns_property(property_id)
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


-- =============================================================================
-- End of migration. Verify with:
--
--   -- phone columns really are gone from the public table:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles' AND column_name LIKE 'phone%';
--
--   -- no new table is publicly readable:
--   SELECT tablename, policyname, cmd, qual FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('profile_contacts','property_private','tenants',
--                        'rent_ledger','utility_bills');
--
--   -- agents cannot mark rent paid, but can record utility bills:
--   SELECT tablename, policyname, cmd, with_check FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('rent_ledger','utility_bills')
--      AND cmd IN ('UPDATE','INSERT');
--
--   -- a solo landlord is not gated behind creating an agency: org_id must be
--   -- nullable on all four PMS tables, and every policy must carry the owner
--   -- branch (this should return 0 rows):
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('property_private','tenants','rent_ledger','utility_bills')
--      AND COALESCE(qual, '') || COALESCE(with_check, '') NOT LIKE '%owns_property%';
--
--   SELECT table_name, column_name, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='org_id'
--      AND table_name IN ('property_private','tenants','rent_ledger','utility_bills');
-- =============================================================================
