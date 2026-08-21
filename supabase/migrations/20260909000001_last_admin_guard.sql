-- =============================================================================
-- Migration: 20260909000001_last_admin_guard.sql
--
-- Makes it impossible to remove the last platform admin.
--
-- ── THE HAZARD ──────────────────────────────────────────────────────────────
-- src/pages/Admin.tsx renders every user as a card with a role <Select>, and
-- the signed-in admin's own card is in that list looking exactly like the rest.
-- Choosing "Renter" on it runs
--
--   update user_roles set role = 'user' where id = <own row>
--
-- which RLS happily allows — "Admins can update any user role" checks that the
-- CALLER is an admin, and at the moment of the call they still are. One click,
-- no confirmation, and the platform has no administrator.
--
-- ── WHY THAT IS UNRECOVERABLE RATHER THAN MERELY BAD ────────────────────────
-- There is no way back in through the product:
--   • user_roles has NO admin INSERT policy, and after 20260908000001 no client
--     INSERT policy at all. Nothing in the app can create an admin row.
--   • set_my_role() refuses 'admin' by design — that is the whole point of it.
--   • BOOTSTRAP_ADMIN_IDS is read by supabase/functions/clerk-webhook on a
--     `user.created` event only, so it cannot readmit an account that already
--     exists. Deleting and recreating the Clerk user would orphan every row
--     keyed by the old `sub`.
-- The only remaining route is the Supabase SQL editor, which is a different
-- credential the operator may not have to hand — and if this platform is ever
-- handed to staff, may not have at all.
--
-- ── WHY THIS IS A TRIGGER AND NOT A UI CHECK ────────────────────────────────
-- The same guard already exists twice in this codebase, in the two LESSER
-- tiers: src/components/team/members-table.tsx ("never demote your own admin
-- role, never remove the last admin") and HotelTeamCard. Both are React. The
-- most consequential admin tier in the product was the only one without it.
--
-- Putting it in the database rather than a third React component is deliberate:
-- a UI guard protects the one screen it is written on, and this row is
-- reachable from the SQL editor, from a future admin screen, and from any
-- script someone writes later. The rule is "this platform always has an
-- administrator" — that is an invariant of the data, so it belongs on the data.
-- Admin.tsx gets a guard too, so the button is disabled rather than failing
-- with a toast, but that one is for comfort and this one is for correctness.
--
-- ── WHAT IS STILL ALLOWED ───────────────────────────────────────────────────
--   • Promoting anyone to admin. Always.
--   • Demoting an admin while ANOTHER admin exists — that is ordinary staff
--     management and it stays a single click.
--   • Everything semi_admin, owner, hotel_manager, agent and user do. This
--     trigger only ever looks at rows entering or leaving 'admin'.
--
-- RE-RUNNABLE: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.
-- PRECONDITIONS: 20260306213635 (user_roles, app_role).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Cannot apply 20260909000001: public.user_roles is missing.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guard_last_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _others INT;
BEGIN
  -- Only two operations can take an admin away: changing the role off 'admin',
  -- or deleting the row. Everything else returns immediately, so this trigger
  -- costs nothing on the ordinary path.
  IF TG_OP = 'UPDATE' AND NOT (OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.role <> 'admin' THEN
    RETURN OLD;
  END IF;

  -- How many admins would remain. Counted by user_id rather than by row so that
  -- it stays correct even if the UNIQUE(user_id) from 20260805000003 is ever
  -- relaxed and one person holds two rows.
  SELECT count(DISTINCT user_id) INTO _others
    FROM public.user_roles
   WHERE role = 'admin'
     AND user_id <> OLD.user_id;

  IF _others = 0 THEN
    RAISE EXCEPTION
      'This is the last platform admin. Promote another account to admin first, then change this one.'
      USING ERRCODE = 'check_violation',
            HINT = 'Admin panel -> Users -> set someone to Admin, then retry.';
  END IF;

  -- Explicit IF rather than `RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW
  -- END`. In a DELETE trigger NEW is unassigned, and putting it in a CASE arm
  -- makes the safety of this line depend on plpgsql evaluating the branch it
  -- did not pick. A trigger whose whole job is to refuse a dangerous delete
  -- must not have a way to raise on the ordinary path.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_last_admin() IS
  'Refuses the update or delete that would leave the platform with no admin. See 20260909000001.';

DROP TRIGGER IF EXISTS guard_last_admin_update ON public.user_roles;
CREATE TRIGGER guard_last_admin_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();

DROP TRIGGER IF EXISTS guard_last_admin_delete ON public.user_roles;
CREATE TRIGGER guard_last_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_admin();

-- ── Report the standing of this invariant right now ──────────────────────────
-- A platform with exactly one admin is one forgotten password away from the
-- same outcome this trigger prevents, and the trigger cannot help with that.
-- Say so at apply time, while somebody is looking.
DO $$
DECLARE v_admins INT;
BEGIN
  SELECT count(DISTINCT user_id) INTO v_admins
    FROM public.user_roles WHERE role = 'admin';

  IF v_admins = 0 THEN
    RAISE WARNING 'THERE ARE NO PLATFORM ADMINS. Nobody can reach /admin-panel. Create one in the SQL editor.';
  ELSIF v_admins = 1 THEN
    RAISE WARNING 'Only ONE platform admin exists. Losing that account locks you out of /admin-panel — consider a second.';
  ELSE
    RAISE NOTICE 'Platform admins: % — the last one can no longer be removed.', v_admins;
  END IF;
END $$;
