-- =============================================================================
-- Bootstrap the FIRST platform admin.
--
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- to grant yourself the 'admin' role. After that you can promote others from
-- the Admin panel in the app.
--
-- This exists because of a chicken-and-egg deadlock:
--   • The Clerk webhook hardcodes every new account as role 'user'.
--   • CompleteProfile / ProfileSettings can self-upgrade only up to
--     owner / hotel_manager — never admin or semi_admin.
--   • The Admin panel — the only UI that can grant 'admin' — is itself gated
--     behind has_role(sub, 'admin') in RLS. So nobody can reach it until
--     somebody is already an admin.
--
--   => There is no in-app path to become the first admin. This script is it.
--
-- It runs with the SQL editor's privileges (bypasses RLS), so it does not need
-- you to already be an admin.
--
-- USAGE
--   1. Sign up in the app once (so the Clerk webhook has created your
--      profiles + user_roles rows).
--   2. Get your Clerk user id from the Clerk dashboard (looks like
--      "user_2abcDEF..."). Paste it below.
--   3. Run this whole file in the Supabase SQL editor.
--   4. Hard-refresh the app. Your Header now shows the admin links.
-- =============================================================================

-- >>> REPLACE WITH YOUR OWN CLERK USER ID <<<
--     (Clerk dashboard → Users → choose you → copy the "id" field)
DO $$
DECLARE
  _user_id TEXT := 'user_REPLACE_ME';   -- 👈 change this
  _touched INT;
BEGIN
  -- upsert the admin role against UNIQUE(user_id) (migration 20260805000003).
  -- If you already had a row (you will — the webhook made you 'user') this
  -- flips it to admin; if not, it inserts one.
  INSERT INTO public.user_roles (user_id, role, is_verified)
  VALUES (_user_id, 'admin', true)
  ON CONFLICT (user_id)
  DO UPDATE SET role = 'admin', is_verified = true
  RETURNING 1 INTO _touched;

  RAISE NOTICE 'OK — user % is now a platform admin.', _user_id;
END $$;

-- Sanity check: confirm it landed.
SELECT user_id, role, is_verified
FROM public.user_roles
WHERE user_id = 'user_REPLACE_ME';   -- 👈 same id as above
