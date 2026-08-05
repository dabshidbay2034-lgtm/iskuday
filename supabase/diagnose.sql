-- =============================================================================
-- MIGRATION STATE DIAGNOSTIC — safe, read-only, changes nothing.
--
-- Paste the whole file into the Supabase SQL editor and send back the output.
-- It answers, in one pass: which migrations have actually landed, and therefore
-- why the app is failing.
--
-- Expected end state after BOTH migrations:
--   every row says OK
-- =============================================================================

WITH checks AS (

  -- ── 1. Clerk migration (20260804000001) helper functions ──────────────────
  --    The PMS migration calls all of these but creates none of them.
  SELECT 1 AS ord, 'clerk: current_org_id()' AS check,
         (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'current_org_id') AS ok,
         'run 20260804000001_migrate_to_clerk_auth.sql' AS fix

  UNION ALL SELECT 2, 'clerk: current_org_role()',
         (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'current_org_role'),
         'run 20260804000001_migrate_to_clerk_auth.sql'

  UNION ALL SELECT 3, 'clerk: current_user_id()',
         (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'current_user_id'),
         'run 20260804000001_migrate_to_clerk_auth.sql'

  -- has_role must be the TEXT rewrite. If it is still (uuid, app_role) the
  -- Clerk migration did not finish, and every policy calling
  -- has_role(auth.jwt()->>'sub', …) fails to resolve.
  -- Checked via proargtypes, not the formatted argument string: the formatted
  -- version renders type names subject to search_path and can false-negative.
  UNION ALL SELECT 4, 'clerk: has_role(TEXT, app_role) [not uuid]',
         (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'has_role'
            AND p.pronargs >= 1 AND p.proargtypes[0] = 'text'::regtype),
         'run 20260804000001_migrate_to_clerk_auth.sql (STEP 6)'

  -- ── 2. Clerk migration: user id columns must be TEXT, not uuid ────────────
  --    Clerk ids look like user_2abc…, which will never fit a uuid column.
  UNION ALL SELECT 5, 'clerk: profiles.user_id is text',
         (SELECT data_type = 'text' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'user_id'),
         'run 20260804000001_migrate_to_clerk_auth.sql (STEP 2)'

  UNION ALL SELECT 6, 'clerk: user_roles.user_id is text',
         (SELECT data_type = 'text' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'user_id'),
         'run 20260804000001_migrate_to_clerk_auth.sql (STEP 2)'

  UNION ALL SELECT 7, 'clerk: properties.owner_id is text',
         (SELECT data_type = 'text' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'owner_id'),
         'run 20260804000001_migrate_to_clerk_auth.sql (STEP 2)'

  -- ── 3. No policy may still reference auth.uid() ───────────────────────────
  --    Clerk JWTs make auth.uid() NULL, so any surviving policy denies everyone.
  UNION ALL SELECT 8, 'clerk: no policy still uses auth.uid()',
         (SELECT count(*) = 0 FROM pg_policies
          WHERE schemaname IN ('public', 'storage')
            AND (COALESCE(qual, '') LIKE '%auth.uid()%'
              OR COALESCE(with_check, '') LIKE '%auth.uid()%')),
         'rerun 20260804000001_migrate_to_clerk_auth.sql (STEP 8)'

  -- ── 4. PMS migration (20260805000001) tables ──────────────────────────────
  --    profile_contacts is what CompleteProfile writes the phone number to.
  --    If it is missing, saving phone + user type fails.
  UNION ALL SELECT 9, 'pms: profile_contacts exists  <-- phone save needs this',
         (SELECT to_regclass('public.profile_contacts') IS NOT NULL),
         'run 20260805000001_pms_foundation.sql'

  UNION ALL SELECT 10, 'pms: property_private exists',
         (SELECT to_regclass('public.property_private') IS NOT NULL),
         'run 20260805000001_pms_foundation.sql'

  UNION ALL SELECT 11, 'pms: tenants exists',
         (SELECT to_regclass('public.tenants') IS NOT NULL),
         'run 20260805000001_pms_foundation.sql'

  UNION ALL SELECT 12, 'pms: rent_ledger exists',
         (SELECT to_regclass('public.rent_ledger') IS NOT NULL),
         'run 20260805000001_pms_foundation.sql'

  UNION ALL SELECT 13, 'pms: utility_bills exists',
         (SELECT to_regclass('public.utility_bills') IS NOT NULL),
         'run 20260805000001_pms_foundation.sql'

  UNION ALL SELECT 14, 'pms: owns_property() exists',
         (SELECT count(*) > 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'owns_property'),
         'run 20260805000001_pms_foundation.sql'

  -- ── 5. PMS migration: the phone leak must be closed ───────────────────────
  UNION ALL SELECT 15, 'pms: profiles.phone columns dropped (privacy)',
         (SELECT count(*) = 0 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'profiles'
            AND column_name IN ('phone', 'phone2', 'phone3')),
         'run 20260805000001_pms_foundation.sql (STEP 2c)'

  -- ── 6. PMS migration: solo landlords must not be locked out ───────────────
  UNION ALL SELECT 16, 'pms: rent_ledger.org_id is NULLABLE (solo owners)',
         (SELECT is_nullable = 'YES' FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'rent_ledger' AND column_name = 'org_id'),
         'rerun 20260805000001_pms_foundation.sql'

  -- ── 7. Services migration (Gemini's track) ────────────────────────────────
  UNION ALL SELECT 17, 'services: services table exists',
         (SELECT to_regclass('public.services') IS NOT NULL),
         'run 20260805000002_services.sql'
)

SELECT
  ord AS "#",
  check,
  CASE WHEN COALESCE(ok, false) THEN 'OK' ELSE 'MISSING' END AS status,
  CASE WHEN COALESCE(ok, false) THEN '' ELSE fix END AS how_to_fix
FROM checks
ORDER BY ord;
