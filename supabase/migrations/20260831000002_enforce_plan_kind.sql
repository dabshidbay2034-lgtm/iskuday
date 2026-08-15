-- =============================================================================
-- Migration: 20260831000002_enforce_plan_kind.sql
--
-- Ensures that a hotel account can ONLY subscribe to the "hotel" plan, and an
-- agency/owner/landlord account can ONLY subscribe to the "pms" plan — never
-- both, never the wrong one.
--
-- This is enforced in TWO places:
--   1. The `start_trial()` function is extended to reject a plan that doesn't
--      match the caller's platform role.
--   2. A new `start_trial_matching_plan()` helper gives the UI a one-call way
--      to start "the right trial for this account".
--
-- RE-RUNNABLE: CREATE OR REPLACE FUNCTION.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: which plan does this role map to?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_for_role(v_role TEXT)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN v_role IN ('agent', 'owner')          THEN 'pms'
    WHEN v_role = 'hotel_manager'              THEN 'hotel'
    WHEN v_role IN ('admin', 'semi_admin')     THEN NULL  -- admins don't subscribe
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.plan_for_role(TEXT) IS
  'Returns the plan ID that matches a platform role: agent/owner -> pms, hotel_manager -> hotel, admin/semi_admin -> NULL.';

-- -----------------------------------------------------------------------------
-- Extend start_trial() to enforce plan-kind matching.
--
-- The existing function already validates the caller controls the subject. This
-- change adds a check: the caller's platform role must be compatible with the
-- plan being started.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_trial(
  _subject_type TEXT,
  _subject_id   TEXT,
  _plan         TEXT
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller   TEXT := auth.jwt()->>'sub';
  _plan_for_role TEXT;
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

  -- ── Plan-kind enforcement ──────────────────────────────────────────────
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

  INSERT INTO public.subscriptions (subject_type, subject_id, plan, status, trial_ends_at)
  VALUES (_subject_type, _subject_id, _plan, 'trialing', now() + INTERVAL '14 days')
  ON CONFLICT (subject_type, subject_id, plan) DO NOTHING;

  RETURN public.subscription_state(_subject_type, _subject_id, _plan);
END;
$$;

COMMENT ON FUNCTION public.start_trial(TEXT, TEXT, TEXT) IS
  'Start a 14-day trial for a plan. NOW enforces plan-kind matching: a hotel_manager can only start the hotel plan, agents/owners can only start the pms plan.';

-- -----------------------------------------------------------------------------
-- Helper: get a single user's platform role from user_roles
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role(v_user_id TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role::TEXT FROM public.user_roles WHERE user_id = v_user_id LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_user_role(TEXT) IS
  'Returns the platform role (agent, owner, hotel_manager, admin, etc.) for a user.';