-- =============================================================================
-- ⚠️  DESTRUCTIVE & IRREVERSIBLE MIGRATION — READ BEFORE RUNNING  ⚠️
-- =============================================================================
--
-- Migrates this Supabase project from Supabase Auth to Clerk. After this runs:
--   • auth.users no longer backs any public table.
--   • Every user FK (UUID → auth.users) is gone and the column is now TEXT
--     holding Clerk user ids ("user_2abc...").
--   • Every RLS policy reads Clerk JWT claims instead of auth.uid().
--   • The on_auth_user_created trigger + handle_new_user() are gone; the
--     supabase/functions/clerk-webhook edge function now owns profile + staff
--     provisioning.
--
-- ── PRECONDITIONS (must be true BEFORE this migration runs) ──────────────────
--   1. Existing Supabase Auth users have been imported into Clerk.
--   2. A temporary mapping table public.id_map(old_uuid UUID, clerk_id TEXT)
--      has been populated with the uuid→Clerk-id pairs for every existing user.
--      (Template + the backfill statements that USE it are included below,
--      commented out — uncomment and run them as a SEPARATE step, BEFORE the
--      type conversions, against a snapshot/backup.)
--   3. The Clerk JWT template is published (see docs/CLERK_SETUP.md) and emits:
--        sub                    → Clerk user id
--        o.id                   → active organization id
--        o.rol                  → active organization role (org:admin|manager|agent|viewer)
--      Without that template the new policies reject every request.
--   4. A full database backup has been taken. This migration cannot be rolled
--      back without one — the FK removal and type changes are not reversible
--      once existing rows are gone.
--
-- ── CLAIM MAPPING USED BELOW ─────────────────────────────────────────────────
--     current Clerk user   →  auth.jwt()->>'sub'
--     active org id        →  auth.jwt()->'o'->>'id'
--     active org role      →  auth.jwt()->'o'->>'rol'
--
-- DO NOT RUN THIS AGAINST A PRODUCTION DATABASE WITHOUT ALL OF THE ABOVE.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — Optional backfill (uncomment & run as a discrete step BEFORE step 1).
-- Requires public.id_map(old_uuid UUID, clerk_id TEXT) to already exist &
-- be populated. Replaces the UUID-as-text values that step 1 leaves behind with
-- real Clerk user ids, row by row, so foreign relationships survive.
-- -----------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS public.id_map (old_uuid UUID PRIMARY KEY, clerk_id TEXT NOT NULL);
-- -- …populate id_map from your Clerk export / migration script…
--
-- UPDATE public.profiles   p SET user_id  = m.clerk_id FROM public.id_map m WHERE m.old_uuid::text = p.user_id;
-- UPDATE public.user_roles ur SET user_id  = m.clerk_id FROM public.id_map m WHERE m.old_uuid::text = ur.user_id;
-- UPDATE public.properties pr SET owner_id = m.clerk_id FROM public.id_map m WHERE m.old_uuid::text = pr.owner_id;
-- UPDATE public.favorites  f SET user_id  = m.clerk_id FROM public.id_map m WHERE m.old_uuid::text = f.user_id;
-- UPDATE public.inquiries  i SET sender_id = m.clerk_id FROM public.id_map m WHERE m.old_uuid::text = i.sender_id
--   WHERE i.sender_id IS NOT NULL;
-- -- Drop id_map once verified:
-- -- DROP TABLE public.id_map;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the tables we are about to re-type.
--
--          Postgres refuses `ALTER COLUMN ... TYPE` while any policy references
--          that column:
--            ERROR: 0A000: cannot alter type of a column used in a policy definition
--
--          So the policies MUST come off before STEP 2, not after. They are all
--          recreated with Clerk claim mapping in STEP 8.
--
--          This drops policies dynamically rather than by name: policies added
--          through the Supabase dashboard never appear in these migration files,
--          and a single missed one blocks the whole migration. Any policy on
--          these tables is superseded by STEP 8 / STEP 10 regardless.
--
--          storage.objects is deliberately NOT included — it is not being
--          re-typed, and blanket-dropping its policies would break buckets
--          unrelated to this app. Those are dropped by name in STEP 8.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles', 'user_roles', 'properties',
        'favorites', 'inquiries', 'property_images',
        -- Not re-typed, but included so this migration is RE-RUNNABLE: Postgres
        -- has no CREATE POLICY IF NOT EXISTS, so a second run would otherwise
        -- die with 42710 "policy ... already exists" at STEP 10. On the first
        -- run the table does not exist yet and pg_policies simply returns no
        -- rows for it.
        'staff_permissions'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — Drop FKs to auth.users, then convert user columns UUID → TEXT.
--          (favorites.user_id has no FK today, but we still widen it to TEXT.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles   DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_owner_id_fkey;
ALTER TABLE public.inquiries  DROP CONSTRAINT IF EXISTS inquiries_sender_id_fkey;

-- Type conversions. `USING <col>::text` keeps the existing value as its text
-- representation; the backfill in STEP 0 is what swaps UUID-strings for Clerk
-- ids. NULL allowed columns (inquiries.sender_id) stay nullable.
ALTER TABLE public.profiles   ALTER COLUMN user_id  TYPE TEXT USING user_id::text;
ALTER TABLE public.user_roles ALTER COLUMN user_id  TYPE TEXT USING user_id::text;
ALTER TABLE public.properties ALTER COLUMN owner_id TYPE TEXT USING owner_id::text;
ALTER TABLE public.favorites  ALTER COLUMN user_id  TYPE TEXT USING user_id::text;
ALTER TABLE public.inquiries  ALTER COLUMN sender_id TYPE TEXT USING sender_id::text;


-- -----------------------------------------------------------------------------
-- STEP 3 — Agency / organization columns. Agencies are Clerk Organizations.
--          properties.org_id  → which agency a listing belongs to.
--          profiles.org_id    → the user's primary/active agency (denormalized
--                               for convenience; the webhook keeps it fresh).
-- -----------------------------------------------------------------------------
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE public.profiles   ADD COLUMN IF NOT EXISTS org_id TEXT;

CREATE INDEX IF NOT EXISTS idx_properties_org_id ON public.properties(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org_id  ON public.profiles(org_id);


-- -----------------------------------------------------------------------------
-- STEP 4 — public.staff_permissions. The DB mirror of Clerk org memberships so
--          RLS + analytics can reason about staff without a round-trip to Clerk.
--          Populated by the clerk-webhook edge function (Part C).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_permissions (
  org_id      TEXT        NOT NULL,
  user_id     TEXT        NOT NULL,
  role        TEXT        NOT NULL,                 -- 'org:admin' | 'org:manager' | 'org:agent' | 'org:viewer'
  permissions TEXT[]      NOT NULL DEFAULT '{}',    -- granted permission keys, mirrored from ROLE_PERMISSIONS
  invited_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_permissions_pkey PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_permissions_user ON public.staff_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_permissions_org  ON public.staff_permissions(org_id);

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- STEP 5 — Helper: read the active Clerk org role as a clean string (or NULL).
--          Centralized so the org-aware policies below stay readable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT auth.jwt()->'o'->>'id';
$$;

CREATE OR REPLACE FUNCTION public.current_org_role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT auth.jwt()->'o'->>'rol';
$$;


-- -----------------------------------------------------------------------------
-- STEP 6 — Rewrite has_role() to take TEXT (Clerk user ids) instead of UUID.
--
--          ORDER MATTERS: create the TEXT version FIRST, drop the UUID one
--          after, and never let that drop abort the migration.
--
--          The previous version did the drop first, which is a trap. `IF EXISTS`
--          only guards against the function being absent — it does NOT survive a
--          dependency error. Any surviving object referencing
--          has_role(uuid, app_role) — a policy on a table this migration does
--          not manage, a view, a generated column — makes the DROP raise
--          2BP01 and, because the Supabase SQL editor runs no transaction,
--          the script dies right there with every earlier step still applied.
--          The symptom is bizarre: current_org_id() exists (created just above)
--          while has_role(TEXT) does not (created just below), so the migration
--          looks half-done for no visible reason.
--
--          The two signatures can coexist safely: every call site passes
--          auth.jwt()->>'sub', which is text, so overload resolution picks the
--          TEXT one. Leaving a stale UUID overload behind is harmless; failing
--          to create the TEXT one breaks every policy in the database.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id TEXT, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Now retire the old UUID signature — best effort. If something still depends
-- on it the drop is skipped with a notice instead of killing the migration;
-- the TEXT version above already exists by this point, which is the part that
-- actually matters. Re-run the migration after clearing the dependency to
-- finish the cleanup.
DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role);
  RAISE NOTICE 'has_role(uuid, app_role): dropped (or was already absent).';
EXCEPTION
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE
      'has_role(uuid, app_role) kept: % — harmless, calls pass text and resolve to the TEXT overload.',
      SQLERRM;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'has_role(uuid, app_role) kept: insufficient privilege. Harmless.';
END $$;

-- Convenience overload used by the rewritten policies below.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT auth.jwt()->>'sub';
$$;


-- -----------------------------------------------------------------------------
-- STEP 7 — Drop the Supabase-Auth signup machinery. Clerk owns signup now; the
--          clerk-webhook edge function provisions profiles + staff_permissions.
-- -----------------------------------------------------------------------------
--          Both drops are best-effort for the same reason as STEP 6: the
--          trigger lives on auth.users, which the role running this script does
--          not necessarily own, and if that drop fails then handle_new_user()
--          still has a dependent and its own drop fails too. Neither is worth
--          aborting the migration over — a leftover trigger simply tries to
--          insert a profile row that the Clerk webhook now owns.
DO $$
BEGIN
  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  RAISE NOTICE 'on_auth_user_created: dropped (or already absent).';
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    RAISE WARNING
      'Could not drop trigger on_auth_user_created on auth.users (%). Remove it from the Supabase dashboard: it will keep firing on signup and fight the clerk-webhook.',
      SQLERRM;
END $$;

DO $$
BEGIN
  DROP FUNCTION IF EXISTS public.handle_new_user();
  RAISE NOTICE 'handle_new_user(): dropped (or already absent).';
EXCEPTION
  WHEN dependent_objects_still_exist THEN
    RAISE WARNING 'handle_new_user() kept, still referenced: %', SQLERRM;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 8 — Rewrite EVERY existing RLS policy from auth.uid() to Clerk claims.
--          Drop all 31 policies created across the earlier migrations (by name,
--          IF EXISTS, to be robust to partial state), then recreate the final
--          EFFECTIVE set with the new claim mapping.
--          Current user  →  auth.jwt()->>'sub'
--          Active org id →  auth.jwt()->'o'->>'id'
--          Active org role → auth.jwt()->'o'->>'rol'
-- -----------------------------------------------------------------------------

-- 8a. Policies on the six public tables were already removed in STEP 1 — they
--     had to come off before those columns could be re-typed. Only the
--     storage.objects policies remain to be dropped here, by name, so that
--     unrelated buckets in this project keep their own policies intact.
DROP POLICY IF EXISTS "Property images are publicly accessible"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload property images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own property images"           ON storage.objects;

-- 7b. profiles — public read; self can insert/update.
CREATE POLICY "Profiles viewable by everyone" ON public.profiles
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.jwt()->>'sub' = user_id)
  WITH CHECK (auth.jwt()->>'sub' = user_id);

-- 7c. user_roles — self read/insert/update + platform admin overrides.
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Users can insert own roles" ON public.user_roles
  FOR INSERT WITH CHECK (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Users can update own role" ON public.user_roles
  FOR UPDATE
  USING (auth.jwt()->>'sub' = user_id)
  WITH CHECK (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Admins can view all user roles" ON public.user_roles
  FOR SELECT
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));
CREATE POLICY "Admins can update any user role" ON public.user_roles
  FOR UPDATE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'))
  WITH CHECK (public.has_role(auth.jwt()->>'sub', 'admin'));
CREATE POLICY "Semi admins can view all user roles" ON public.user_roles
  FOR SELECT
  USING (public.has_role(auth.jwt()->>'sub', 'semi_admin'));

-- 7d. properties — public listings (minus hidden), owner write, platform
--     admin/semi_admin overrides. Org-aware staff write lives in STEP 9.
CREATE POLICY "Properties viewable by everyone (excluding hidden)" ON public.properties
  FOR SELECT
  USING (
    NOT is_hidden
    OR public.has_role(auth.jwt()->>'sub', 'admin')
    OR public.has_role(auth.jwt()->>'sub', 'semi_admin')
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
  );
CREATE POLICY "Admins can view all properties including hidden" ON public.properties
  FOR SELECT
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));
CREATE POLICY "Owners can insert properties" ON public.properties
  FOR INSERT
  WITH CHECK (
    owner_id = auth.jwt()->>'sub'
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
  );
CREATE POLICY "Owners can update own properties" ON public.properties
  FOR UPDATE
  USING (owner_id = auth.jwt()->>'sub');
CREATE POLICY "Owners can delete own properties" ON public.properties
  FOR DELETE
  USING (owner_id = auth.jwt()->>'sub');
CREATE POLICY "Admins can update any property" ON public.properties
  FOR UPDATE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));
CREATE POLICY "Admins can delete any property" ON public.properties
  FOR DELETE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));
CREATE POLICY "Semi admins can view all properties" ON public.properties
  FOR SELECT
  USING (public.has_role(auth.jwt()->>'sub', 'semi_admin'));

-- 7e. property_images — gated through the parent property's owner/org.
CREATE POLICY "Images viewable by everyone" ON public.property_images
  FOR SELECT USING (true);
CREATE POLICY "Property owners can insert images" ON public.property_images
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties
    WHERE id = property_id
      AND (owner_id = auth.jwt()->>'sub'
           OR (org_id IS NOT NULL AND org_id = public.current_org_id()))
  ));
CREATE POLICY "Property owners can delete images" ON public.property_images
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.properties
    WHERE id = property_id
      AND (owner_id = auth.jwt()->>'sub'
           OR (org_id IS NOT NULL AND org_id = public.current_org_id()))
  ));

-- 7f. inquiries — any signed-in Clerk user can send; recipient owner or sender reads.
CREATE POLICY "Authenticated users can insert inquiries" ON public.inquiries
  FOR INSERT WITH CHECK (auth.jwt()->>'sub' IS NOT NULL);
CREATE POLICY "Owners can view their property inquiries" ON public.inquiries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE id = property_id
        AND (owner_id = auth.jwt()->>'sub'
             OR (org_id IS NOT NULL AND org_id = public.current_org_id()))
    )
    OR sender_id = auth.jwt()->>'sub'
  );

-- 7g. favorites — strictly per-user.
CREATE POLICY "Users can view own favorites" ON public.favorites
  FOR SELECT USING (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Users can insert own favorites" ON public.favorites
  FOR INSERT WITH CHECK (auth.jwt()->>'sub' = user_id);
CREATE POLICY "Users can delete own favorites" ON public.favorites
  FOR DELETE USING (auth.jwt()->>'sub' = user_id);

-- 7h. storage.objects — public read for property-images bucket; signed-in
--     uploads; owners (by Clerk id, now a folder prefix) can delete. The folder
--     layout uses the Clerk user id as the first path segment.
CREATE POLICY "Property images are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'property-images');
CREATE POLICY "Authenticated users can upload property images" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'property-images' AND auth.jwt()->>'sub' IS NOT NULL);
CREATE POLICY "Users can delete own property images" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'property-images'
    AND (auth.jwt()->>'sub') = (storage.foldername(name))[1]
  );


-- -----------------------------------------------------------------------------
-- STEP 9 — Org-aware staff policies. Staff act on their agency's properties
--          according to their active Clerk org role:
--             org:admin / org:manager / org:agent → can UPDATE + DELETE
--             org:viewer                          → cannot
--          (Viewer read is already covered by the org_id branch of the public
--           SELECT policy in 7d.) These are ADDITIVE to the owner policies —
--          Postgres allows multiple policies of the same command, OR'd together.
-- -----------------------------------------------------------------------------
CREATE POLICY "Org staff can update agency properties" ON public.properties
  FOR UPDATE
  USING (
    org_id IS NOT NULL
    AND org_id = public.current_org_id()
    AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
  )
  WITH CHECK (
    org_id IS NOT NULL
    AND org_id = public.current_org_id()
    AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
  );

CREATE POLICY "Org staff can delete agency properties" ON public.properties
  FOR DELETE
  USING (
    org_id IS NOT NULL
    AND org_id = public.current_org_id()
    AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
  );


-- -----------------------------------------------------------------------------
-- STEP 10 — staff_permissions RLS. Org admins manage staff; org members read
--          their own agency's staff rows. (Writes normally come from the
--          webhook with the service-role key, which bypasses RLS.)
-- -----------------------------------------------------------------------------
CREATE POLICY "Org members can read their staff" ON public.staff_permissions
  FOR SELECT
  USING (org_id = public.current_org_id());

CREATE POLICY "Org admins can manage staff" ON public.staff_permissions
  FOR ALL
  USING (
    org_id = public.current_org_id()
    AND public.current_org_role() = 'org:admin'
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_org_role() = 'org:admin'
  );

-- A user can always read their own staff row across orgs (e.g. to know their
-- own role without an active-org context).
CREATE POLICY "Users can read own staff rows" ON public.staff_permissions
  FOR SELECT
  USING (user_id = auth.jwt()->>'sub');


-- =============================================================================
-- End of migration. Verify with:
--   \d+ public.staff_permissions
--   SELECT polname, polcmd, pg_get_expr(polqual, polrelid) FROM pg_policy;
-- and confirm no policy references auth.uid() / auth.role() anywhere:
--   SELECT * FROM pg_policy WHERE pg_get_expr(polqual, polrelid) LIKE '%auth.uid()%'
--                             OR pg_get_expr(polqual, polrelid) LIKE '%auth.role()%';
-- =============================================================================
