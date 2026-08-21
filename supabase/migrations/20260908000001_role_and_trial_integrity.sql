-- =============================================================================
-- Migration: 20260908000001_role_and_trial_integrity.sql
--
-- Makes a chosen account type and a consumed trial both permanent, and takes
-- role writes away from the client entirely.
--
-- ── WHAT WAS AND WAS NOT ALREADY FIXED ──────────────────────────────────────
-- CORRECTION TO AN EARLIER VERSION OF THIS HEADER. It claimed that any signed-in
-- user could set themselves to 'admin'. That was TRUE of 20260804000001, whose
-- policies constrained which ROW you may write and nothing about the `role`
-- column. It was NOT true when this migration was written:
-- 20260812000001_security_hardening.sql (STEP 1) had already replaced both
-- policies with
--
--     role IN ('user', 'owner', 'agent', 'hotel_manager')
--
-- in BOTH `USING` and `WITH CHECK`, which is exactly the self-service ceiling
-- that stops 'admin' and 'semi_admin' being claimed. The escalation was closed
-- on 12 August. The earlier header here read the superseded 20260804000001 and
-- reported it as the live state. Anyone auditing this file should trust
-- 20260812000001 over the first draft of this one.
--
-- ── WHAT WAS STILL OPEN, AND IS WHAT THIS MIGRATION IS FOR ──────────────────
-- Three things survived that ceiling:
--
--   1. is_verified was self-settable. 20260812000001 says so in as many words:
--      "NOTE ON is_verified: deliberately NOT constrained here ... Tightening
--      it is a product change, not a security fix." ProfileSettings duly passed
--      `true`, so the "Verified" badge the Admin panel presents as a platform
--      check was partly self-awarded. It matters most for `agent`, where the
--      badge is a trust signal a renter acts on when handing over a deposit.
--
--   2. A user could move freely among the four business roles. That is the
--      trial-farming loop: take the 14-day `pms` trial as an owner, let it
--      lapse, switch to hotel_manager, take the `hotel` trial. Repeatable
--      indefinitely, one account, no admin involved.
--
--   3. Nothing froze the account type once a plan had started, so the role a
--      subscription was sold against could change underneath it.
--
-- ── WHY REMOVE THE POLICIES RATHER THAN ADD TO THEM ─────────────────────────
-- The ceiling in 20260812000001 works, but it is a list of allowed values
-- spread across two policies and two clauses, and every new rule above would
-- add another condition to all four places. Routing the whole operation through
-- one SECURITY DEFINER function instead means the rules are written once, in
-- procedural code, where the reason for each can be stated — and the client
-- keeps no direct write path to a privilege table at all. Nothing here is
-- weaker than what it replaces: set_my_role() accepts only the same four
-- business values, and still never 'admin' or 'semi_admin'.
--
-- ── THE RULES THIS INSTALLS ─────────────────────────────────────────────────
--   • No client may write `user_roles` directly. Not INSERT, not UPDATE.
--     The only door is `set_my_role()` below, plus the existing admin policies.
--   • A user may choose an account type ONCE, and only from `user` (renter) or
--     from having no row at all. A hotel_manager, owner or agent cannot change
--     what they are — support does that, deliberately, with a record of it.
--   • Nobody may give themselves 'admin' or 'semi_admin' at all. Those are
--     granted by an existing admin or by BOOTSTRAP_ADMIN_IDS, never claimed.
--   • Once a subscription exists — trialing, active or expired — the account
--     type is frozen. Taking the trial is the commitment.
--   • One trial per subject, EVER, across every plan.
--
-- ── WHY ONE TRIAL PER SUBJECT AND NOT PER PLAN ──────────────────────────────
-- `start_trial` deduplicated on (subject_type, subject_id, plan), so a second
-- trial for the SAME plan was already impossible. The loop was through the
-- role: start the 14-day `pms` trial as an owner, let it expire, switch to
-- hotel_manager, and `plan_for_role` now permits the `hotel` trial — another 14
-- days, from one account, indefinitely repeatable with each switch. Freezing
-- the role after the first subscription closes it, and this check closes it
-- again from the other side. Two locks on one door is correct here: this is the
-- door people push on.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────────
-- The hotel plan already includes the PMS tools and is one price; the PMS plan
-- is for owners and agents. `plan_for_role()` already encodes exactly that and
-- is untouched. Admins still set anyone's role through the admin policies, so
-- the Admin panel keeps working and remains the way a genuine mistake is undone.
--
-- RE-RUNNABLE: DROP POLICY IF EXISTS, CREATE OR REPLACE FUNCTION.
-- PRECONDITIONS: 20260804000001 (Clerk auth, user_roles policies),
--                20260816000001 (subscriptions, start_trial),
--                20260831000002 (plan_for_role, current start_trial).
-- =============================================================================

DO $$
DECLARE missing TEXT[] := '{}';
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    missing := array_append(missing, 'public.user_roles');
  END IF;
  IF to_regclass('public.subscriptions') IS NULL THEN
    missing := array_append(missing, 'public.subscriptions  [20260816000001]');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'plan_for_role'
  ) THEN
    missing := array_append(missing, 'public.plan_for_role()  [20260831000002]');
  END IF;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION E'Cannot apply 20260908000001. Missing:\n  %',
      array_to_string(missing, E'\n  ');
  END IF;
END $$;

-- ── STEP 1: take the pen away from the client ────────────────────────────────
-- Both historical spellings are dropped: 20260306213635 created them against
-- auth.uid(), 20260804000001 recreated them against the Clerk `sub` claim.
-- Dropping by name covers both because the names never changed.

DROP POLICY IF EXISTS "Users can insert own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update own role"  ON public.user_roles;
DROP POLICY IF EXISTS "Users can update own roles" ON public.user_roles;

-- "Users can view own roles" is deliberately kept: the app reads its own role
-- on every page load to decide what to render.

COMMENT ON TABLE public.user_roles IS
  'One platform role per user. NOT client-writable: use set_my_role(), or the admin policies. See 20260908000001.';

-- ── STEP 2: the only door ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_my_role(_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller  TEXT := auth.jwt()->>'sub';
  _current TEXT;
  _subs    INT;
  _org     TEXT;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to choose an account type.'
      USING ERRCODE = '42501';
  END IF;

  -- Self-service is limited to the three business roles. 'admin' and
  -- 'semi_admin' are granted, never claimed — that distinction is the entire
  -- point of this migration. 'user' is absent too: going back to renter would
  -- reopen the switch loop this closes.
  IF _role IS NULL OR _role NOT IN ('owner', 'hotel_manager', 'agent') THEN
    RAISE EXCEPTION 'Choose one of: owner, hotel_manager, agent.'
      USING ERRCODE = '22023';
  END IF;

  SELECT role::TEXT INTO _current FROM public.user_roles WHERE user_id = _caller;

  -- Only a renter, or somebody who has never had a row, may choose.
  IF _current IS NOT NULL AND _current <> 'user' THEN
    RAISE EXCEPTION 'Your account is already set up as %. Contact support to change it.', _current
      USING ERRCODE = 'check_violation';
  END IF;

  -- A trial or a paid plan freezes it, personal or through the caller's org.
  _org := public.current_org_id();
  SELECT count(*) INTO _subs
    FROM public.subscriptions s
   WHERE (s.subject_type = 'user' AND s.subject_id = _caller)
      OR (_org IS NOT NULL AND s.subject_type = 'org' AND s.subject_id = _org);

  IF _subs > 0 THEN
    RAISE EXCEPTION 'Your plan has already started, so the account type is fixed. Contact support if this is wrong.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _current IS NULL THEN
    INSERT INTO public.user_roles (user_id, role, is_verified)
    VALUES (_caller, _role::public.app_role, FALSE);
  ELSE
    -- is_verified is NOT set here. Verification is something the platform
    -- grants after checking a real business; letting the same call that picks
    -- a role also mark it verified would make the badge self-service.
    UPDATE public.user_roles
       SET role = _role::public.app_role
     WHERE user_id = _caller;
  END IF;

  RETURN _role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_role(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_role(TEXT) TO authenticated;

COMMENT ON FUNCTION public.set_my_role(TEXT) IS
  'The only self-service path to an account type. Renter-or-none only, business roles only, refused once any subscription exists.';

-- ── STEP 3: one trial per subject, ever ──────────────────────────────────────
-- Body preserved from 20260831000002 except for the new check; see the header
-- for why the per-plan guard that was already there is not enough.

CREATE OR REPLACE FUNCTION public.start_trial(
  _subject_type TEXT,
  _subject_id   TEXT,
  _plan         TEXT
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller        TEXT := auth.jwt()->>'sub';
  _plan_for_role TEXT;
  _existing      INT;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to start a trial.' USING ERRCODE = '42501';
  END IF;

  IF _subject_type IS NULL OR _subject_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'Unknown subject type: %', _subject_type USING ERRCODE = '22023';
  END IF;

  IF _plan IS NULL OR _plan NOT IN ('hotel', 'pms') THEN
    RAISE EXCEPTION 'Unknown plan: %', _plan USING ERRCODE = '22023';
  END IF;

  -- A hotel_manager can only start the 'hotel' trial. An agent or owner can
  -- only start the 'pms' trial. Admins bypass this check.
  IF NOT public.has_role(_caller, 'admin') THEN
    _plan_for_role := public.plan_for_role(public.get_user_role(_caller));
    IF _plan_for_role IS NULL OR _plan_for_role <> _plan THEN
      RAISE EXCEPTION 'Your account type does not support the % plan. Switch your account role in Settings if needed.', _plan
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT (
    (_subject_type = 'user' AND _subject_id = _caller)
    OR (_subject_type = 'org' AND _subject_id = public.current_org_id())
    OR public.has_role(_caller, 'admin')
  ) THEN
    RAISE EXCEPTION 'You can only start a trial for your own account.'
      USING ERRCODE = '42501';
  END IF;

  -- ONE TRIAL PER SUBJECT, ACROSS EVERY PLAN.
  --
  -- The ON CONFLICT below already stopped a second trial for the same plan.
  -- The loop was through the role: trial `pms` as an owner, let it lapse,
  -- switch to hotel_manager, trial `hotel` for another fourteen days. An admin
  -- is exempt so support can still set an account up by hand.
  IF NOT public.has_role(_caller, 'admin') THEN
    SELECT count(*) INTO _existing
      FROM public.subscriptions
     WHERE subject_type = _subject_type AND subject_id = _subject_id;

    IF _existing > 0 THEN
      RAISE EXCEPTION 'This account has already used its free trial.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.subscriptions (subject_type, subject_id, plan, status, trial_ends_at)
  VALUES (_subject_type, _subject_id, _plan, 'trialing', now() + INTERVAL '14 days')
  ON CONFLICT (subject_type, subject_id, plan) DO NOTHING;

  RETURN public.subscription_state(_subject_type, _subject_id, _plan);
END;
$$;

COMMENT ON FUNCTION public.start_trial(TEXT, TEXT, TEXT) IS
  'Starts the one free trial a subject ever gets. Plan must match the account type. See 20260908000001.';

-- ── STEP 4: report what the open door may have let through ───────────────────
--
-- Closing a privilege-escalation hole does not undo anything done through it
-- while it was open, and it was open to every registered user from
-- 20260306213635 until this migration. So the moment the door shuts, say who is
-- standing inside.
--
-- This is a REPORT, not a repair. It deliberately revokes nothing:
--   • The legitimate admins are in here too, and this migration cannot tell
--     them apart from a self-appointed one — nothing recorded WHO granted a
--     role or when, which is itself worth fixing.
--   • Demoting the wrong row would lock the operator out of their own admin
--     panel, and the recovery path (BOOTSTRAP_ADMIN_IDS in clerk-webhook) runs
--     only on a Clerk user.created event — i.e. not for an existing account.
-- A human reads this and decides. Re-runnable any time: scripts/audit-roles.sql.
DO $$
DECLARE
  r             RECORD;
  v_privileged  INT;
  v_verified    INT;
BEGIN
  SELECT count(*) INTO v_privileged
    FROM public.user_roles WHERE role::TEXT IN ('admin', 'semi_admin');

  RAISE NOTICE '--- ROLE AUDIT -------------------------------------------------';
  RAISE NOTICE 'Accounts holding admin or semi_admin: %', v_privileged;

  FOR r IN
    SELECT user_id, role::TEXT AS role, is_verified
      FROM public.user_roles
     WHERE role::TEXT IN ('admin', 'semi_admin')
     ORDER BY role, user_id
  LOOP
    RAISE NOTICE '  % — % (verified: %)', r.role, r.user_id, r.is_verified;
  END LOOP;

  IF v_privileged > 0 THEN
    RAISE NOTICE 'Check every id above against the people you MEANT to give this to.';
    RAISE NOTICE 'Any you do not recognise had full read of guest names and phone numbers.';
  END IF;

  -- Separate problem, same shape: ProfileSettings passed is_verified = true
  -- when a user picked their account type, so the "Verified" badge the Admin
  -- panel presents as a platform check was partly self-awarded. set_my_role()
  -- no longer touches the column, but rows written before this migration keep
  -- whatever they were given.
  SELECT count(*) INTO v_verified
    FROM public.user_roles
   WHERE is_verified AND role::TEXT NOT IN ('admin', 'semi_admin');

  RAISE NOTICE 'Non-admin accounts marked verified: % (some self-granted; review in Admin → Users)', v_verified;
  RAISE NOTICE '----------------------------------------------------------------';
END $$;
