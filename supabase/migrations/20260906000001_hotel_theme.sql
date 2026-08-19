-- =============================================================================
-- Migration: 20260906000001_hotel_theme.sql
--
-- Lets a hotel choose how its own site LOOKS, within a fixed set of options.
--
-- WHAT THIS ADDS:
--   • hotels.font_pairing  TEXT — modern | editorial | grotesk
--   • hotels.corner_style  TEXT — sharp | soft | round
--   • hotels.theme_mode    TEXT — auto | light | dark
--
-- ── WHY THREE COLUMNS AND NOT A JSONB "theme" ───────────────────────────────
-- A jsonb blob would take any shape, which sounds flexible and means the
-- database can no longer reject a typo. These are closed vocabularies — the
-- whole product decision here is that a hotel picks from three good options
-- rather than building its own — so the CHECK constraints below are the
-- feature, not overhead. A value this build has never heard of should fail at
-- write time, not render as a page with no font.
--
-- ── WHY DEFAULTS AND NOT NULL ───────────────────────────────────────────────
-- Every existing hotel gets exactly what it renders today: the platform's own
-- typography, soft corners, and whatever colour scheme the visitor's device
-- asks for. Nobody's live page changes appearance because this migration ran.
--
-- RE-RUNNABLE: IF NOT EXISTS columns, DROP-then-ADD constraints.
-- PRECONDITIONS: 20260808000001 (hotels).
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.hotels') IS NULL THEN
    RAISE EXCEPTION 'Cannot apply 20260906000001: public.hotels is missing [20260808000001]';
  END IF;
END $$;

ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS font_pairing TEXT NOT NULL DEFAULT 'modern';
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS corner_style TEXT NOT NULL DEFAULT 'soft';
ALTER TABLE public.hotels
  ADD COLUMN IF NOT EXISTS theme_mode   TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_font_pairing_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_font_pairing_check
  CHECK (font_pairing IN ('modern', 'editorial', 'grotesk'));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_corner_style_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_corner_style_check
  CHECK (corner_style IN ('sharp', 'soft', 'round'));

ALTER TABLE public.hotels DROP CONSTRAINT IF EXISTS hotels_theme_mode_check;
ALTER TABLE public.hotels
  ADD CONSTRAINT hotels_theme_mode_check
  CHECK (theme_mode IN ('auto', 'light', 'dark'));

COMMENT ON COLUMN public.hotels.font_pairing IS
  'Typography preset. Keys are FROZEN once used — see FONT_PAIRINGS in src/lib/hotel-theme.ts.';
COMMENT ON COLUMN public.hotels.corner_style IS
  'Corner radius preset: sharp | soft | round.';
COMMENT ON COLUMN public.hotels.theme_mode IS
  'Colour scheme of the PUBLIC page. auto follows the visitor''s device; light/dark override it.';
