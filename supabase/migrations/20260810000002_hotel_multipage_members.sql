-- =============================================================================
-- Migration: 20260810000001_hotel_multipage_members.sql
--
-- Turns a hotel website from ONE page into a small SITE (up to 3 pages), and
-- introduces a per-hotel access layer so a hotelier can hand editing rights to
-- someone who is neither the owner nor a member of an agency.
--
-- WHAT THIS ADDS:
--   • hotel_pages   — up to 3 pages per hotel, each with its own `sections`
--     block list (the same jsonb shape 20260809000001 put on hotels.sections),
--     its own slug, and its own publish switch. Exactly one page per hotel is
--     the home page.
--   • hotel_members — (hotel_id, user_id) → hotel_admin / hotel_editor /
--     hotel_viewer. This is a THIRD trust path alongside "owner" and "agency
--     staff": invite a manager to one hotel without giving them the org.
--   • hotels.subdomain — the DNS label that maps to
--     <subdomain>.mogadishurents.com, backfilled from `slug` where the slug is
--     already a legal label.
--   • public.hotel_member_role() and public.hotel_member_admin() helpers, plus
--     a CREATE OR REPLACE of public.hotel_managed() that adds the membership
--     branch and keeps every existing branch verbatim.
--
-- WHAT THIS DOES **NOT** DO:
--   hotels.sections is deliberately LEFT IN PLACE. The editor, the public page
--   and useMyHotels() all still read it, and the home page's copy in
--   hotel_pages is a mirror, not a move. Dropping it here would break every one
--   of those surfaces in the same deploy; retiring it is a separate migration
--   once nothing reads it.
--
-- ── THE RECURSION TRAP (read before touching the helpers) ───────────────────
-- hotel_members' own policies call hotel_managed(), which calls
-- hotel_member_role(), which SELECTs hotel_members. If either helper were
-- SECURITY INVOKER, that SELECT would re-enter hotel_members' RLS and Postgres
-- would abort every query on the table with 42P17 (infinite recursion in policy
-- for relation). SECURITY DEFINER is what breaks the cycle: the body runs as
-- the function owner, who is not subject to the table's RLS. Do not "tidy" the
-- SECURITY DEFINER off these two functions.
--
-- ── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- STEP 1 drops every policy on the two tables this file owns, dynamically —
-- Postgres has no CREATE POLICY IF NOT EXISTS and a re-run would otherwise die
-- with 42710. `hotels` is deliberately NOT in that list: its policies belong to
-- 20260808000001 and dropping them here would leave the table unreachable.
-- Everything else is IF NOT EXISTS / DROP-then-ADD, and the two data
-- migrations at the end are guarded so a second run is a no-op.
--
-- ── ORDERING ───────────────────────────────────────────────────────────────
-- Same rule as 20260808000001: `LANGUAGE sql` bodies are resolved against the
-- catalog at CREATE FUNCTION time, so they cannot forward-reference. Hence:
-- tables → hotel_member_role() → hotel_member_admin() → hotel_managed() →
-- policies. The plpgsql cap trigger is exempt but is kept next to its table.
--
-- ── PRECONDITIONS ──────────────────────────────────────────────────────────
--   20260804000001 (current_org_id / current_org_role / has_role /
--   update_updated_at_column) and 20260808000001 (hotels, hotel_managed).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT.
--
--   This file CREATE OR REPLACEs hotel_managed(). If 20260808000001 has not run,
--   that REPLACE silently becomes a CREATE of a *different* function than the
--   one 20260808000001 will later install — and whichever file runs last wins,
--   quietly. Failing loudly here is far cheaper than debugging a hotels table
--   whose managers changed depending on migration order.
--
--   Probed through pg_proc rather than to_regprocedure() so a missing
--   public.app_role type reports as "has_role is missing" rather than throwing
--   an unrelated type-resolution error (same reasoning as 20260805000001).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_managed'
  ) THEN missing := array_append(missing, 'public.hotel_managed(uuid)  [20260808000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotels' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotels  [20260808000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_id'
  ) THEN missing := array_append(missing, 'public.current_org_id()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_role'
  ) THEN missing := array_append(missing, 'public.current_org_role()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN missing := array_append(missing, 'public.update_updated_at_column()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
      AND p.pronargs >= 1
      AND p.proargtypes[0] = 'text'::regtype
  ) THEN missing := array_append(missing, 'public.has_role(TEXT, public.app_role)  [20260804000001]'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Hotel multi-page / members migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun the migration named in brackets to completion first. Nothing has been changed by this script.',
      array_to_string(missing, E'\n                        ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the tables this file owns.
--
--   Dropped dynamically, not by name: policies added through the Supabase
--   dashboard never appear in these migration files, and a single missed one
--   blocks the whole run. Any policy on these two tables is superseded by what
--   this file creates.
--
--   On a first run the tables do not exist and pg_policies returns no rows.
--   `hotels` is intentionally absent — see the header.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('hotel_pages', 'hotel_members')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 2 — hotel_pages.
--
-- `sections` carries the exact same block-list shape as hotels.sections
-- (20260809000001), so the editor's serializer is unchanged — it just writes to
-- a row per page instead of a column on the hotel.
--
-- slug semantics: '' or 'home' is the landing page. The empty string is allowed
-- so `/hotels/:hotelSlug/` and `/hotels/:hotelSlug/home` can both resolve
-- without the router inventing a segment. UNIQUE(hotel_id, slug) still keeps
-- them distinct rows if a page ever uses each spelling.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotel_pages (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  hotel_id     UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  slug         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  sections     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_order   INT         NOT NULL DEFAULT 0,
  is_home      BOOLEAN     NOT NULL DEFAULT false,
  is_published BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_pages_pkey PRIMARY KEY (id),
  CONSTRAINT hotel_pages_hotel_slug_key UNIQUE (hotel_id, slug)
);

-- CHECK constraints have no IF NOT EXISTS — drop then add for re-runnability.
-- The slug lands in a URL path, so it is restricted to the same lowercase
-- kebab alphabet slugify() already produces in src/hooks/use-hotels.ts.
ALTER TABLE public.hotel_pages DROP CONSTRAINT IF EXISTS hotel_pages_slug_check;
ALTER TABLE public.hotel_pages
  ADD CONSTRAINT hotel_pages_slug_check
  CHECK (slug = '' OR slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$');

CREATE INDEX IF NOT EXISTS idx_hotel_pages_hotel ON public.hotel_pages(hotel_id, sort_order);

-- ONE home page per hotel, enforced by a partial unique index rather than
-- application code. Consequence for callers: promoting a different page is two
-- statements (clear the old flag, then set the new one) because a unique index
-- cannot be DEFERRABLE — a single UPDATE touching both rows would trip mid
-- statement. useSetHomePage() in src/hooks/use-hotel-pages.ts does exactly that.
CREATE UNIQUE INDEX IF NOT EXISTS hotel_pages_one_home_per_hotel
  ON public.hotel_pages(hotel_id)
  WHERE is_home;

DROP TRIGGER IF EXISTS update_hotel_pages_updated_at ON public.hotel_pages;
CREATE TRIGGER update_hotel_pages_updated_at
  BEFORE UPDATE ON public.hotel_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- -----------------------------------------------------------------------------
-- STEP 2b — the 3-page cap, in the DATABASE.
--
-- A client-side "you already have 3 pages" check is advice, not a limit: the
-- anon key plus a POST to /rest/v1/hotel_pages bypasses the UI entirely, and
-- RLS cannot express "at most N rows" — a policy sees one candidate row, never
-- a count. A trigger is the only place the rule actually holds.
--
-- SECURITY DEFINER is load-bearing here, not decoration. The COUNT below runs
-- inside the caller's transaction; without SECURITY DEFINER it would be
-- filtered by hotel_pages' own SELECT policy, so a user who can only see the
-- published pages of a hotel would count 1 where there are 3 and sail past the
-- cap. The definer bypasses RLS and counts every row.
--
-- The advisory lock closes the concurrency hole: two simultaneous inserts would
-- otherwise both read "2" and both commit, leaving 4 pages. Keyed on the hotel
-- id so it serialises page creation for ONE hotel only, and taken as an _xact_
-- lock so it is released on commit/rollback with no unlock path to forget.
--
-- Fires on UPDATE OF hotel_id too: re-parenting a page is an insert into the
-- destination hotel by another name, and would otherwise be a free fourth page.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotel_pages_enforce_cap()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _max   CONSTANT INT := 3;
  _count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.hotel_id::text, 0::bigint));

  SELECT count(*) INTO _count
  FROM public.hotel_pages p
  WHERE p.hotel_id = NEW.hotel_id
    -- On a re-parenting UPDATE the moving row may already be counted under the
    -- destination hotel in a later re-run; never let it block itself.
    AND (TG_OP = 'INSERT' OR p.id <> NEW.id);

  IF _count >= _max THEN
    RAISE EXCEPTION
      'A hotel can have at most % pages (this hotel already has %). Delete a page before adding another.',
      _max, _count
      USING ERRCODE = '23514';   -- check_violation: the client maps it to a friendly message
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hotel_pages_cap ON public.hotel_pages;
CREATE TRIGGER hotel_pages_cap
  BEFORE INSERT OR UPDATE OF hotel_id ON public.hotel_pages
  FOR EACH ROW EXECUTE FUNCTION public.hotel_pages_enforce_cap();

COMMENT ON TABLE public.hotel_pages IS
  'Up to 3 pages per hotel (cap enforced by trigger hotel_pages_cap, not by the UI). Exactly one is_home page per hotel (partial unique index).';


-- =============================================================================
-- STEP 3 — hotel_members: per-hotel roles.
--
-- The third trust path. Until now editing a hotel required being its owner or
-- staff in the agency that owns it; a hotelier with no Clerk Organization had
-- no way to delegate at all. A membership row grants rights to ONE hotel and
-- carries no org context.
--
--   hotel_admin  — full control INCLUDING membership (invite / change / remove)
--   hotel_editor — edit and publish pages; explicitly NOT membership
--   hotel_viewer — read drafts; no writes at all
--
-- user_id is a Clerk id (TEXT) with no FK — Clerk users do not exist as rows in
-- this database, same as hotels.owner_id and rent_ledger.marked_by.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotel_members (
  hotel_id   UUID        NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  role       TEXT        NOT NULL,
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_members_pkey PRIMARY KEY (hotel_id, user_id)
);

ALTER TABLE public.hotel_members DROP CONSTRAINT IF EXISTS hotel_members_role_check;
ALTER TABLE public.hotel_members
  ADD CONSTRAINT hotel_members_role_check
  CHECK (role IN ('hotel_admin', 'hotel_editor', 'hotel_viewer'));

-- "Which hotels can I edit?" is a user_id lookup; the PK only covers hotel_id.
CREATE INDEX IF NOT EXISTS idx_hotel_members_user ON public.hotel_members(user_id);


-- =============================================================================
-- STEP 4 — hotels.subdomain.
--
-- Maps to <subdomain>.mogadishurents.com — a wildcard DNS record plus an edge
-- rewrite resolves the label to this hotel's page. Because the value becomes a
-- DNS label it must satisfy RFC 1123: lowercase alphanumerics and hyphens, no
-- leading or trailing hyphen, ≤ 32 characters here (well inside the 63 the RFC
-- allows, leaving room for the base domain).
--
-- ── RESERVED LABELS ────────────────────────────────────────────────────────
-- www / app / api / admin / mail / staging are refused by the CHECK itself
-- rather than by a trigger. A CHECK was chosen because:
--   • it is declarative — the reserved list shows up in \d and in the schema
--     dump, so the next person sees the rule without reading a function body;
--   • it applies to UPDATE as well as INSERT with no extra code, so a hotel
--     cannot rename its way onto `api` later;
--   • it cannot be disabled per-session the way `ALTER TABLE ... DISABLE
--     TRIGGER` can.
-- The trade-off is that extending the list means dropping and re-adding the
-- constraint — which is exactly what the DROP/ADD pair below already does on
-- every run, so the edit is one line here. The list is a constant expression,
-- so the constraint stays IMMUTABLE-safe.
-- =============================================================================
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS subdomain TEXT;

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_subdomain_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_subdomain_check
  CHECK (
    subdomain IS NULL
    OR (
      subdomain ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
      AND subdomain NOT IN ('www', 'app', 'api', 'admin', 'mail', 'staging')
    )
  );

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_subdomain_key;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_subdomain_key UNIQUE (subdomain);

COMMENT ON COLUMN public.hotels.subdomain IS
  'DNS label for <subdomain>.mogadishurents.com. RFC-1123 safe, <=32 chars, and never one of the reserved labels www/app/api/admin/mail/staging (see hotels_subdomain_check). NULL means the hotel is only reachable at /hotels/<slug>.';

-- Backfill from slug where the slug is already a legal, unreserved label.
-- Anything else (too long, an underscore, `admin`) is left NULL rather than
-- mangled — a silently truncated subdomain is a wrong URL, not a helpful one.
-- slug is UNIQUE on hotels, so the copied values cannot collide; the NOT EXISTS
-- guard only matters if someone hand-set a subdomain before this ran.
UPDATE public.hotels h
   SET subdomain = h.slug
 WHERE h.subdomain IS NULL
   AND h.slug ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
   AND h.slug NOT IN ('www', 'app', 'api', 'admin', 'mail', 'staging')
   AND NOT EXISTS (SELECT 1 FROM public.hotels o WHERE o.subdomain = h.slug);


-- =============================================================================
-- STEP 5 — public.hotel_member_role(): the caller's role on one hotel.
--
-- SECURITY DEFINER for two separate reasons, both required:
--   1. it is called from hotel_members' OWN policies (via hotel_managed), and
--      a SECURITY INVOKER body would recurse — see the header;
--   2. a viewer must still be able to discover their own role even though the
--      SELECT policy is itself written in terms of this function.
-- Returns NULL (not false) when there is no membership row, so callers can tell
-- "no membership" apart from "membership with no rights".
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotel_member_role(_hotel_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.role
  FROM public.hotel_members m
  WHERE m.hotel_id = _hotel_id
    AND m.user_id = auth.jwt()->>'sub'
  LIMIT 1
$$;


-- =============================================================================
-- STEP 6 — public.hotel_member_admin(): who may change WHO CAN EDIT.
--
-- Deliberately narrower than hotel_managed(): the hotel's own admin, the hotel
-- owner, or a platform admin — and nobody else. An org manager who can edit the
-- page through hotel_managed() still cannot rewrite the membership list.
--
-- The EXISTS on hotels is evaluated under this function's definer, so it does
-- not depend on the caller being able to SELECT the hotels row (a draft hotel
-- an editor cannot yet read would otherwise make the owner branch return NULL).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.hotel_member_admin(_hotel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    COALESCE(public.hotel_member_role(_hotel_id) = 'hotel_admin', false)
    OR EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = _hotel_id AND h.owner_id = auth.jwt()->>'sub'
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
$$;


-- =============================================================================
-- STEP 7 — extend public.hotel_managed().
--
-- Every branch from 20260808000001 is preserved verbatim (page owner, matching
-- active-org staff at admin/manager/agent, platform admin). The ONLY change is
-- the final OR: a hotel_admin or hotel_editor membership now also manages the
-- hotel. hotel_viewer is excluded — a viewer reads drafts and writes nothing.
--
-- Callers that already exist keep working unchanged: hotels' UPDATE/DELETE
-- policies and every hotel_rooms policy call this function, so an invited
-- editor gains exactly the rights an owner already had, and nothing more.
-- =============================================================================
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
        -- NEW in 20260810000001: per-hotel membership.
        OR public.hotel_member_role(_hotel_id) IN ('hotel_admin', 'hotel_editor')
      )
  )
$$;


-- =============================================================================
-- STEP 8 — RLS + policies on hotel_pages.
--
-- Read: a page is public only when BOTH switches are on — the page itself is
-- published AND its parent hotel is published. One switch would not be enough:
-- unpublishing a whole hotel site has to take its pages down with it, and
-- publishing a hotel must not silently expose a half-written sub-page.
--
-- The EXISTS against hotels runs under the CALLER's rights, so hotels' own
-- SELECT policy applies to it — that is fine and intended: 20260808000001 makes
-- `is_published = true` publicly selectable, so a published parent is always
-- visible to anon, and a draft parent falls through to hotel_managed() anyway.
-- =============================================================================
ALTER TABLE public.hotel_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published pages of published hotels are public" ON public.hotel_pages
  FOR SELECT
  USING (
    (
      is_published = true
      AND EXISTS (
        SELECT 1 FROM public.hotels h
        WHERE h.id = hotel_id AND h.is_published = true
      )
    )
    OR public.hotel_managed(hotel_id)
  );

-- Write: the same trust line as editing the hotel itself. The 3-page cap is NOT
-- expressible here (a policy sees one row, never a count) — it lives in the
-- hotel_pages_cap trigger in STEP 2b.
CREATE POLICY "Managers can create hotel pages" ON public.hotel_pages
  FOR INSERT
  WITH CHECK (public.hotel_managed(hotel_id));

CREATE POLICY "Managers can update hotel pages" ON public.hotel_pages
  FOR UPDATE
  USING (public.hotel_managed(hotel_id))
  WITH CHECK (public.hotel_managed(hotel_id));

CREATE POLICY "Managers can delete hotel pages" ON public.hotel_pages
  FOR DELETE
  USING (public.hotel_managed(hotel_id));


-- =============================================================================
-- STEP 9 — RLS + policies on hotel_members.
--
-- ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
-- AN EDITOR MUST NOT BE ABLE TO PROMOTE THEMSELVES. hotel_editor passes
-- hotel_managed(), so if the write policies here were written against
-- hotel_managed() — the obvious, wrong shortcut — any invited editor could
-- UPDATE their own row to hotel_admin and then invite whoever they liked. Every
-- write policy below is therefore written against hotel_member_admin(), which
-- admits only the hotel's own hotel_admin, the hotel owner, and platform
-- admins. Do not "simplify" these two helpers into one.
--
-- Read is wider than write on purpose: anyone who manages the hotel can see who
-- else has access (an editor needs to know who to ask), and every user can
-- always see their own row so the UI can render their role.
-- =============================================================================
ALTER TABLE public.hotel_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own membership or hotel managers can read members" ON public.hotel_members
  FOR SELECT
  USING (
    user_id = auth.jwt()->>'sub'
    OR public.hotel_managed(hotel_id)
  );

CREATE POLICY "Hotel admins can invite members" ON public.hotel_members
  FOR INSERT
  WITH CHECK (public.hotel_member_admin(hotel_id));

CREATE POLICY "Hotel admins can change member roles" ON public.hotel_members
  FOR UPDATE
  USING (public.hotel_member_admin(hotel_id))
  WITH CHECK (public.hotel_member_admin(hotel_id));

CREATE POLICY "Hotel admins can remove members" ON public.hotel_members
  FOR DELETE
  USING (public.hotel_member_admin(hotel_id));


-- =============================================================================
-- STEP 10 — DATA MIGRATION: every existing hotel gets its home page.
--
-- Each hotel's current `sections` value becomes a hotel_pages row with
-- slug='home', is_home=true, title=hotels.name and the hotel's own publish
-- state, so nothing appears or disappears from the public site as a result of
-- this migration. hotels.sections is NOT cleared — it stays as the legacy
-- mirror that useMyHotels()/usePublicHotelPage() still read (see header).
--
-- Dynamic SQL because a static reference to h.sections fails to PARSE — not
-- merely to execute — on a database where 20260809000001 has not run, which
-- would make this file un-runnable rather than degrade gracefully. Same
-- technique as the profile_contacts backfill in 20260805000001 STEP 2b.
--
-- Idempotent twice over: the NOT EXISTS skips hotels that already have any
-- page (a re-run must never manufacture a second home page and trip the
-- partial unique index), and ON CONFLICT covers the slug collision.
-- =============================================================================
DO $$
DECLARE
  has_sections BOOLEAN;
  created      BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hotels' AND column_name = 'sections'
  ) INTO has_sections;

  EXECUTE format(
    'INSERT INTO public.hotel_pages (hotel_id, slug, title, sections, sort_order, is_home, is_published)
     SELECT h.id, ''home'', h.name, %s, 0, true, COALESCE(h.is_published, false)
     FROM public.hotels h
     WHERE NOT EXISTS (SELECT 1 FROM public.hotel_pages p WHERE p.hotel_id = h.id)
     ON CONFLICT (hotel_id, slug) DO NOTHING',
    CASE WHEN has_sections
         THEN 'COALESCE(h.sections, ''[]''::jsonb)'
         ELSE '''[]''::jsonb'
    END
  );
  GET DIAGNOSTICS created = ROW_COUNT;

  IF has_sections THEN
    RAISE NOTICE 'hotel_pages backfill: % home page(s) created from hotels.sections.', created;
  ELSE
    RAISE NOTICE 'hotel_pages backfill: % empty home page(s) created (hotels.sections does not exist).', created;
  END IF;
END $$;


-- =============================================================================
-- End of migration. Verify with:
--
--   -- every hotel has exactly one home page, and no hotel has more than 3:
--   SELECT h.id, h.name, count(p.*) AS pages,
--          count(*) FILTER (WHERE p.is_home) AS homes
--     FROM public.hotels h LEFT JOIN public.hotel_pages p ON p.hotel_id = h.id
--    GROUP BY h.id, h.name HAVING count(p.*) > 3 OR count(*) FILTER (WHERE p.is_home) <> 1;
--
--   -- the cap really is enforced (this should raise 23514 on the 4th row):
--   INSERT INTO public.hotel_pages (hotel_id, slug, title)
--   SELECT id, 'p'||g, 'p'||g FROM public.hotels, generate_series(1,4) g LIMIT 4;
--
--   -- an editor cannot touch membership: every write policy on hotel_members
--   -- must reference hotel_member_admin, never hotel_managed (expect 0 rows):
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='hotel_members' AND cmd <> 'SELECT'
--      AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%hotel_member_admin%';
--
--   -- hotel_managed kept all four original branches plus the new one:
--   SELECT prosrc FROM pg_proc WHERE proname = 'hotel_managed';
--
--   -- reserved labels are refused (each of these must fail with 23514):
--   UPDATE public.hotels SET subdomain = 'admin' WHERE id = (SELECT id FROM public.hotels LIMIT 1);
--
--   SELECT id, slug, subdomain FROM public.hotels ORDER BY created_at;
-- =============================================================================
