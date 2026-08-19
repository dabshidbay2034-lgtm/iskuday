-- =============================================================================
-- Clearing demo and test rows out of the live database.
--
-- NOT a migration. Do not put this in supabase/migrations/ and do not run it as
-- part of a deploy. Run it by hand in the Supabase SQL editor when you want the
-- throwaway rows gone.
--
-- ── WHY THIS DOES NOT JUST DELETE ───────────────────────────────────────────
-- It cannot know which hotels you consider real. The live data currently holds
-- ten hotels, and several — `mkm`, `jazeera`, `vvg`, `oo`, `mo`, `opp` — are
-- one- to four-letter names that LOOK like keyboard-mashing but might be a real
-- business you onboarded. Deleting a customer's hotel because a script guessed
-- from its name is not a mistake worth risking, and there is no undo.
--
-- So Part 1 shows you everything with a flag. You decide, then fill in the list
-- in Part 2. Nothing is destructive until you edit and uncomment it.
-- =============================================================================

-- ── PART 1: LOOK ────────────────────────────────────────────────────────────

-- Every hotel, with a guess at which are throwaway. `rooms` and `pages` are
-- what you would lose with it — a hotel with real rooms attached is very
-- probably not test data, whatever it is called.
SELECT
  h.name,
  h.slug,
  h.is_published,
  (SELECT count(*) FROM public.hotel_rooms r WHERE r.hotel_id = h.id) AS rooms,
  (SELECT count(*) FROM public.hotel_pages p WHERE p.hotel_id = h.id)  AS pages,
  CASE
    WHEN length(h.name) <= 4 AND h.name = lower(h.name) THEN 'looks like test data'
    WHEN h.name ILIKE '%test%'                          THEN 'looks like test data'
    ELSE 'looks real — check before deleting'
  END AS guess,
  h.created_at
FROM public.hotels h
ORDER BY guess, h.created_at;

-- Bookings made while testing the booking flow.
SELECT id, guest_name, guest_phone, check_in, check_out, status, source, created_at
  FROM public.bookings
 ORDER BY created_at DESC;

-- ── PART 2: DELETE ──────────────────────────────────────────────────────────
--
-- Put the slugs YOU decided on into the list, uncomment, and run. Slugs rather
-- than names because two of the current hotels are both called "oo" and only
-- their slugs tell them apart.
--
-- hotel_pages and hotel_rooms are ON DELETE CASCADE from hotels
-- (20260810000002), so deleting the hotel takes its pages and room links with
-- it. It does NOT delete the underlying `properties` rows — a room can be
-- listed on the marketplace independently of any hotel, and removing a hotel
-- should not silently unpublish someone's listing.
--
-- BEGIN;
--
-- DELETE FROM public.bookings
--  WHERE guest_name ILIKE '%Nuur Warsame%';
--
-- DELETE FROM public.hotels
--  WHERE slug IN (
--    -- 'oo', 'oo-2', 'mo', 'opp', 'vvg', 'test-beach-hotels'
--  );
--
-- -- Re-run Part 1 here and check what survived BEFORE committing.
-- -- ROLLBACK; if it is not what you expected.
-- COMMIT;

-- ── AFTERWARDS ──────────────────────────────────────────────────────────────
-- Redeploy. The sitemap and the prerendered pages are both generated from live
-- data at build time, so until a build runs the deleted URLs stay advertised in
-- sitemap.xml and will 404 for anyone who follows them — which is worse for
-- search than leaving the hotels in place would have been.
