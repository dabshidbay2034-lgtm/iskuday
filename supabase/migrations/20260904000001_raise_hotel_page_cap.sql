-- =============================================================================
-- Migration: 20260904000001_raise_hotel_page_cap.sql
--
-- Raises the per-hotel page cap from 3 to 8.
--
-- ── WHY THERE IS A CAP AT ALL ───────────────────────────────────────────────
-- The cap is a PRODUCT decision, not a technical limit. Nothing in the schema,
-- the storage or the query plans strains at 50 pages per hotel; two other
-- things do:
--
--   1. THE NAV. Every page in `hotel_pages` becomes an item in that hotel's
--      public site menu. A menu of eight already needs care to stay readable on
--      a phone; an unbounded one turns the hotel's own landing page into a
--      directory and buries the rooms and the booking call-to-action, which are
--      the only two things a guest actually came for.
--   2. ABANDONED PAGES. Pages are cheap to create and nobody deletes anything.
--      Without a ceiling a hotel accumulates half-written drafts — "Offers
--      2025", a second "Contact", an empty "Blog" — which the manager then has
--      to scroll past forever in the editor, and which occasionally get
--      published by accident.
--
-- 3 was the conservative opening bid when multi-page sites shipped in
-- 20260810000002. Real hotels want home + rooms + dining + facilities +
-- location + offers + contact, and were hitting the wall on their first day.
-- 8 fits that list with one to spare and still keeps a nav bar that reads at a
-- glance. It is deliberately NOT "unlimited": if a hotel argues for 20, the
-- answer is a conversation about their site structure, not a bigger number.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────
-- ONLY the `_max` constant inside public.hotel_pages_enforce_cap(), plus the
-- table comment that quotes the old number. THE BODY BELOW IS OTHERWISE COPIED
-- VERBATIM from 20260810000002_hotel_multipage_members.sql STEP 2b — same
-- SECURITY DEFINER, same search_path, same advisory lock, same self-exclusion
-- on re-parenting UPDATEs, same 23514 error code. Keep it that way: a CREATE OR
-- REPLACE that also "tidies" the body would change enforcement semantics
-- silently. The reasons that body looks the way it does are worth re-stating,
-- since this file is now the live definition:
--
--   • SECURITY DEFINER is load-bearing. The COUNT runs in the caller's
--     transaction; without it the count would be filtered by hotel_pages' own
--     SELECT policy, so a user who can only see published pages would count 1
--     where there are 8 and sail straight past the cap.
--   • The advisory lock closes the concurrency hole — two simultaneous inserts
--     would otherwise both read "7" and both commit, leaving 9. It is keyed on
--     the hotel id so it serialises page creation for ONE hotel only, and taken
--     as an _xact_ lock so it releases on commit/rollback with no unlock path
--     to forget.
--   • It fires on UPDATE OF hotel_id too: re-parenting a page is an insert into
--     the destination hotel by another name, and would otherwise be a free
--     ninth page.
--
-- The TRIGGER itself is not touched — CREATE OR REPLACE FUNCTION rebinds the
-- existing `hotel_pages_cap` trigger to the new body automatically, and
-- dropping/re-creating the trigger would only widen the window in which the cap
-- is unenforced.
--
-- ── THE OTHER HALF OF THIS CHANGE ───────────────────────────────────────────
-- `MAX_HOTEL_PAGES` in src/hooks/use-hotel-pages.ts moves to 8 in the same
-- deploy. That constant is a courtesy that disables "Add page" before the
-- round-trip; this trigger is the real limit. If the constant is LOWER than the
-- trigger the UI merely refuses pages the database would have allowed
-- (annoying, safe); if it is HIGHER the UI offers a button whose insert is then
-- rejected with a toast (confusing). The client translator matches
-- `at most \d+ pages` rather than a literal 3, so it keeps working against
-- either cap while a deploy is half-rolled-out.
--
-- ── EXISTING DATA ───────────────────────────────────────────────────────────
-- Nothing to backfill. Raising a ceiling cannot invalidate a row that was
-- already under the old one, so no hotel is left in violation and no data
-- migration runs here.
--
-- ── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION + COMMENT ON only. Both are idempotent, and the
-- preflight below fails loudly rather than creating a cap function out of thin
-- air if the migration that owns the table has not been applied yet.
--
-- ── PRECONDITIONS ──────────────────────────────────────────────────────────
--   20260810000002_hotel_multipage_members.sql (public.hotel_pages and the
--   hotel_pages_cap trigger).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT.
--
-- If hotel_pages does not exist, a bare CREATE OR REPLACE would still succeed —
-- a plpgsql trigger body is not resolved against its table until it runs — and
-- would leave an orphan function plus a cap nobody enforces. Fail here instead,
-- naming the file to apply first.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.hotel_pages') IS NULL THEN
    RAISE EXCEPTION
      'public.hotel_pages not found — apply 20260810000002_hotel_multipage_members.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'hotel_pages_cap'
      AND tgrelid = 'public.hotel_pages'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'trigger hotel_pages_cap missing on public.hotel_pages — apply 20260810000002_hotel_multipage_members.sql first.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Re-create the cap function with _max = 8.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hotel_pages_enforce_cap()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- 8, not unlimited: enough for home + rooms + dining + facilities + location
  -- + offers + contact with one to spare, few enough that the hotel's public
  -- nav still reads at a glance and abandoned drafts cannot pile up unnoticed.
  -- Mirrored by MAX_HOTEL_PAGES in src/hooks/use-hotel-pages.ts — move both.
  _max   CONSTANT INT := 8;
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


-- -----------------------------------------------------------------------------
-- STEP 2 — Re-state the documentation that quoted the old number.
--
-- The table comment is what a reader hits first in a schema browser; leaving it
-- saying "Up to 3" would make it the most confidently wrong line in the schema.
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.hotel_pages IS
  'Up to 8 pages per hotel (cap enforced by trigger hotel_pages_cap, not by the UI; raised from 3 by 20260904000001). Exactly one is_home page per hotel (partial unique index).';

COMMENT ON FUNCTION public.hotel_pages_enforce_cap() IS
  'BEFORE INSERT / UPDATE OF hotel_id guard on hotel_pages: refuses the row with SQLSTATE 23514 once a hotel already has 8 pages. The cap is a product decision — keep the site nav readable, stop abandoned drafts accumulating — not a technical limit. Change the _max constant here AND MAX_HOTEL_PAGES in src/hooks/use-hotel-pages.ts together.';
