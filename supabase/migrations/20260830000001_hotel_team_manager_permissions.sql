-- =============================================================================
-- Migration: 20260830000001_hotel_team_manager_permissions.sql
--
-- Adds a MANAGER role and per-task permission grants to the native hotel team.
--
-- WHAT THIS ADDS:
--   • 'manager' role to hotel_members + hotel_invites role CHECKs
--   • `permissions TEXT[]` column on both tables (explicit task grants beyond role defaults)
--   • public.hotel_member_allowed(uuid, text)        — role-default OR explicit check
--   • Updated hotel_managed() to admit 'manager'
--   • Updated accept_hotel_invite_by_token() to carry role+permissions into membership
--
-- TASK TOKENS (used by hotel_member_allowed and the client Hooks):
--   list        — list new rooms / properties
--   edit        — edit pages & listings
--   publish     — publish/unpublish
--   bookings    — manage bookings & front desk
--   inquiries   — respond to inquiries
--   staff       — manage staff & payroll
--   housekeeping— manage housekeeping tasks
--
-- ROLE DEFAULTS:
--   admin       — 'all' (every task)
--   manager     — list, edit, publish, bookings, inquiries, staff, housekeeping
--   agent       — list, edit, publish, inquiries
--   viewer      — (none — empty array)
--
-- PRECONDITIONS: 20260813000001_native_hotel_team.sql (hotel_members, hotel_invites,
--   accept_hotel_invite_by_token, hotel_managed, hotel_member_admin).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotel_members' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotel_members  [20260810000002]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotel_invites' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotel_invites  [20260813000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_managed'
  ) THEN missing := array_append(missing, 'public.hotel_managed(uuid)  [20260808000001 / 20260813000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'accept_hotel_invite_by_token'
  ) THEN missing := array_append(missing, 'public.accept_hotel_invite_by_token(text)  [20260813000001]'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Hotel team manager/permissions migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun the migration named in brackets to completion first.',
      array_to_string(missing, E'\n                        ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — RENAME THE ROLE CONSTRAINT ON hotel_members to include 'manager'.
--
-- Same safe DROP-UPDATE-ADD sequence as 20260813000001 STEP 2.
-- -----------------------------------------------------------------------------

-- 1a. Drop the old constraint.
ALTER TABLE public.hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;

-- 1b. Handle any rows that might have the old renamed value (shouldn't exist
--     but be safe).
UPDATE public.hotel_members
   SET role = 'manager'
 WHERE role IN ('hotel_manager', 'manager');  -- 'manager' won't exist yet, but idempotent

-- 1c. Verify nothing unexpected remains.
DO $$
DECLARE
  strays TEXT;
BEGIN
  SELECT string_agg(DISTINCT role, ', ')
    INTO strays
    FROM public.hotel_members
   WHERE role NOT IN ('admin', 'manager', 'agent', 'viewer');
  IF strays IS NOT NULL THEN
    RAISE EXCEPTION
      E'public.hotel_members holds role value(s) this migration does not know: %',
      strays;
  END IF;
END $$;

-- 1d. Install the new constraint with manager.
ALTER TABLE public.hotel_members
  ADD CONSTRAINT hotel_members_role_check
  CHECK (role IN ('admin', 'manager', 'agent', 'viewer'));

COMMENT ON COLUMN public.hotel_members.role IS
  'admin | manager | agent | viewer. admin owns membership; manager manages operations, can list/edit/publish rooms, manage bookings, staff & inquiries; agent edits pages/rooms and responds to inquiries but must NEVER reach membership; viewer reads only. Renamed from hotel_admin/hotel_editor/hotel_viewer by 20260813000001; manager added by 20260830000001.';


-- -----------------------------------------------------------------------------
-- STEP 2 — RENAME THE ROLE CONSTRAINT ON hotel_invites to include 'manager'.
-- -----------------------------------------------------------------------------

ALTER TABLE public.hotel_invites DROP CONSTRAINT IF EXISTS hotel_invites_role_check;

ALTER TABLE public.hotel_invites
  ADD CONSTRAINT hotel_invites_role_check
  CHECK (role IN ('admin', 'manager', 'agent', 'viewer'));


-- -----------------------------------------------------------------------------
-- STEP 3 — ADD `permissions TEXT[]` COLUMNS.
--
-- Explicit task-grant array beyond the role defaults. NULL means "rely on role
-- default". Empty array means "no additional tasks". hotel_member_allowed() in
-- STEP 5 reads both: if permissions IS NULL it uses the role default; if it is
-- a specific array it merges.
-- -----------------------------------------------------------------------------

ALTER TABLE public.hotel_members
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.hotel_invites
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.hotel_members.permissions IS
  'Explicit task-permission grants beyond the role default (e.g. {"list","edit","bookings"}). Empty array = role default only. hotel_member_allowed() evaluates role defaults first, then checks this array.';
COMMENT ON COLUMN public.hotel_invites.permissions IS
  'Task permissions that will be carried into hotel_members upon acceptance. Same semantics as hotel_members.permissions.';


-- -----------------------------------------------------------------------------
-- STEP 4 — UPDATE hotel_managed() TO ADMIT MANAGER.
--
-- The membership branch previously tested `IN ('admin', 'agent')`; now it also
-- admits `'manager'`. All other branches (owner, org staff, platform admin)
-- are unchanged.
--
-- NOTE THE TWO DIFFERENT `manager`s:
--   • 'manager' (this file) — the per-hotel team role added here.
--   • 'org:manager' (20260804000001) — the Clerk organization role, untouched
--     by this migration and referring to a different concept.
-- -----------------------------------------------------------------------------
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
        -- Per-hotel membership (20260810000002); manager added by 20260830000001.
        OR public.hotel_member_role(_hotel_id) IN ('admin', 'manager', 'agent')
      )
  )
$$;

COMMENT ON FUNCTION public.hotel_managed(UUID) IS
  'Can the caller edit this hotel? Owner, matching active-org staff (org:admin/org:manager/org:agent), platform admin, or a per-hotel `admin`/`manager`/`agent` member. `viewer` is excluded. Manager added by 20260830000001.';


-- -----------------------------------------------------------------------------
-- STEP 5 — ROLE DEFAULT TASK MAP + HELPERS.
--
-- hotel_member_allowed() centralises the "can this member do this task?" check.
-- It returns TRUE when:
--   1. The member's role is 'admin' (all-powerful), OR
--   2. The task is in the member's role default set, OR
--   3. The task is in the member's explicit `permissions` array.
--
-- Keeping the role-default map in SQL means any downstream consumer (RLS
-- policy, edge function, report) gets the same answer as the client. The map
-- and the client map in src/hooks/use-hotel-members.ts MUST stay in step.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hotel_member_allowed(
  _hotel_id UUID,
  _task     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role       TEXT;
  v_perms      TEXT[];
  v_manager    TEXT[] := ARRAY['list', 'edit', 'publish', 'bookings', 'inquiries', 'staff', 'housekeeping'];
  v_agent      TEXT[] := ARRAY['list', 'edit', 'publish', 'inquiries'];
  v_viewer     TEXT[] := '{}';
BEGIN
  SELECT m.role, m.permissions
    INTO v_role, v_perms
    FROM public.hotel_members m
   WHERE m.hotel_id = _hotel_id
     AND m.user_id = auth.jwt()->>'sub';

  -- Not a member — allowed only if the caller is owner/org admin/etc.
  IF v_role IS NULL THEN
    RETURN public.hotel_managed(_hotel_id);
  END IF;

  -- Admin: everything.
  IF v_role = 'admin' THEN
    RETURN TRUE;
  END IF;

  -- Role default set.
  IF v_role = 'manager' AND _task = ANY (v_manager) THEN
    RETURN TRUE;
  END IF;
  IF v_role = 'agent' AND _task = ANY (v_agent) THEN
    RETURN TRUE;
  END IF;
  IF v_role = 'viewer' AND _task = ANY (v_viewer) THEN
    RETURN TRUE;
  END IF;

  -- Explicit permission grant overrides role default.
  IF v_perms IS NOT NULL AND _task = ANY (v_perms) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.hotel_member_allowed(UUID, TEXT) IS
  'Can the caller perform the given task on this hotel? Checks role default (admin=true; manager→{list,edit,publish,bookings,inquiries,staff,housekeeping}; agent→{list,edit,publish,inquiries}; viewer→{}) plus the member`s explicit `permissions` array. Non-members defer to hotel_managed().';


-- -----------------------------------------------------------------------------
-- STEP 6 — UPDATE accept_hotel_invite_by_token() TO CARRY PERMISSIONS.
--
-- The insert into hotel_members now also sets `permissions` from the invite.
-- ON CONFLICT DO NOTHING preserves the original pattern: an existing member's
-- role and permissions are never silently overwritten.
-- -----------------------------------------------------------------------------

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
  -- who already holds a higher role on this hotel. Permissions column added by
  -- 20260830000001.
  INSERT INTO public.hotel_members (hotel_id, user_id, role, invited_by, permissions)
  VALUES (v_invite.hotel_id, v_user, v_invite.role, v_invite.invited_by, v_invite.permissions)
  ON CONFLICT (hotel_id, user_id) DO NOTHING;

  UPDATE public.hotel_invites SET accepted_at = now() WHERE id = v_invite.id;

  RETURN v_invite.hotel_id;
END;
$$;

COMMENT ON FUNCTION public.accept_hotel_invite_by_token(TEXT) IS
  'Trades a secret invite token for a hotel_members row (role + permissions carried from the invite). The working invite path — the JWT carries no email claim. Permissions column added by 20260830000001.';


-- -----------------------------------------------------------------------------
-- STEP 7 — GRANTS.
--
-- hotel_member_allowed is callable by authenticated clients so the UI can check
-- task permissions directly. hotel_managed and accept_hotel_invite_by_token
-- are already granted; we re-assert them to be safe.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  fn TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Role "authenticated" not present (bare Postgres?) — skipping GRANTs.';
    RETURN;
  END IF;

  FOREACH fn IN ARRAY ARRAY[
    'public.hotel_member_allowed(uuid, text)',
    'public.hotel_managed(uuid)',
    'public.accept_hotel_invite_by_token(text)'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;


-- =============================================================================
-- Verify with:
--
--   -- 1. New role constraint on both tables:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN ('hotel_members_role_check', 'hotel_invites_role_check');
--   -- Expect both to list 'admin', 'manager', 'agent', 'viewer'.
--
--   -- 2. New columns:
--   SELECT column_name, table_name
--     FROM information_schema.columns
--    WHERE table_name IN ('hotel_members','hotel_invites')
--      AND column_name = 'permissions';
--   -- Expect two rows.
--
--   -- 3. Accept carries permissions (as admin, set up an invite with explicit
--   --    permissions, then accept from the invitee account):
--   INSERT INTO hotel_invites (hotel_id, email, role, permissions, invited_by)
--   VALUES ('<hotel_id>', 'someone@example.com', 'agent',
--           '{list,edit}', '<admin_user_id>');
--   -- … then from the invitee side:
--   SELECT public.accept_hotel_invite_by_token('<token>');
--   SELECT role, permissions FROM hotel_members
--    WHERE hotel_id = '<hotel_id>' AND user_id = '<invitee>';
--   -- Expect role='agent', permissions={list,edit}.
--
--   -- 4. hotel_member_allowed (as a signed-in manager):
--   SELECT public.hotel_member_allowed('<hotel_id>', 'bookings');  -- TRUE
--   SELECT public.hotel_member_allowed('<hotel_id>', 'housekeeping');  -- TRUE
--   -- (manager default set includes both)
--   -- Add a custom permission:
--   UPDATE hotel_members SET permissions = '{bookings}' WHERE …;
--   -- viewer with explicit bookings:
--   SELECT public.hotel_member_allowed('<hotel_id>', 'bookings');  -- TRUE (explicit)
--   SELECT public.hotel_member_allowed('<hotel_id>', 'list');      -- FALSE (not in viewer default, not explicit)
--
--   -- 5. hotel_managed now admits manager (as signed-in manager member):
--   SELECT public.hotel_managed('<hotel_id>');  -- TRUE
-- =============================================================================