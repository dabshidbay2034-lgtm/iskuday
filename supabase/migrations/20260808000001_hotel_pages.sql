-- =============================================================================
-- Migration: 20260808000001_hotel_pages.sql
--
-- Gives every hotel its own PUBLIC, customizable web page: hero image, photo
-- gallery, about text, featured rooms and a contact/footer section. This is the
-- "hotel website" surface that sits on top of the booking system
-- (20260807000001): rooms stay `properties` rows, and each property page links
-- to this hotel website while this website links back to the bookable rooms.
--
-- WHAT THIS ADDS:
--   • hotels — the page itself. One row per hotel website, owned by the user
--     who runs it (solo landlord) and/or the agency it belongs to. All the
--     visual/contact fields a hotelier edits live here.
--   • hotel_rooms — which of the owner's hotel-type rooms are displayed on the
--     page (a user can run several hotels, each showing a different subset).
--   • a storage bucket `hotel-assets` (public read, uploads into the
--     uploader's folder) for the hero image, logo and gallery photos.
--
-- VISIBILITY:
--   • Draft pages (is_published = false) are visible to the owner, their
--     agency staff and platform admins ONLY — the public URL 404s.
--   • Published pages are readable by everyone (SELECT policy on is_published).
--   • Managing a page (edit/publish/gallery/rooms) is the owner, org
--     admin/manager/agent, or a platform admin — same trust line as the rest.
--
-- RE-RUNNABLE: hotel table policies are dropped dynamically at the top, storage
-- policies by name, and buckets/columns via IF NOT EXISTS / IF EXISTS.
--
-- ORDERING NOTE: tables are created before hotel_managed(), and hotel_managed()
-- before any policy that calls it. `LANGUAGE sql` functions are resolved
-- against the catalog at CREATE FUNCTION time (unlike plpgsql), so a SQL
-- function that references a table which doesn't exist yet fails with
-- "relation does not exist" — it can't forward-reference like plpgsql can.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the tables this file owns, so the CREATE
--          POLICY statements below can never hit 42710 on a re-run.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('hotels', 'hotel_rooms')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- =============================================================================
-- STEP 2 — hotels.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotels (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  owner_id         TEXT        NOT NULL,               -- Clerk id who runs it
  org_id           TEXT,                               -- NULL for solo owners
  slug             TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  tagline          TEXT,
  description      TEXT,
  hero_image_url   TEXT,
  logo_url         TEXT,
  gallery          TEXT[]      NOT NULL DEFAULT '{}',
  accent_color     TEXT        NOT NULL DEFAULT '#0f766e',
  contact_phone    TEXT,
  contact_whatsapp TEXT,
  contact_email    TEXT,
  address          TEXT,
  maps_url         TEXT,
  socials          jsonb       NOT NULL DEFAULT '{}',  -- {facebook,instagram,tiktok,twitter}
  is_published     BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotels_pkey PRIMARY KEY (id),
  CONSTRAINT hotels_slug_key UNIQUE (slug)
);

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_accent_color_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_accent_color_check
  CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$');

DROP TRIGGER IF EXISTS update_hotels_updated_at ON public.hotels;
CREATE TRIGGER update_hotels_updated_at
  BEFORE UPDATE ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =============================================================================
-- STEP 3 — hotel_rooms: which bookable rooms appear on a hotel page.
--          Created right after hotels so its FK target already exists.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.hotel_rooms (
  hotel_id     UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  property_id  UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  sort_order   INT  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hotel_rooms_pkey PRIMARY KEY (hotel_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_hotel_rooms_property ON public.hotel_rooms(property_id);


-- =============================================================================
-- STEP 4 — public.hotel_managed(): can the current user edit/delete this page?
--
-- SECURITY DEFINER so the lookup isn't itself filtered by hotels' RLS.
-- Branches: the page owner, active-org staff (admin/manager/agent) when the
-- hotel belongs to that org, and platform admins. STABLE for planner reuse.
--
-- Must come after `hotels` exists (see ORDERING NOTE above) and before any
-- policy below that calls it.
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
      )
  )
$$;


-- =============================================================================
-- STEP 5 — RLS + policies on hotels.
-- =============================================================================
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

-- Read: published pages are public; drafts are owner/org/admin only.
CREATE POLICY "Published hotel pages are public" ON public.hotels
  FOR SELECT
  USING (
    is_published = true
    OR owner_id = auth.jwt()->>'sub'
    OR (org_id IS NOT NULL AND org_id = public.current_org_id())
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- Create: the owner creating their own page, or org staff creating an agency one.
CREATE POLICY "Owners or org staff can create hotel pages" ON public.hotels
  FOR INSERT
  WITH CHECK (
    owner_id = auth.jwt()->>'sub'
    OR (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager', 'org:agent')
    )
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- Edit / publish: public.hotel_managed() (owner, matching-org staff, admin).
CREATE POLICY "Managers can update hotel pages" ON public.hotels
  FOR UPDATE
  USING (public.hotel_managed(id))
  WITH CHECK (public.hotel_managed(id));

CREATE POLICY "Managers can delete hotel pages" ON public.hotels
  FOR DELETE
  USING (public.hotel_managed(id));


-- =============================================================================
-- STEP 6 — RLS + policies on hotel_rooms.
-- =============================================================================
ALTER TABLE public.hotel_rooms ENABLE ROW LEVEL SECURITY;

-- Read: only when the hotel page itself is readable (published → public).
CREATE POLICY "Hotel rooms follow page visibility" ON public.hotel_rooms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = hotel_id
        AND (h.is_published = true OR public.hotel_managed(h.id))
    )
  );

-- Manage links: same trust line as editing the page itself.
CREATE POLICY "Page managers can add hotel rooms" ON public.hotel_rooms
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = hotel_id AND public.hotel_managed(h.id)
    )
  );

CREATE POLICY "Page managers can update hotel rooms" ON public.hotel_rooms
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = hotel_id AND public.hotel_managed(h.id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = hotel_id AND public.hotel_managed(h.id)
    )
  );

CREATE POLICY "Page managers can remove hotel rooms" ON public.hotel_rooms
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.hotels h
      WHERE h.id = hotel_id AND public.hotel_managed(h.id)
    )
  );


-- =============================================================================
-- STEP 7 — storage bucket for page assets (hero / logo / gallery).
--          Public-read, uploads into the uploader's own folder, folder-owner
--          delete — same shape as property-images.
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-assets', 'hotel-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Hotel assets are publicly accessible" ON storage.objects;
CREATE POLICY "Hotel assets are publicly accessible" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'hotel-assets');

DROP POLICY IF EXISTS "Authenticated users can upload hotel assets" ON storage.objects;
CREATE POLICY "Authenticated users can upload hotel assets" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'hotel-assets'
    AND auth.jwt()->>'sub' IS NOT NULL
    AND (storage.foldername(name))[1] = auth.jwt()->>'sub'
  );

DROP POLICY IF EXISTS "Users can delete own hotel assets" ON storage.objects;
CREATE POLICY "Users can delete own hotel assets" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'hotel-assets'
    AND (storage.foldername(name))[1] = auth.jwt()->>'sub'
  );

-- =============================================================================
-- Verify with:
--   -- published pages are readable by anon; drafts only by managers:
--   SELECT policyname, cmd, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename IN ('hotels','hotel_rooms');
--   -- the bucket is public:
--   SELECT id, public FROM storage.buckets WHERE id = 'hotel-assets';
-- =============================================================================
