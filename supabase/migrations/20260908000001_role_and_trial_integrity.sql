-- =============================================================================
-- Migration: 20260908000001_role_and_trial_integrity.sql
--
-- Closes a privilege-escalation hole, and makes a chosen account type and a
-- consumed trial both permanent.
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
-- `public.user_roles` carried these policies:
--
--   CREATE POLICY "Users can insert own roles" ... WITH CHECK (auth.jwt()->>'sub' = user_id);
--   CREATE POLICY "Users can update own role"  ... USING  (auth.jwt()->>'sub' = user_id)
--                                                  WITH CHECK (auth.jwt()->>'sub' = user_id);
--
-- They constrain WHICH ROW you may write. They constrain NOTHING about the
-- `role` column, and `public.app_role` contains 'admin' and 'semi_admin'. So
-- any signed-in user — a renter who registered a minute ago — could run
--
--   update user_roles set role = 'admin' where user_id = <their own id>
--
-- against the anon client that already ships in the browser bundle, and become
-- a platform administrator. Everything gated on `has_role(..., 'admin')` fell
-- with it: reading every booking's guest name and phone number, inserting
-- subscriptions, recording subscription payments, the admin panels.
--
-- Note what that means for the paid product: the subscription and payment
-- policies are all admin-gated and were written correctly, but correct locks
-- do not help when the key is on the wall. This one hole was also the way to a
-- free subscription. Fixing it is what makes the billing rules real.
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
