-- =============================================================================
-- Migration: 20260813000001_native_hotel_team.sql
--
-- Makes a hotel's TEAM ours instead of Clerk's, and gives it an invite flow that
-- does not require the invitee to exist in this database first.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- Clerk owns AUTHENTICATION here and nothing else. Agencies are modeled as
-- Clerk Organizations (20260804000001), but a hotel is NOT an agency: a
-- hotelier with no Clerk Organization still needs to hand the front desk a
-- login. 20260810000002 already built that third trust path — public.hotel_members
-- is a plain table keyed on (hotel_id, clerk user id), with no Clerk org anywhere
-- in it. This migration finishes the job in two moves:
--
--   1. RENAMES the three roles to the product's own vocabulary.
--        hotel_admin  → admin
--        hotel_editor → agent
--        hotel_viewer → viewer
--      The `hotel_` prefix was a schema-level disambiguator that leaked into the
--      UI, where it reads as jargon. The MEANING of each role is unchanged —
--      admin still owns membership, agent still edits but must never touch
--      membership, viewer still reads drafts and writes nothing.
--
--   2. Adds public.hotel_invites + public.accept_hotel_invites() — a NATIVE
--      email invite, with no Clerk Organization and no Clerk invitation object.
--
-- ── WHY INVITES CANNOT BE RESOLVED AT INVITE TIME ──────────────────────────
-- public.profiles has NO email column — Clerk holds the email address and the
-- clerk-webhook deliberately does not mirror it. So at the moment an admin types
-- "frontdesk@example.com" there is no way to turn that string into a Clerk user
-- id: the person may not have signed up yet, and even if they have, we cannot
-- look them up. The invite is therefore stored AS AN EMAIL STRING and only
-- becomes a hotel_members row when the invited person signs in and the app calls
-- accept_hotel_invites(), which matches the stored address against the `email`
-- claim on their own JWT.
--
-- ── ⚠ THE `email` JWT CLAIM IS NOT CONFIRMED PRESENT ON THIS PROJECT ───────
-- docs/CLERK_SETUP.md §4 Option A ships `"email": "{{primary_email_address}}"`
-- in the template payload, but:
--   • Option B (the native Clerk↔Supabase integration) signs the ordinary
--     session token and the doc only asks you to verify the `o` object — it
--     says nothing about `email`;
--   • the §7 pre-deploy checklist requires `sub`, `o.id` and `o.rol` and does
--     NOT list `email`;
--   • no migration before this one reads any claim except `sub` (and `o`), so
--     nothing in production has ever exercised it.
-- If the claim is absent, public.jwt_email() below returns NULL, the
-- "invites addressed to me" SELECT branch matches nothing, and
-- accept_hotel_invites() returns 0 — invites are created but can never be
-- accepted. That failure is SILENT by nature, so every path that depends on the
-- claim is written to test for NULL EXPLICITLY rather than let a NULL comparison
-- quietly evaluate to "no rows", and public.jwt_email() is granted to
-- `authenticated` precisely so the UI (and a human in the SQL editor) can ask
-- the database "does my token carry an email?" and get a straight answer.
-- BEFORE RELYING ON INVITES: decode a live token at jwt.io, confirm `email`, and
-- add it to the Option B integration / the §7 checklist if it is missing.
--
-- ── WHAT THIS ADDS / CHANGES ───────────────────────────────────────────────
--   • hotel_members.role values + hotel_members_role_check  (RENAMED)
--   • public.hotel_member_admin(uuid)   — 'hotel_admin' → 'admin'
--   • public.hotel_managed(uuid)        — IN ('hotel_admin','hotel_editor')
--                                          → IN ('admin','agent')
--   • public.jwt_email()                — NEW helper
--   • public.hotel_invites              — NEW table + RLS
--   • public.accept_hotel_invites()     — NEW RPC (VOLATILE — it writes)
--   • public.my_hotel_ids()             — NEW helper (SETOF UUID)
--
-- public.hotel_member_role() is deliberately NOT re-created: its body returns
-- hotel_members.role verbatim and contains no role literal to update. A
-- cosmetic CREATE OR REPLACE of a SECURITY DEFINER function that four policies
-- depend on is pure risk for zero change. See STEP 3.
--
-- ── THE RECURSION TRAP (unchanged, and still load-bearing) ─────────────────
-- hotel_members' own policies call hotel_managed(), which calls
-- hotel_member_role(), which SELECTs hotel_members. SECURITY DEFINER on those
-- helpers is the ONLY thing stopping 42P17 (infinite recursion in policy for
-- relation). Both CREATE OR REPLACEs below keep SECURITY DEFINER, STABLE and
-- SET search_path = public exactly as 20260810000002 declared them. Do not
-- "tidy" any of the three off.
--
-- ── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- Policies on hotel_invites are dropped dynamically (Postgres has no CREATE
-- POLICY IF NOT EXISTS; a re-run would die with 42710). hotel_members,
-- hotel_pages and hotels are deliberately NOT in that drop list — their
-- policies belong to 20260808000001 / 20260810000002 / 20260812000001 and this
-- file does not re-create them, so dropping them would leave those tables
-- unreachable. Everything else is CREATE OR REPLACE / IF NOT EXISTS /
-- DROP-then-ADD, and the role rename is a no-op on a database where it has
-- already run.
--
-- ── NOTHING IS DROPPED OR DELETED ──────────────────────────────────────────
-- No column is dropped and no row is deleted anywhere in this file. The only
-- data written is (a) hotel_members.role rewritten in place and (b) whatever
-- accept_hotel_invites() writes at runtime.
--
-- ── PRECONDITIONS ──────────────────────────────────────────────────────────
--   20260804000001 (current_org_id / current_org_role / has_role),
--   20260808000001 (hotels, hotel_managed),
--   20260810000002 (hotel_members, hotel_member_role, hotel_member_admin).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT.
--
--   This file CREATE OR REPLACEs two SECURITY DEFINER helpers that other
--   migrations' policies are already written against. If those migrations have
--   not run, the REPLACE silently becomes a CREATE of a DIFFERENT function than
--   the one they will later install, and whichever file runs last wins —
--   quietly, and with access control as the thing that differs. Failing loudly
--   here is far cheaper than debugging that.
--
--   Probed through pg_proc / pg_class rather than to_regprocedure() so a missing
--   public.app_role type reports as "has_role is missing" rather than throwing
--   an unrelated type-resolution error (same reasoning as 20260805000001 and
--   20260810000002).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotels' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotels  [20260808000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotel_members' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotel_members  [20260810000002]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_managed'
  ) THEN missing := array_append(missing, 'public.hotel_managed(uuid)  [20260808000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_member_role'
  ) THEN missing := array_append(missing, 'public.hotel_member_role(uuid)  [20260810000002]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_member_admin'
  ) THEN missing := array_append(missing, 'public.hotel_member_admin(uuid)  [20260810000002]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_id'
  ) THEN missing := array_append(missing, 'public.current_org_id()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_role'
  ) THEN missing := array_append(missing, 'public.current_org_role()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
      AND p.pronargs >= 1
      AND p.proargtypes[0] = 'text'::regtype
  ) THEN missing := array_append(missing, 'public.has_role(TEXT, public.app_role)  [20260804000001]'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Native hotel team migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun the migration named in brackets to completion first. Nothing has been changed by this script.',
      array_to_string(missing, E'\n                        ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on hotel_invites (the ONLY table this file
--          owns outright).
--
--   Dropped dynamically, not by name: a policy added through the Supabase
--   dashboard never appears in these migration files, and a single missed one
--   blocks the whole run with 42710. Any policy on hotel_invites is superseded
--   by what STEP 6 creates.
--
--   On a first run the table does not exist and pg_policies returns no rows.
--   hotel_members / hotel_pages / hotels are intentionally absent — see the
--   RE-RUNNABLE note in the header.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('hotel_invites')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 2 — RENAME THE ROLES: hotel_admin/hotel_editor/hotel_viewer
--                            → admin/agent/viewer.
--
-- ── ORDER IS THE WHOLE TRICK ───────────────────────────────────────────────
-- There is exactly one correct sequence and both obvious orderings are wrong:
--
--   ✗ add the new CHECK first  → the existing rows still say 'hotel_admin',
--                                ALTER TABLE validates the constraint against
--                                them, and the statement fails with 23514.
--   ✗ UPDATE the rows first    → the OLD CHECK is still in force and rejects
--                                'admin' with 23514, one row at a time.
--   ✓ DROP the old CHECK → UPDATE the rows → ADD the new CHECK.
--
-- The window between the drop and the add is inside this transaction, so no
-- concurrent session ever sees the table unconstrained.
--
-- ── RE-RUN SAFETY ──────────────────────────────────────────────────────────
-- On a second run the UPDATE matches zero rows (they already read
-- admin/agent/viewer) and the DROP/ADD pair is idempotent by construction. The
-- guard between them exists for the third case: a row holding a value that is
-- in NEITHER vocabulary. ADD CONSTRAINT would reject it with a bare 23514
-- naming no row; the explicit check names the offenders.
-- =============================================================================

-- 2a. Take the old constraint out of the way. IF EXISTS because on a re-run it
--     is already the NEW constraint under the same name.
ALTER TABLE public.hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;

-- 2b. Rewrite the data. This is an in-place value rename — no row is deleted
--     and no column is dropped. Rows already using the new vocabulary are not
--     touched (the WHERE excludes them), which is what makes a re-run free.
UPDATE public.hotel_members
   SET role = CASE role
                WHEN 'hotel_admin'  THEN 'admin'
                WHEN 'hotel_editor' THEN 'agent'
                WHEN 'hotel_viewer' THEN 'viewer'
              END
 WHERE role IN ('hotel_admin', 'hotel_editor', 'hotel_viewer');

-- 2c. Nothing unexpected left behind? Report it by name before the constraint
--     does it anonymously.
DO $$
DECLARE
  strays TEXT;
BEGIN
  SELECT string_agg(DISTINCT role, ', ')
    INTO strays
    FROM public.hotel_members
   WHERE role NOT IN ('admin', 'agent', 'viewer');

  IF strays IS NOT NULL THEN
    RAISE EXCEPTION
      E'public.hotel_members holds role value(s) this migration does not know how to rename: %\n\nMap them to admin / agent / viewer by hand, then re-run. Nothing has been changed by this script (the transaction rolls back).',
      strays;
  END IF;
END $$;

-- 2d. Install the new vocabulary. CHECK constraints have no IF NOT EXISTS, so
--     drop-then-add (2a did the drop) is the re-runnable form.
ALTER TABLE public.hotel_members
  ADD CONSTRAINT hotel_members_role_check
  CHECK (role IN ('admin', 'agent', 'viewer'));

COMMENT ON COLUMN public.hotel_members.role IS
  'admin | agent | viewer. admin owns membership (hotel_member_admin); agent edits pages/rooms but must NEVER reach membership or invites; viewer reads drafts and writes nothing. Renamed from hotel_admin/hotel_editor/hotel_viewer by 20260813000001.';


-- =============================================================================
-- STEP 3 — public.hotel_member_role() is INTENTIONALLY NOT TOUCHED.
--
--   Its body is `SELECT m.role FROM hotel_members m WHERE m.hotel_id = $1 AND
--   m.user_id = auth.jwt()->>'sub'` — it PASSES THROUGH whatever the column
--   holds and contains no role literal to update. STEP 2 changed the column, so
--   this function starts returning 'admin'/'agent'/'viewer' with no DDL at all.
--
--   Four policies on hotel_members and every branch of hotel_managed() depend on
--   it, and it is the SECURITY DEFINER that breaks the RLS recursion cycle
--   (header). A cosmetic CREATE OR REPLACE of that function is pure downside.
--   The scan in STEP 9 proves the old literals are gone from it anyway.
-- =============================================================================


-- =============================================================================
-- STEP 4 — public.hotel_member_admin(): 'hotel_admin' → 'admin'.
--
-- BODY COPIED VERBATIM from 20260810000002 STEP 6 except for that one literal.
-- Every qualifier is preserved deliberately:
--   • SECURITY DEFINER — so the EXISTS on hotels is not filtered by hotels' own
--     RLS; a draft hotel an agent cannot yet read would otherwise make the owner
--     branch return NULL and lock the real owner out of their own team list.
--   • STABLE — planner reuse; this function is called once per row by four
--     policies.
--   • SET search_path = public — a SECURITY DEFINER without it is a search-path
--     hijack waiting to happen.
--
-- MISSING THIS ONE LITERAL WOULD SILENTLY REVOKE ACCESS RATHER THAN ERROR: the
-- comparison `role = 'hotel_admin'` simply stops matching after STEP 2, every
-- hotel admin quietly loses the ability to manage their own team, and the only
-- symptom is an empty team screen.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotel_member_admin(_hotel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE(public.hotel_member_role(_hotel_id) = 'admin', false)
    OR EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = _hotel_id AND h.owner_id = auth.jwt()->>'sub'
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
$$;

COMMENT ON FUNCTION public.hotel_member_admin(UUID) IS
  'TRUE for the hotel''s own `admin` member, the hotel owner, or a platform admin. Deliberately NARROWER than hotel_managed(): an `agent` passes hotel_managed() but must never be able to promote themselves. Do not merge the two.';


-- =============================================================================
-- STEP 5 — public.hotel_managed(): IN ('hotel_admin','hotel_editor')
--                                  → IN ('admin','agent').
--
-- BODY COPIED VERBATIM from 20260810000002 STEP 7 except for those two
-- literals. All four original branches are preserved: page owner, matching
-- active-org staff at org:admin/org:manager/org:agent, platform admin, and the
-- per-hotel membership branch.
--
-- NOTE THE TWO DIFFERENT `admin`s and do not "simplify" them together:
--   • has_role(sub, 'admin')            — PLATFORM admin, a public.app_role
--                                         enum value from 20260804000001.
--   • hotel_member_role(...) IN ('admin', …) — this hotel's own team role, the
--                                         TEXT value STEP 2 just renamed.
--   • current_org_role() IN ('org:admin', …) — Clerk ORG role, prefixed and
--                                         untouched by this migration.
-- Three different namespaces that now share a word.
--
-- `viewer` stays excluded, exactly as hotel_viewer was: a viewer reads drafts
-- and writes nothing.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotel_managed(_hotel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hotels h
    WHERE h.id = _hotel_id
      AND (
        h.owner_id = auth.jwt()->>'sub'
        OR (
          h.org_id IS NOT NULL
          AND h.org_id = public.current_org_id()
          AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
        )
        OR public.has_role(auth.jwt()->>'sub', 'admin')
        -- Per-hotel membership (20260810000002); renamed by 20260813000001.
        OR public.hotel_member_role(_hotel_id) IN ('admin', 'agent')
      )
  )
$$;

COMMENT ON FUNCTION public.hotel_managed(UUID) IS
  'Can the caller edit this hotel? Owner, matching active-org staff (org:admin/org:manager/org:agent), platform admin, or a per-hotel `admin`/`agent` member. `viewer` is excluded. Membership branch renamed from hotel_admin/hotel_editor by 20260813000001.';

-- 20260812000001 STEP 3b's COMMENT still describes the trigger in the old
-- vocabulary. The trigger's BEHAVIOUR is unaffected (it calls
-- hotel_member_admin(), never a literal), but a stale comment is how the next
-- reader learns the wrong words. Guarded because that migration may not have
-- run on every environment.
DO $$
BEGIN
  IF to_regprocedure('public.hotels_guard_ownership()') IS NOT NULL THEN
    EXECUTE $c$
      COMMENT ON FUNCTION public.hotels_guard_ownership() IS
        'Freezes hotels.owner_id and hotels.org_id against everyone except hotel_member_admin() (owner / hotel `admin` / platform admin). RLS is row-level and cannot express a frozen column; without this an invited `agent` could PATCH owner_id to themselves and inherit hotel_member_admin(). Role names updated by 20260813000001.'
    $c$;
  END IF;
END $$;


-- =============================================================================
-- STEP 6 — public.jwt_email(): the caller's email claim, or NULL.
--
-- ⚠ SEE THE HEADER. The `email` claim is documented for Clerk JWT-template
-- Option A and is NOT confirmed for Option B (the native integration), and it is
-- absent from the pre-deploy checklist in docs/CLERK_SETUP.md §7. Nothing in
-- this database has ever read it before today.
--
-- This function is the ONLY place the claim is read, so there is exactly one
-- thing to fix if the token turns out not to carry it. It normalises the same
-- way hotel_invites.email is stored — lower(btrim(...)) — so the comparison is
-- symmetric, and it collapses '' to NULL via NULLIF so that a template which
-- emits an empty string when the user has no primary address cannot match an
-- (impossible, CHECK-blocked) empty stored address.
--
-- TOLERATING ABSENCE: every caller tests `IS NOT NULL` explicitly instead of
-- relying on `email = NULL` evaluating to NULL. Same outcome, but the intent is
-- legible and the failure is greppable rather than a policy that mysteriously
-- returns nothing. Granted to `authenticated` so the UI can render an honest
-- "your session token has no email claim — invites cannot be accepted" instead
-- of an empty list. It returns only the caller's own claim, so it leaks nothing.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.jwt_email()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(lower(btrim(COALESCE(auth.jwt()->>'email', ''))), '')
$$;

COMMENT ON FUNCTION public.jwt_email() IS
  'The caller''s normalised (lowercased, trimmed) `email` JWT claim, or NULL when the claim is absent/empty. NULL means the Clerk token is not carrying `email` — see docs/CLERK_SETUP.md section 4 — and hotel invites cannot be matched or accepted until that is fixed.';


-- =============================================================================
-- STEP 7 — public.hotel_invites.
--
-- An invite is an EMAIL STRING, not a user id — see the header for why it
-- cannot be resolved at invite time. Consequences baked into this table:
--
--   • email is stored NORMALISED (lowercased, trimmed). Enforced twice over: a
--     BEFORE trigger that rewrites the value, and a CHECK that proves it. The
--     trigger fires before the constraint is validated, so a caller sending
--     "  FrontDesk@Example.COM " is corrected, not rejected — but a future
--     bulk-load that disables the trigger still cannot smuggle a mixed-case
--     address past the CHECK. Without normalisation the partial unique index
--     below would happily hold both spellings as two "pending" invites, and
--     accept_hotel_invites() would grant twice.
--
--   • invited_by is a Clerk id (TEXT) with NO foreign key — Clerk users do not
--     exist as rows in this database, same as hotels.owner_id,
--     hotel_members.user_id and rent_ledger.marked_by.
--
--   • accepted_at is a STAMP, never a delete. The row stays as the audit trail
--     of who invited whom, and dropping out of the partial unique index is what
--     makes re-inviting the same address later legal.
--
-- ── WHY THE UNIQUE INDEX IS PARTIAL ────────────────────────────────────────
-- A plain UNIQUE (hotel_id, email) would mean an address can be invited to a
-- hotel exactly ONCE EVER: remove the person, and you can never invite them
-- back. `WHERE accepted_at IS NULL` scopes the uniqueness to PENDING invites —
-- at most one live invite per (hotel, address) at a time, any number of
-- historical ones. UNIQUE constraints cannot carry a WHERE clause, which is why
-- this is a CREATE UNIQUE INDEX and not a table constraint.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotel_invites (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  hotel_id    UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  invited_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 days',
  accepted_at TIMESTAMPTZ,
  CONSTRAINT hotel_invites_pkey PRIMARY KEY (id)
);

-- Same vocabulary as hotel_members after STEP 2 — an invite that could not be
-- turned into a membership row is a trap, so the two CHECKs must stay in step.
ALTER TABLE public.hotel_invites DROP CONSTRAINT IF EXISTS hotel_invites_role_check;
ALTER TABLE public.hotel_invites
  ADD CONSTRAINT hotel_invites_role_check
  CHECK (role IN ('admin', 'agent', 'viewer'));

-- Normalised-and-plausible. The pattern is deliberately loose (one @, no
-- whitespace, a dot in the domain): this is a sanity gate against typos and
-- against a mixed-case address slipping past the trigger, NOT an RFC 5322
-- validator. Real verification is "the invitee signs in with that address".
ALTER TABLE public.hotel_invites DROP CONSTRAINT IF EXISTS hotel_invites_email_check;
ALTER TABLE public.hotel_invites
  ADD CONSTRAINT hotel_invites_email_check
  CHECK (
    email = lower(btrim(email))
    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

-- An expiry that is already in the past at insert time is a support ticket, not
-- a feature.
ALTER TABLE public.hotel_invites DROP CONSTRAINT IF EXISTS hotel_invites_expiry_check;
ALTER TABLE public.hotel_invites
  ADD CONSTRAINT hotel_invites_expiry_check
  CHECK (expires_at > created_at);

CREATE OR REPLACE FUNCTION public.hotel_invites_normalise_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(btrim(COALESCE(NEW.email, '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hotel_invites_normalise_email ON public.hotel_invites;
CREATE TRIGGER hotel_invites_normalise_email
  BEFORE INSERT OR UPDATE OF email ON public.hotel_invites
  FOR EACH ROW EXECUTE FUNCTION public.hotel_invites_normalise_email();

-- At most one PENDING invite per (hotel, address). See the header note above.
CREATE UNIQUE INDEX IF NOT EXISTS hotel_invites_one_pending_per_email
  ON public.hotel_invites (hotel_id, email)
  WHERE accepted_at IS NULL;

-- "Show this hotel's invites" — the admin screen's only query.
CREATE INDEX IF NOT EXISTS idx_hotel_invites_hotel
  ON public.hotel_invites (hotel_id, created_at DESC);

-- "Which invites are waiting for ME?" — accept_hotel_invites() and the
-- self-service SELECT branch both drive off lower(email). The stored value is
-- already lowercased, but the planner will not use a plain (email) index for a
-- lower(email) predicate, so the index has to match the expression.
CREATE INDEX IF NOT EXISTS idx_hotel_invites_pending_email
  ON public.hotel_invites (lower(email))
  WHERE accepted_at IS NULL;

COMMENT ON TABLE public.hotel_invites IS
  'Native (non-Clerk) hotel team invites, addressed to an EMAIL because profiles has no email column and an invitee may not have signed up yet. Becomes a hotel_members row only when the invitee calls accept_hotel_invites(). Admin-only under RLS, except that a user may read invites addressed to their own JWT email claim.';

COMMENT ON COLUMN public.hotel_invites.accepted_at IS
  'Stamped by accept_hotel_invites(); never deleted. NULL = pending, and only pending rows participate in hotel_invites_one_pending_per_email, which is what allows re-inviting a removed member.';


-- =============================================================================
-- STEP 8 — RLS on hotel_invites.
--
-- ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
-- AN `agent` MUST NOT SEE OR CREATE INVITES. An agent passes hotel_managed(), so
-- writing these policies against hotel_managed() — the obvious, wrong shortcut,
-- and the exact mistake 20260810000002 STEP 9 spends a paragraph preventing on
-- hotel_members — would let any invited agent invite themselves a second
-- identity at role `admin` and take the hotel. EVERY policy below is written
-- against hotel_member_admin(), which admits only the hotel's own `admin`, the
-- hotel owner, and platform admins.
--
-- The read side is the ONE deliberate widening: a user may see invites addressed
-- to their own email so the UI can render "you have a pending invite to X".
-- That branch is NOT a write path — the invitee cannot UPDATE their own invite
-- to accepted, and cannot change its role. Acceptance goes through
-- accept_hotel_invites() (STEP 9), which is SECURITY DEFINER and re-checks
-- expiry itself. Note it also deliberately shows EXPIRED and ACCEPTED invites
-- addressed to you: "your invite expired" is information the UI needs in order
-- to say something better than nothing.
--
-- ⚠ If the `email` claim is missing, jwt_email() is NULL, the whole second
-- branch is FALSE, and this table behaves as admin-only. That is a safe
-- failure, not a leak — but it is a silent one. See the header.
-- =============================================================================
ALTER TABLE public.hotel_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hotel admins or the invitee can read invites" ON public.hotel_invites
  FOR SELECT
  USING (
    public.hotel_member_admin(hotel_id)
    OR (
      -- Explicit NULL test rather than leaning on NULL-comparison semantics:
      -- when the JWT carries no email claim this is unambiguously FALSE, and
      -- the reason is readable in \d+ instead of implied.
      public.jwt_email() IS NOT NULL
      AND email = public.jwt_email()
    )
  );

CREATE POLICY "Hotel admins can create invites" ON public.hotel_invites
  FOR INSERT
  WITH CHECK (public.hotel_member_admin(hotel_id));

CREATE POLICY "Hotel admins can change invites" ON public.hotel_invites
  FOR UPDATE
  USING (public.hotel_member_admin(hotel_id))
  WITH CHECK (public.hotel_member_admin(hotel_id));

CREATE POLICY "Hotel admins can revoke invites" ON public.hotel_invites
  FOR DELETE
  USING (public.hotel_member_admin(hotel_id));


-- =============================================================================
-- STEP 9 — public.accept_hotel_invites(): turn my pending invites into
--          memberships.
--
-- ── ⚠ VOLATILE. DO NOT ADD `STABLE`. ───────────────────────────────────────
-- This function INSERTs and UPDATEs. Postgres runs a non-VOLATILE function
-- against a read-only snapshot, so the first time this one actually had a row to
-- write it would raise
--
--     ERROR: INSERT is not allowed in a non-volatile function  (SQLSTATE 0A000)
--
-- THIS EXACT BUG ALREADY SHIPPED ONCE in this repository:
-- generate_monthly_payroll() in 20260810000001 was declared STABLE, looked fine
-- in the case everyone tries first (nothing to do → loop body never runs →
-- returns 0 cheerfully), and had to be fixed by 20260811000001. Read that file
-- before "tidying" the declaration below. VOLATILE is the default, which is why
-- no volatility keyword appears at all — adding one is the only way to get this
-- wrong.
--
-- ── SECURITY DEFINER IS THE POINT ──────────────────────────────────────────
-- STEP 8 makes hotel_invites admin-only for writes and hotel_members' INSERT
-- policy requires hotel_member_admin() — an invitee is, by definition, neither.
-- The definer body bypasses both. What keeps that safe is that the function
-- takes NO PARAMETERS: there is nothing to inject. It can only ever act on rows
-- whose stored email equals the caller's own JWT claim, which the caller does
-- not control. A version taking `_email TEXT` would be a total-takeover RPC —
-- do not add one.
--
-- ── THE THREE CONDITIONS ARE RE-CHECKED HERE, NOT TRUSTED FROM THE UI ──────
-- unaccepted, unexpired, addressed to me. Expiry in particular must be checked
-- server-side: the client's clock is not evidence.
--
-- ── CONCURRENCY ────────────────────────────────────────────────────────────
-- FOR UPDATE SKIP LOCKED: two tabs calling this at the same instant must not
-- both count the same invite (double-counting is cosmetic) and must not
-- deadlock (not cosmetic). The stamping UPDATE re-asserts `accepted_at IS NULL`
-- and only a row that the UPDATE actually changed is counted, so the returned
-- number is the number of invites THIS call consumed.
--
-- ── RETURN VALUE ───────────────────────────────────────────────────────────
-- Counts INVITES CONSUMED, not memberships created. If the caller was already a
-- member of that hotel the INSERT hits ON CONFLICT DO NOTHING — their existing
-- role is NOT overwritten (an invite must never silently DEMOTE a hotel admin to
-- viewer) — but the invite is still stamped and still counted, because it is no
-- longer pending. 0 means "nothing was waiting for you", which the UI should
-- treat as normal, not as an error.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.accept_hotel_invites()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user    TEXT := auth.jwt()->>'sub';
  v_email   TEXT := public.jwt_email();
  v_count   INTEGER := 0;
  v_stamped INTEGER;
  v_inv     RECORD;
BEGIN
  -- No session, or a token with no email claim (see the header ⚠). Returning 0
  -- rather than raising keeps this callable unconditionally on every sign-in;
  -- the UI distinguishes the two cases by calling public.jwt_email() itself.
  IF v_user IS NULL OR v_email IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_inv IN
    SELECT i.id, i.hotel_id, i.role, i.invited_by
    FROM public.hotel_invites i
    WHERE lower(i.email) = v_email
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    ORDER BY i.created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- ON CONFLICT on the (hotel_id, user_id) primary key from 20260810000002.
    -- DO NOTHING, not DO UPDATE: see RETURN VALUE above.
    INSERT INTO public.hotel_members (hotel_id, user_id, role, invited_by)
    VALUES (v_inv.hotel_id, v_user, v_inv.role, v_inv.invited_by)
    ON CONFLICT (hotel_id, user_id) DO NOTHING;

    UPDATE public.hotel_invites
       SET accepted_at = now()
     WHERE id = v_inv.id
       AND accepted_at IS NULL;

    GET DIAGNOSTICS v_stamped = ROW_COUNT;
    v_count := v_count + v_stamped;
  END LOOP;

  RETURN v_count;
END $$;

COMMENT ON FUNCTION public.accept_hotel_invites() IS
  'Converts every unexpired, unaccepted hotel_invites row addressed to the caller''s JWT email claim into a hotel_members row, and stamps accepted_at. Returns the number of invites consumed. VOLATILE: it writes — declaring it STABLE raises 0A000 at runtime (see 20260811000001). Takes no parameters by design: it can only ever act on the caller''s own address.';


-- =============================================================================
-- STEP 10 — public.my_hotel_ids(): every hotel the caller can reach.
--
-- The UI's post-sign-in router calls this to send an invited team member
-- straight to their hotel instead of the "create your first hotel" empty state.
-- Three reachability paths, matching the three trust paths in the schema:
--   1. owner            — hotels.owner_id = my Clerk id
--   2. agency staff     — the hotel belongs to my ACTIVE Clerk org and my org
--                         role is one of the four (viewer included: read-only
--                         is still "can reach")
--   3. hotel_members    — any role, viewer included, for the same reason
--
-- PLATFORM ADMINS ARE DELIBERATELY EXCLUDED. has_role(sub,'admin') would make
-- this return EVERY hotel in the database, which for a routing helper means the
-- admin lands somewhere arbitrary and the query degrades to a full scan. This
-- answers "where do I belong", not "what may I moderate".
--
-- SECURITY DEFINER because the hotels branch must see DRAFT hotels the caller
-- has not been granted SELECT on yet; STABLE because it only reads. Returns
-- SETOF UUID so callers can use it directly as `IN (SELECT ...)`.
--
-- Naturally empty for an anonymous caller: auth.jwt()->>'sub' is NULL, every
-- comparison yields NULL, no row qualifies.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.my_hotel_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT h.id
  FROM public.hotels h
  WHERE h.owner_id = auth.jwt()->>'sub'
     OR (
       h.org_id IS NOT NULL
       AND h.org_id = public.current_org_id()
       AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent', 'org:viewer')
     )
  UNION
  SELECT m.hotel_id
  FROM public.hotel_members m
  WHERE m.user_id = auth.jwt()->>'sub'
$$;

COMMENT ON FUNCTION public.my_hotel_ids() IS
  'Every hotel id the caller can reach as owner, active-org staff, or hotel_members member (any role). Used to route a team member to their hotel after sign-in. Platform admins are deliberately NOT given every hotel — this answers "where do I belong", not "what may I moderate".';


-- =============================================================================
-- STEP 11 — Grants.
--
-- The three functions the CLIENT calls over PostgREST need EXECUTE on
-- `authenticated`. Supabase's default privileges usually grant EXECUTE to
-- PUBLIC on new functions, but 20260812000001 STEP 6 established that this
-- project does not rely on that, so the grants are explicit.
--
-- Guarded on pg_roles: `authenticated` always exists on a hosted Supabase
-- project, but a bare local Postgres does not have it and GRANT on a missing
-- role is a hard 42704 that would abort the run for no security reason (same
-- pattern and same reasoning as 20260812000001 STEP 6).
--
-- NOT granted to `anon`: an anonymous caller has no `sub` and no `email`, so
-- all three are no-ops for them — but exposing an RPC that writes to anon is a
-- shape nobody should have to reason about.
-- =============================================================================
DO $$
DECLARE
  fn TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Role "authenticated" not present (bare Postgres?) — skipping GRANTs.';
    RETURN;
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.accept_hotel_invites()',
    'public.my_hotel_ids()',
    'public.jwt_email()'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    FOREACH fn IN ARRAY ARRAY[
      'public.accept_hotel_invites()',
      'public.my_hotel_ids()',
      'public.jwt_email()'
    ] LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END LOOP;
  END IF;
END $$;


-- =============================================================================
-- STEP 12 — BACKSTOP: shout if any old role literal survived.
--
-- The rename is only safe if EVERY comparison moved. A missed one does not
-- error — it just stops matching, and access quietly disappears. So rather than
-- trust the grep that produced this file, the database checks itself.
--
-- WARNING, not EXCEPTION: this also matches functions that merely MENTION the
-- old names in a comment inside their body, and aborting a migration over a
-- comment would be worse than the thing it is guarding. The Verify block below
-- turns the same query into a hard pass/fail for a human.
--
-- prokind = 'f' because pg_get_functiondef() errors on aggregates and window
-- functions.
-- =============================================================================
DO $$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(sig, E'\n    ') INTO offenders FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~ '(hotel_admin|hotel_editor|hotel_viewer)'
    UNION ALL
    SELECT format('policy %I on %I.%I', policyname, schemaname, tablename)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (COALESCE(qual, '') || COALESCE(with_check, '')) ~ '(hotel_admin|hotel_editor|hotel_viewer)'
  ) s;

  IF offenders IS NOT NULL THEN
    RAISE WARNING
      E'Old hotel role literal(s) still present after the rename:\n    %\n\nIf any of these COMPARE the literal (rather than merely mention it in a comment), that access path is now silently dead. Fix it in a follow-up migration.',
      offenders;
  ELSE
    RAISE NOTICE 'Role rename clean: no hotel_admin/hotel_editor/hotel_viewer literal remains in any public function body or policy expression.';
  END IF;
END $$;


-- =============================================================================
-- End of migration. Verify with:
--
--   -- 1. ROLES RENAMED. Expect only admin/agent/viewer, and a CHECK that says
--   --    so. Zero rows from the first query, one constraint from the second.
--   SELECT DISTINCT role FROM public.hotel_members
--    WHERE role NOT IN ('admin','agent','viewer');
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'hotel_members_role_check';
--   -- expect: CHECK ((role = ANY (ARRAY['admin'::text, 'agent'::text, 'viewer'::text])))
--
--   -- 2. NO OLD LITERAL SURVIVES ANYWHERE. Both must return 0 rows.
--   SELECT p.oid::regprocedure::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) ~ '(hotel_admin|hotel_editor|hotel_viewer)';
--
--   SELECT policyname, tablename FROM pg_policies
--    WHERE schemaname = 'public'
--      AND (COALESCE(qual,'') || COALESCE(with_check,'')) ~ '(hotel_admin|hotel_editor|hotel_viewer)';
--
--   -- and the two renamed helpers really did take:
--   SELECT proname, prosrc FROM pg_proc
--    WHERE proname IN ('hotel_member_admin','hotel_managed');
--   -- expect  = 'admin'  and  IN ('admin','agent')
--
--   -- 3. AN `agent` CANNOT READ OR CREATE INVITES.
--   --    Every policy on hotel_invites must be gated on hotel_member_admin;
--   --    only the SELECT policy may additionally mention jwt_email.
--   --    Expect 0 rows:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='hotel_invites'
--      AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%hotel_member_admin%';
--
--   --    …and prove it end to end. As a superuser, seed a hotel, an agent and
--   --    an invite, then impersonate the agent:
--   --
--   --      SET LOCAL ROLE authenticated;
--   --      SET LOCAL request.jwt.claims =
--   --        '{"sub":"user_agent","role":"authenticated","email":"agent@example.com"}';
--   --      SELECT count(*) FROM public.hotel_invites;   -- expect 0
--   --      INSERT INTO public.hotel_invites (hotel_id, email, role, invited_by)
--   --      VALUES ('<hotel-uuid>', 'x@example.com', 'viewer', 'user_agent');
--   --      -- expect: new row violates row-level security policy  (42501)
--   --      RESET ROLE;
--   --
--   --    Sanity-check the same session sees hotel_managed() = true, otherwise
--   --    the test proved nothing:
--   --      SELECT public.hotel_managed('<hotel-uuid>');  -- expect true
--
--   -- 4. THE RPC ACCEPTS A PENDING INVITE.
--   --      INSERT INTO public.hotel_invites (hotel_id, email, role, invited_by)
--   --      VALUES ('<hotel-uuid>', 'newbie@example.com', 'agent', 'user_owner');
--   --
--   --      SET LOCAL ROLE authenticated;
--   --      SET LOCAL request.jwt.claims =
--   --        '{"sub":"user_newbie","role":"authenticated","email":"Newbie@Example.com"}';
--   --      SELECT public.jwt_email();             -- expect newbie@example.com
--   --                                             -- NULL ⇒ the token has no
--   --                                             --   email claim: STOP, see
--   --                                             --   the ⚠ in the header.
--   --      SELECT public.accept_hotel_invites();  -- expect 1
--   --      SELECT public.accept_hotel_invites();  -- expect 0 (idempotent)
--   --      SELECT public.my_hotel_ids();          -- expect the hotel uuid
--   --      RESET ROLE;
--   --
--   --      SELECT role, accepted_at IS NOT NULL AS accepted
--   --        FROM public.hotel_invites WHERE email = 'newbie@example.com';
--   --      -- expect: agent, true
--   --      SELECT role FROM public.hotel_members
--   --       WHERE user_id = 'user_newbie';        -- expect: agent
--
--   -- 5. Expired invites are NOT accepted:
--   --      UPDATE public.hotel_invites
--   --         SET accepted_at = NULL, expires_at = now() - INTERVAL '1 day'
--   --       WHERE email = 'newbie@example.com';
--   --      -- (as user_newbie again) SELECT public.accept_hotel_invites(); -- 0
--
--   -- 6. The RPC is VOLATILE. 's' here means it will raise 0A000 the first time
--   --    it has real work to do — the 20260811000001 bug, again.
--   SELECT provolatile FROM pg_proc
--    WHERE oid = 'public.accept_hotel_invites()'::regprocedure;   -- expect 'v'
--
--   -- 7. One pending invite per address per hotel, re-invitable after use:
--   --      INSERT … same (hotel_id, email) twice  → 23505 on the second
--   --      …then stamp accepted_at and insert again → succeeds
-- =============================================================================


-- =============================================================================
-- STEP 13 — TOKEN INVITES.  ⚠ THIS IS THE PATH THAT ACTUALLY WORKS.
--
-- STEP 6/8 match an invite to a user by comparing hotel_invites.email against
-- the JWT `email` claim. That claim DOES NOT EXIST in this project. Decoded
-- live from a real signed-in session, the token carries exactly:
--
--     azp, exp, fva, iat, iss, nbf, o, role, sid, sts, sub, v
--
-- No `email`. This project uses the native Clerk<->Supabase integration
-- (VITE_CLERK_SUPABASE_JWT_TEMPLATE is unset — see
-- src/integrations/supabase/client.ts), and that integration does not emit one.
-- So jwt_email() returns NULL, accept_hotel_invites() matches nothing, and the
-- email flow silently never adds anybody. It fails closed, which is the right
-- direction to fail, but it does not work.
--
-- Rather than depend on a Clerk dashboard change nobody can verify from here,
-- authorization moves to a SECRET TOKEN carried in the invite link:
--
--   1. A hotel admin creates the invite and copies /join/<token>.
--   2. They send it however they already talk to staff — WhatsApp, mostly.
--   3. The invitee opens it while signed in; the RPC below trades the token
--      for a membership row.
--
-- The token is the credential, so `email` demotes to a LABEL — it records who
-- the invite was meant for and is never trusted for authorization. Note this
-- means whoever holds the link can redeem it: that is the same trade every
-- invite-link system makes, and it is bounded by expires_at, by single use
-- (accepted_at), and by revocation.
-- =============================================================================

-- 128 bits of entropy without requiring pgcrypto: gen_random_uuid() is core in
-- PG13+, two of them concatenated give 64 hex chars.
ALTER TABLE public.hotel_invites
  ADD COLUMN IF NOT EXISTS token TEXT NOT NULL
  DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS hotel_invites_token_key ON public.hotel_invites (token);

COMMENT ON COLUMN public.hotel_invites.token IS
  'The invite secret. Authorization is by THIS, not by email — the JWT has no email claim. Delivered out of band as /join/<token>.';
COMMENT ON COLUMN public.hotel_invites.email IS
  'A LABEL recording who the invite was addressed to. Never an authorization input.';


-- Redeem a token for a membership row. Returns the hotel_id so the UI can send
-- the new member straight to their hotel.
CREATE OR REPLACE FUNCTION public.accept_hotel_invite_by_token(_token TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user   TEXT := auth.jwt()->>'sub';
  v_invite public.hotel_invites%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to accept this invitation.' USING ERRCODE = 'P0001';
  END IF;

  -- SECURITY DEFINER, so this read bypasses the admin-only SELECT policy on
  -- hotel_invites — an invitee is by definition not yet a member and could not
  -- otherwise see their own invite. SKIP LOCKED keeps two concurrent redeems
  -- of the same link from both succeeding.
  SELECT * INTO v_invite
  FROM public.hotel_invites
  WHERE token = _token
    AND accepted_at IS NULL
    AND expires_at > now()
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This invitation is invalid, already used, or expired.' USING ERRCODE = 'P0001';
  END IF;

  -- DO NOTHING, never DO UPDATE: redeeming an invite must never DEMOTE someone
  -- who already holds a higher role on this hotel.
  INSERT INTO public.hotel_members (hotel_id, user_id, role, invited_by)
  VALUES (v_invite.hotel_id, v_user, v_invite.role, v_invite.invited_by)
  ON CONFLICT (hotel_id, user_id) DO NOTHING;

  UPDATE public.hotel_invites SET accepted_at = now() WHERE id = v_invite.id;

  RETURN v_invite.hotel_id;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.accept_hotel_invite_by_token(TEXT) TO authenticated';
  END IF;
END $$;

COMMENT ON FUNCTION public.accept_hotel_invite_by_token(TEXT) IS
  'Trades a secret invite token for a hotel_members row. The working invite path — the JWT carries no email claim, so accept_hotel_invites() cannot match anyone.';

-- =============================================================================
-- Verify STEP 13 with:
--   -- the token column exists and is unique:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='hotel_invites' AND column_name='token';
--   -- redeeming twice must fail the second time:
--   SELECT public.accept_hotel_invite_by_token('<token>');  -- returns hotel_id
--   SELECT public.accept_hotel_invite_by_token('<token>');  -- raises P0001
-- =============================================================================
