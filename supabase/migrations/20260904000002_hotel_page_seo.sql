-- =============================================================================
-- Migration: 20260904000002_hotel_page_seo.sql
--
-- Lets a hotel write its OWN Google title and description for each page of its
-- mini-site, instead of always getting the one this app generates.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- Until now src/pages/HotelPage.tsx derived both from the hotel row:
--
--     title        = "<page title> — <hotel name>"      (sub-pages)
--                    "<hotel name> — Hotel in Mogadishu" (the home page)
--     description  = hotels.description
--                    → hotels.tagline
--                    → a generated "rooms in Mogadishu…" sentence
--
-- That is a sensible default and a bad ceiling. The generated title carries no
-- room of the hotel's own words ("Beachfront rooms in Lido", "Halal breakfast
-- included"), and the description is whatever the owner happened to type into
-- the ABOUT box — copy written to be read on the page, not to be read as a
-- search snippet. The two jobs are different lengths, different voices, and
-- currently the same string. These columns separate them.
--
-- ── WHY NULLABLE, AND WHY THAT IS THE WHOLE DESIGN ──────────────────────────
-- NULL is not "missing data to be backfilled later". NULL is the instruction
-- "keep generating this one for me", and it must stay the meaning forever:
--
--   * Every hotel_pages row that exists today predates this migration and will
--     be NULL after it. Their pages must render byte-for-byte as they do now —
--     the same titles Google has already indexed. A DEFAULT, a backfill, or a
--     NOT NULL would freeze today's generated string into the row, and the
--     next time the generator improves (or the hotel is renamed) those rows
--     would silently keep the stale copy.
--   * A hotel that clears the field is asking to go BACK to the generated one.
--     The editor writes NULL for a blank box for exactly that reason, so the
--     round trip "override → clear → default" works without a reset button.
--
-- The reader treats blank/whitespace the same as NULL, so a row that arrives
-- with '' (a stray empty write from any other client) still falls back rather
-- than publishing an empty <title>.
--
-- ── NO LENGTH CHECK ON PURPOSE ──────────────────────────────────────────────
-- Google truncates a title around 60 characters and a description around 158,
-- and the editor shows a live counter against both. But over-length is a
-- QUALITY problem, not a corruption problem: a 200-character description is
-- still a valid description, and the renderer already runs it through
-- truncate() in src/lib/seo.ts before it reaches the meta tag. A CHECK here
-- would turn "your snippet will be cut short" into a red database error that
-- loses the owner's typing, so the limits are advisory in the UI and absent
-- here. Plain TEXT, no cap.
--
-- RE-RUNNABLE: ALTER TABLE ... ADD COLUMN IF NOT EXISTS, no data written.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight — name what's missing rather than failing halfway.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.hotel_pages') IS NULL THEN
    RAISE EXCEPTION
      E'public.hotel_pages is missing.\n\nApply supabase/migrations/20260810000002_hotel_multipage_members.sql first. Nothing has been changed by this script.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- The columns. Nullable, no default — see the header: absent means "generate
-- it", and that has to remain true for every row that already exists.
-- -----------------------------------------------------------------------------
ALTER TABLE public.hotel_pages
  ADD COLUMN IF NOT EXISTS seo_title       TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT;

COMMENT ON COLUMN public.hotel_pages.seo_title IS
  'Owner-written <title> for this page (the blue line in Google). NULL or blank = generate it from the page title and hotel name, which is what every pre-existing row does. The brand suffix is still appended by buildTitle() in src/lib/seo.ts, so do not include "Mogadishu Rents" here. Advisory length ~60 chars; not enforced.';

COMMENT ON COLUMN public.hotel_pages.seo_description IS
  'Owner-written meta description (the grey snippet under the title in Google). NULL or blank = fall back to hotels.description, then hotels.tagline, then a generated sentence. Truncated to 158 chars at render time; not enforced here.';

-- =============================================================================
-- Verify with:
--
--   -- 1. Both columns exist and are nullable with no default:
--   SELECT column_name, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'hotel_pages'
--      AND column_name IN ('seo_title', 'seo_description');
--   -- expect: is_nullable = YES, column_default = NULL, for both.
--
--   -- 2. No existing page was given a value (i.e. every site still renders the
--   --    generated metadata it rendered before this ran):
--   SELECT count(*) FROM public.hotel_pages
--    WHERE seo_title IS NOT NULL OR seo_description IS NOT NULL;
--   -- expect: 0 immediately after applying.
--
--   -- 3. Which hotels have started writing their own:
--   SELECT h.name, p.title, p.seo_title, length(p.seo_description) AS desc_len
--     FROM public.hotel_pages p
--     JOIN public.hotels h ON h.id = p.hotel_id
--    WHERE p.seo_title IS NOT NULL OR p.seo_description IS NOT NULL
--    ORDER BY h.name, p.sort_order;
-- =============================================================================
