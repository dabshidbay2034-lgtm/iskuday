-- =============================================================================
-- Migration: 20260905000002_booking_contact_required.sql
--
-- A booking taken over the internet must carry a way to reach the guest.
--
-- WHAT THIS ADDS:
--   • bookings_contact_required — CHECK: every source except 'walk_in' needs
--     a phone number or an email address.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `create_booking_request` accepts NULL for both p_guest_phone and
-- p_guest_email. The public booking form has validated "one or the other"
-- client-side since 20260904, but that check lives in a browser: anything
-- calling the RPC directly — a future client, a script, a stale bundle — can
-- still create a booking nobody can contact. Meanwhile the confirmation screen
-- promises "a member of the team will confirm by phone", so the desk ends up
-- with a held room and no way to honour that.
--
-- ── WHY A CONSTRAINT AND NOT A CHANGE TO THE FUNCTION ───────────────────────
-- Two reasons. First, `create_booking_request` is not the only way a row gets
-- in: the front-desk dialog inserts directly, and a rule that lives in one
-- writer is a rule the other writer does not have. Second, replacing a
-- hundred-line SECURITY DEFINER function to add two lines of validation means
-- reproducing the rest of it exactly, and every character of that reproduction
-- is a chance to silently change behaviour that is currently correct.
--
-- ── WHY 'walk_in' IS EXEMPT ─────────────────────────────────────────────────
-- Deliberate, and the whole reason this is scoped by source rather than applied
-- flat. A guest standing at the counter with cash may genuinely have no number
-- worth recording, and they do not need one — they are already there. Refusing
-- that booking would make the software worse than the paper ledger it replaces.
-- Every other source ('online', 'phone', 'agent', 'admin') describes a guest
-- who is somewhere else, and a guest who is somewhere else has to be reachable.
--
-- RE-RUNNABLE: DROP-then-ADD.
-- PRECONDITIONS: 20260807000001_hotel_booking.sql (bookings, bookings_source_check).
-- =============================================================================

DO $$
DECLARE
  v_bad BIGINT;
BEGIN
  IF to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'Cannot apply 20260905000002: public.bookings is missing [20260807000001_hotel_booking.sql]';
  END IF;

  -- Counted BEFORE the constraint is added, so a database with historical rows
  -- that predate the client-side rule gets a sentence explaining what to do
  -- rather than a bare "check constraint violated" from ALTER TABLE.
  SELECT count(*) INTO v_bad
    FROM public.bookings
   WHERE source IS DISTINCT FROM 'walk_in'
     AND guest_phone IS NULL
     AND guest_email IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION E'% existing booking(s) have no phone and no email but are not walk-ins.\n\nThese predate the rule and must be dealt with first. Either reach the guests and fill in what you learn, or reclassify the ones that were really counter bookings:\n\n  UPDATE public.bookings SET source = ''walk_in''\n   WHERE source <> ''walk_in'' AND guest_phone IS NULL AND guest_email IS NULL;\n\nThen re-run this migration. Nothing has been changed by this script.',
      v_bad;
  END IF;
END $$;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_contact_required;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_contact_required
  CHECK (
    source = 'walk_in'
    OR guest_phone IS NOT NULL
    OR guest_email IS NOT NULL
  );

COMMENT ON CONSTRAINT bookings_contact_required ON public.bookings IS
  'Any booking not taken at the counter must carry a phone or an email. walk_in is exempt: that guest is already standing there.';
