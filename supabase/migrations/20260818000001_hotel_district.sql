-- =============================================================================
-- Migration: 20260818000001_hotel_district.sql
--
-- A hotel sits in exactly ONE district, and that district lives on the hotel.
--
-- Until now every listing carried its own free `location`, chosen again in the
-- add-property wizard each time. For a letting agency that is right — their
-- units are scattered across Mogadishu. For a hotel it is not: a hotel is one
-- building. Asking the front desk to re-pick the district for every room is a
-- question with only one correct answer, and any answer that differs from the
-- others is a data-entry mistake that splits one hotel across two districts in
-- search results.
--
-- So the district moves up to `hotels`, is set once in the page settings, and
-- every room inherits it.
--
-- ── WHY A CHECK AND NOT A FOREIGN KEY ──────────────────────────────────────
-- The 18 districts are a fixed civic fact, not user data — they are already a
-- frozen `as const` tuple in src/lib/districts.ts, and `properties.location`
-- has always been plain TEXT validated only by that dropdown. A lookup table
-- would be the better shape in a green-field schema, but introducing one now
-- would require migrating `properties.location` too, which is a much larger
-- change than this one is asking for. A CHECK gives the same guarantee for the
-- new column without touching the old one. It is NOT VALID-free: the column is
-- new, so no existing row can violate it.
--
-- Keep this list in sync with src/lib/districts.ts. It is duplicated on
-- purpose: the client needs it to render a dropdown, the database needs it to
-- reject anything that arrives through PostgREST with the anon key instead.
--
-- ── NULL IS ALLOWED, AND MEANS "NOT SET YET" ───────────────────────────────
-- Existing hotels predate this column and cannot be guessed at in every case.
-- Making it NOT NULL would fail the migration on any hotel whose rooms are not
-- all in one district (or that has no rooms at all). Instead it is nullable,
-- the backfill fills in what it can prove, and the builder asks for the rest.
-- The add-room flow refuses to run without it rather than inventing one.
--
-- RE-RUNNABLE: ADD COLUMN IF NOT EXISTS + guarded constraint + idempotent
-- backfill (only ever writes where district IS NULL).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight — name what's missing rather than failing halfway.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.hotels') IS NULL THEN
    RAISE EXCEPTION
      E'public.hotels is missing.\n\nApply supabase/migrations/20260808000001_hotel_pages.sql first. Nothing has been changed by this script.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — The column.
-- -----------------------------------------------------------------------------
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS district TEXT;


-- -----------------------------------------------------------------------------
-- STEP 2 — Constrain it to the 18 real districts of Mogadishu.
--
-- Guarded rather than DROP/ADD: dropping first would leave a window in which a
-- concurrent write could insert a bad value, and re-adding a constraint that
-- already exists is an error.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hotels'::regclass
      AND conname  = 'hotels_district_valid'
  ) THEN
    ALTER TABLE public.hotels
      ADD CONSTRAINT hotels_district_valid CHECK (
        district IS NULL OR district IN (
          'Abdiaziz', 'Bondhere', 'Daynile', 'Dharkenley',
          'Hamar Jajab', 'Hamar Weyne', 'Heliwa', 'Hodan',
          'Howl Wadaag', 'Huriwa', 'Kahda', 'Karaan',
          'Shangani', 'Shibis', 'Waberi', 'Wadajir',
          'Wardhigley', 'Yaqshid'
        )
      );
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 3 — Backfill from the rooms already curated onto each page.
--
-- Only where every linked room agrees. A hotel whose rooms disagree is exactly
-- the mistake this migration exists to stop, and picking a winner by majority
-- would bury it — the builder asks the owner instead.
--
-- `WHERE district IS NULL` makes this safe to re-run: a district set by hand
-- after the first run is never overwritten by a later one.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  filled INTEGER := 0;
  ambiguous INTEGER := 0;
BEGIN
  IF to_regclass('public.hotel_rooms') IS NULL THEN
    RAISE NOTICE 'hotel_rooms not present — skipping backfill; districts start empty.';
    RETURN;
  END IF;

  WITH agreed AS (
    SELECT hr.hotel_id,
           MIN(p.location)            AS district,
           COUNT(DISTINCT p.location) AS variants
      FROM public.hotel_rooms hr
      JOIN public.properties  p ON p.id = hr.property_id
     WHERE p.location IS NOT NULL AND p.location <> ''
     GROUP BY hr.hotel_id
  )
  UPDATE public.hotels h
     SET district = a.district
    FROM agreed a
   WHERE h.id = a.hotel_id
     AND a.variants = 1
     AND h.district IS NULL
     -- Never write a value the CHECK would reject: a pre-existing room could
     -- hold any free text typed before the dropdown was introduced.
     AND a.district IN (
       'Abdiaziz', 'Bondhere', 'Daynile', 'Dharkenley',
       'Hamar Jajab', 'Hamar Weyne', 'Heliwa', 'Hodan',
       'Howl Wadaag', 'Huriwa', 'Kahda', 'Karaan',
       'Shangani', 'Shibis', 'Waberi', 'Wadajir',
       'Wardhigley', 'Yaqshid'
     );

  GET DIAGNOSTICS filled = ROW_COUNT;

  SELECT COUNT(*) INTO ambiguous
    FROM (
      SELECT hr.hotel_id
        FROM public.hotel_rooms hr
        JOIN public.properties  p ON p.id = hr.property_id
       WHERE p.location IS NOT NULL AND p.location <> ''
       GROUP BY hr.hotel_id
      HAVING COUNT(DISTINCT p.location) > 1
    ) x;

  RAISE NOTICE 'District backfill: % hotel(s) set from their rooms, % left blank because their rooms disagree.',
    filled, ambiguous;
END $$;


COMMENT ON COLUMN public.hotels.district IS
  'The single Mogadishu district this hotel is in. Set in page settings; every room inherits it. NULL = not chosen yet.';

-- =============================================================================
-- Verify with:
--
--   -- 1. Column and constraint exist:
--   SELECT column_name, is_nullable FROM information_schema.columns
--    WHERE table_name = 'hotels' AND column_name = 'district';
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.hotels'::regclass AND conname = 'hotels_district_valid';
--
--   -- 2. What the backfill managed:
--   SELECT name, slug, district FROM public.hotels ORDER BY district NULLS FIRST;
--
--   -- 3. Which hotels still need one chosen by hand (these are the ones whose
--   --    rooms disagree, or that have no rooms yet):
--   SELECT h.name, h.slug, array_agg(DISTINCT p.location) AS room_districts
--     FROM public.hotels h
--     LEFT JOIN public.hotel_rooms hr ON hr.hotel_id = h.id
--     LEFT JOIN public.properties  p  ON p.id = hr.property_id
--    WHERE h.district IS NULL
--    GROUP BY h.name, h.slug;
--
--   -- 4. The CHECK actually bites:
--   UPDATE public.hotels SET district = 'Nairobi' WHERE id = (SELECT id FROM public.hotels LIMIT 1);
--   -- expect: new row for relation "hotels" violates check constraint "hotels_district_valid"
-- =============================================================================
