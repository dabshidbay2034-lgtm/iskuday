-- =============================================================================
-- Migration: 20260809000001_hotel_page_sections.sql
--
-- Turns each hotel page into a BLOCK-BUILT page: an ordered, draggable list of
-- sections (hero / text / gallery / rooms / button / contact) that the public
-- page renders top-to-bottom. The old scalar fields stay (hero_image_url,
-- tagline, description, gallery) so nothing breaks — the editor mirrors what it
-- needs back into them, and existing pages are back-filled from them on read.
--
-- RE-RUNNABLE: plain ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =============================================================================
-- Verify with:
--   SELECT id, name, jsonb_array_length(sections) FROM public.hotels;
-- =============================================================================