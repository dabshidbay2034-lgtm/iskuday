-- =============================================================================
-- Who holds power on this platform, and does a paid plan back it up?
--
-- Run this in the Supabase SQL editor. It is READ-ONLY — every statement is a
-- SELECT. Nothing here changes a role, a badge or a subscription.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
-- Until 20260908000001, `user_roles` let any signed-in user write their own row
-- with no restriction on the `role` column, and `app_role` contains 'admin'.
-- The hole is closed, but closing it does not undo anything done through it,
-- and nothing in this schema records who granted a role or when. So the only
-- available check is: look at the list, and recognise the people on it.
--
-- Migration 20260908000001 prints query 1 automatically when it applies. This
-- file is for looking again later, and for the queries too long to be NOTICEs.
-- =============================================================================


-- ── 1. Everyone with platform-wide power ─────────────────────────────────────
-- The important one. An admin reads profile_contacts (every registered user's
-- phone number) and property_private, writes subscriptions, and records
-- payments as settled — thirteen tables in all.
--
-- Not bookings: guest contact details there are scoped to the org, the property
-- owner and assigned staff, with no platform-admin override.
--
-- Expect to recognise EVERY row. One you do not is the whole reason this file
-- exists — revoke it in Admin → Users, or by hand:
--     UPDATE public.user_roles SET role = 'user' WHERE user_id = '<clerk id>';
-- Do not run that blind: demote the account you sign in with and you lock
-- yourself out of the admin panel, and BOOTSTRAP_ADMIN_IDS only fires on a
-- Clerk user.created event, so it will not let an existing account back in.
SELECT
  ur.user_id,
  ur.role::TEXT              AS role,
  ur.is_verified,
  p.full_name,
  -- Contact details come from profile_contacts, NOT profiles: 20260805000001
  -- dropped profiles.phone/phone2/phone3 because that table is world-readable
  -- and RLS is row-level, so a public table cannot hide one column. There is no
  -- email column anywhere — this platform authenticates through Clerk and never
  -- copied the address into Postgres. If the name and number are not enough,
  -- search the Clerk dashboard for the user id.
  c.phone
FROM public.user_roles ur
LEFT JOIN public.profiles         p ON p.user_id = ur.user_id
LEFT JOIN public.profile_contacts c ON c.user_id = ur.user_id
WHERE ur.role::TEXT IN ('admin', 'semi_admin')
ORDER BY ur.role, p.full_name NULLS LAST;


-- ── 2. The shape of the user base ────────────────────────────────────────────
-- A sanity check rather than a hunt. A jump in `hotel_manager` or `owner` well
-- beyond the number of hotels and properties that actually exist means accounts
-- were upgrading themselves for the trial.
SELECT
  role::TEXT                                   AS role,
  count(*)                                     AS accounts,
  count(*) FILTER (WHERE is_verified)          AS marked_verified
FROM public.user_roles
GROUP BY role
ORDER BY accounts DESC;


-- ── 3. Verified badges that no admin necessarily granted ─────────────────────
-- ProfileSettings used to pass is_verified = true when a user chose their
-- account type, so the badge the Admin panel presents as a platform check was
-- partly self-awarded. `set_my_role()` no longer touches the column, but rows
-- written before it keep what they were given.
--
-- This matters most for `agent`: the agent card renders a verification tick to
-- renters, which is a trust signal a stranger acts on.
SELECT
  ur.user_id,
  ur.role::TEXT AS role,
  p.full_name,
  c.phone
FROM public.user_roles ur
LEFT JOIN public.profiles         p ON p.user_id = ur.user_id
LEFT JOIN public.profile_contacts c ON c.user_id = ur.user_id
WHERE ur.is_verified
  AND ur.role::TEXT NOT IN ('admin', 'semi_admin')
ORDER BY ur.role, p.full_name NULLS LAST;


-- ── 4. Business accounts with no plan behind them ────────────────────────────
-- A hotel_manager, owner or agent who has never had a subscription — not even a
-- trial. Mostly this is people who signed up and stopped, which is normal and
-- not interesting.
--
-- It is worth a look anyway, because it is where the *next* leak would show:
-- an account using the paid tools without a row here means a BillingGate is
-- being passed some other way.
SELECT
  ur.user_id,
  ur.role::TEXT AS role,
  p.full_name,
  c.phone
FROM public.user_roles ur
LEFT JOIN public.profiles         p ON p.user_id = ur.user_id
LEFT JOIN public.profile_contacts c ON c.user_id = ur.user_id
WHERE ur.role::TEXT IN ('owner', 'hotel_manager', 'agent')
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
     WHERE s.subject_type = 'user' AND s.subject_id = ur.user_id
  )
ORDER BY ur.role;


-- ── 5. Accounts that took more than one trial ────────────────────────────────
-- The role-switch loop 20260908000001 closed: trial `pms` as an owner, let it
-- lapse, switch to hotel_manager, trial `hotel` for another fourteen days.
--
-- Rows here are from BEFORE the fix — the loop is not reachable now, since both
-- the frozen role and the one-trial-ever check block it. Any row dated AFTER
-- the migration applied means the fix is not holding and should be reported.
SELECT
  s.subject_type,
  s.subject_id,
  count(*)                              AS trials,
  array_agg(s.plan ORDER BY s.created_at) AS plans,
  min(s.created_at)                     AS first_trial,
  max(s.created_at)                     AS latest_trial
FROM public.subscriptions s
WHERE s.trial_ends_at IS NOT NULL
GROUP BY s.subject_type, s.subject_id
HAVING count(*) > 1
ORDER BY latest_trial DESC;
