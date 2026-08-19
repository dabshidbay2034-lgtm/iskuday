-- =============================================================================
-- Migration: 20260907000001_hotel_page_home_repair.sql
--
-- Gives a home page to every hotel that has pages but none marked `is_home`.
--
-- ── THE BUG THIS REPAIRS ────────────────────────────────────────────────────
-- `useCreateHotelPage` hardcoded `is_home: false` on every page it created.
-- The reasoning in the comment was that home is "claimed by the migration or by
-- useSetHomePage()" — true only for hotels that already existed when
-- 20260810000002 ran and had a home page back-filled for them.
--
-- A hotel created AFTER that migration never got one. So the first page its
-- owner built was `is_home = false`, the hotel had no home page at all, and
-- three things followed:
--
--   1. `/hotels/:slug` found no home row and fell through to the legacy
--      `hotels.sections` column — the default template scaffold. The hotel's
--      public front page showed generic copy identical to every other hotel's.
--   2. The owner's real page existed only at `/hotels/:slug/:pageSlug`, and
--      nothing linked to it: the page menu only appears at two pages or more.
--   3. The sitemap listed that sub-page AND the scaffolded main page, so Google
--      was offered boilerplate at the URL that matters.
--
-- Found on a live hotel whose public page was showing another hotel's tagline.
--
-- The client-side cause is fixed, and HotelPage.tsx now falls back to the first
-- page when no home exists — but that fallback makes `/hotels/:slug` and
-- `/hotels/:slug/:pageSlug` serve identical content, which is a duplicate-URL
-- problem of its own. Setting the flag properly is what actually resolves it:
-- the sitemap skips a home page (it is already served at `/hotels/:slug`), so
-- once the flag is right each page has exactly one URL again.
--
-- ── WHY THE LOWEST sort_order ────────────────────────────────────────────────
-- That is the order the owner arranged their pages in, so the first one is the
-- one they treat as the front of their site. `created_at` breaks a tie, because
-- sort_order defaults to the page count and two pages can share a value.
--
-- RE-RUNNABLE: only touches hotels that currently have no home page, so a
-- second run is a no-op.
-- PRECONDITIONS: 20260810000002 (hotel_pages, hotel_pages_one_home_per_hotel).
-- =============================================================================

DO $$
DECLARE
  v_fixed INT;
BEGIN
  IF to_regclass('public.hotel_pages') IS NULL THEN
    RAISE EXCEPTION 'Cannot apply 20260907000001: public.hotel_pages is missing [20260810000002]';
  END IF;

  WITH homeless AS (
    SELECT hotel_id
      FROM public.hotel_pages
     GROUP BY hotel_id
    HAVING bool_or(is_home) IS NOT TRUE
  ),
  -- One winner per hotel. DISTINCT ON with the same ORDER BY is what keeps this
  -- from ever selecting two rows for one hotel and tripping the partial unique
  -- index that guarantees a single home.
  winners AS (
    SELECT DISTINCT ON (p.hotel_id) p.id
      FROM public.hotel_pages p
      JOIN homeless h ON h.hotel_id = p.hotel_id
     ORDER BY p.hotel_id, p.sort_order, p.created_at
  )
  UPDATE public.hotel_pages
     SET is_home = TRUE
   WHERE id IN (SELECT id FROM winners);

  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  IF v_fixed > 0 THEN
    RAISE NOTICE 'Promoted % page(s) to home for hotels that had none.', v_fixed;
  ELSE
    RAISE NOTICE 'Every hotel with pages already has a home page. Nothing to do.';
  END IF;
END $$;
