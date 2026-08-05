-- =============================================================================
-- Read-only. Shows every has_role overload that actually exists, and anything
-- still depending on the old uuid one. Paste the whole file and send the output.
-- =============================================================================

-- 1. Every has_role currently defined, with its real argument types.
--    Expected after the Clerk migration: exactly one row, args = "text, app_role".
--    If you see "uuid, app_role" instead, STEP 6 never applied.
SELECT
  'has_role overload' AS what,
  n.nspname                                     AS schema,
  p.proname                                     AS name,
  pg_get_function_identity_arguments(p.oid)     AS args,
  p.proargtypes[0]::regtype::text               AS first_arg_type,
  pg_get_functiondef(p.oid) LIKE '%SECURITY DEFINER%' AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'has_role'
ORDER BY 4;

-- 2. If step 1 returns NOTHING, has_role does not exist at all and the Clerk
--    migration failed well before STEP 6. If it returns a uuid row, something
--    blocked the DROP — most often a policy still referencing it. This lists
--    every policy whose expression mentions has_role, i.e. the likely blockers.
SELECT
  'policy referencing has_role' AS what,
  schemaname, tablename, policyname, cmd,
  COALESCE(qual, '') || ' | ' || COALESCE(with_check, '') AS expression
FROM pg_policies
WHERE COALESCE(qual, '')       LIKE '%has_role%'
   OR COALESCE(with_check, '') LIKE '%has_role%'
ORDER BY schemaname, tablename, policyname;

-- 3. The app_role enum must exist and contain semi_admin, or the CREATE in
--    STEP 6 fails on the argument type itself.
SELECT
  'app_role enum values' AS what,
  string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typname = 'app_role';

-- 4. Did the column type conversion actually happen? has_role(text, …) compares
--    user_id = _user_id, so a surviving uuid column would make it fail anyway.
SELECT
  'user id column types' AS what,
  table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
    ('profiles','user_id'), ('user_roles','user_id'), ('properties','owner_id')
  )
ORDER BY table_name;
