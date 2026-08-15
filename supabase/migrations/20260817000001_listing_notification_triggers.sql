-- =============================================================================
-- Migration: 20260817000001_listing_notification_triggers.sql
--
-- Emails the platform desk when a listing appears or reappears:
--
--   property_listed     an owner registered a unit          (AFTER INSERT)
--   property_available  an occupied unit is rentable again  (AFTER UPDATE, edge)
--
-- Both post to the `send-notification` edge function through the
-- notify_edge_function() helper from 20260814000001. Nothing new is configured
-- here — same app.notify_url / app.notify_secret, same secret header.
--
-- ── "OCCUPIED → FREE TO RENT" IS AN EDGE, NOT A STATE ───────────────────────
-- The obvious implementation — fire whenever the row looks available — sends an
-- email every time an owner corrects a typo on a unit that was already vacant.
-- Within a week the desk filters these to a folder and stops reading them, and
-- then the one that mattered is missed too. So the UPDATE trigger fires only on
-- the TRANSITION, via its WHEN clause.
--
-- ── WHY is_available AND NOT occupancy_status ───────────────────────────────
-- `occupancy_status` alone is the wrong signal. Per the truth table in
-- 20260805000001, a unit is publicly rentable only when it is BOTH vacant AND
-- listed, and AddProperty.tsx derives `is_available = isVacant AND is_listed`
-- on that basis. A landlord whose tenant moved out but who has not re-listed
-- has not put anything back on the market — emailing about it is a false alarm
-- about inventory that does not exist. `is_available` is the column the
-- marketplace itself filters on, so it is the honest trigger.
--
-- IS DISTINCT FROM, not <>: `<>` is NULL-blind, so a NULL → true transition
-- (the shape older rows actually have, since is_available was added nullable)
-- would evaluate to NULL, the WHEN would not fire, and the notification would
-- silently never arrive for exactly the oldest listings.
--
-- ── THE INSERT TRIGGER IS NOT FILTERED ──────────────────────────────────────
-- It fires for every new row, including a unit registered as already occupied.
-- That is still a new listing the platform should know about — the email states
-- the occupancy and visibility rather than the trigger silently withholding it.
--
-- ── BULK UPDATES WILL FAN OUT ───────────────────────────────────────────────
-- FOR EACH ROW means one email per row. A single
--     UPDATE properties SET is_available = true WHERE org_id = '…';
-- touching 50 rows sends 50 emails, and Resend will rate-limit long before the
-- desk finishes reading them. Before any bulk change, either:
--     ALTER TABLE public.properties DISABLE TRIGGER trg_notify_property_available;
--     -- … do the update …
--     ALTER TABLE public.properties ENABLE  TRIGGER trg_notify_property_available;
-- or run it as `service_role`, whose session can be excluded the same way.
--
-- ── pg_net DOES NOT JOIN THE TRANSACTION ────────────────────────────────────
-- The request is queued the moment the trigger runs, so an INSERT that later
-- rolls back can still generate an email about a listing that does not exist.
-- The handler treats "row not found" as a normal no-op for exactly this reason.
-- This is the same trade 20260814000001 already makes, and it is the right way
-- round: the alternative is a mail failure aborting somebody's property insert.
--
-- RE-RUNNABLE: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Preflight — name the missing piece rather than failing at CREATE TRIGGER.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_edge_function'
  ) THEN
    RAISE EXCEPTION
      E'Listing notification triggers cannot be created yet.\n\nMissing: public.notify_edge_function(jsonb)\n\nRun supabase/migrations/20260814000001_notification_triggers.sql first — it creates the helper and enables pg_net. Nothing has been changed by this script.';
  END IF;

  IF to_regclass('public.properties') IS NULL THEN
    RAISE EXCEPTION 'public.properties is missing — this database is not initialised.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — A new listing was registered.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_property_listed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_edge_function(
    jsonb_build_object('type', 'property_listed', 'property_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification is never worth losing a listing over. The owner filled in a
  -- five-step wizard and uploaded photos; an unreachable mail relay must not
  -- undo that. Warn and carry on.
  RAISE WARNING 'notify_property_listed failed for property %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_property_listed ON public.properties;
CREATE TRIGGER trg_notify_property_listed
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.notify_property_listed();


-- -----------------------------------------------------------------------------
-- STEP 2 — A unit came back on the market.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_property_available()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_edge_function(
    jsonb_build_object('type', 'property_available', 'property_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_property_available failed for property %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_property_available ON public.properties;
CREATE TRIGGER trg_notify_property_available
  AFTER UPDATE ON public.properties
  FOR EACH ROW
  -- The edge only. See the header: without this, every unrelated edit to an
  -- already-available unit sends another email.
  WHEN (OLD.is_available IS DISTINCT FROM NEW.is_available AND NEW.is_available IS TRUE)
  EXECUTE FUNCTION public.notify_property_available();


COMMENT ON FUNCTION public.notify_property_listed() IS
  'AFTER INSERT on properties → send-notification. Swallows its own errors; a mail failure must never roll back a listing.';
COMMENT ON FUNCTION public.notify_property_available() IS
  'AFTER UPDATE on properties, only on the false/NULL → true edge of is_available. Swallows its own errors.';

-- =============================================================================
-- Verify with:
--
--   -- 1. Both triggers exist, and the UPDATE one carries a WHEN clause:
--   SELECT tgname, pg_get_triggerdef(oid)
--     FROM pg_trigger
--    WHERE tgname IN ('trg_notify_property_listed','trg_notify_property_available');
--   -- The second must contain "WHEN ((old.is_available IS DISTINCT FROM ...".
--   -- If the WHEN is absent, every property edit emails the desk.
--
--   -- 2. Requests are being queued (pg_net logs every call):
--   SELECT id, status_code, created FROM net._http_response
--    ORDER BY created DESC LIMIT 5;
--   -- 401 here means app.notify_secret does not match NOTIFY_WEBHOOK_SECRET.
--   -- 404 means the function is not deployed yet.
--
--   -- 3. Test the transition WITHOUT touching a real listing. As an admin, on
--   --    a throwaway row, confirm the edge fires once and the non-edge doesn't:
--   UPDATE public.properties SET is_available = false WHERE id = '<test id>';
--   UPDATE public.properties SET is_available = true  WHERE id = '<test id>';  -- fires
--   UPDATE public.properties SET title = title || ' '  WHERE id = '<test id>';  -- does NOT fire
--   UPDATE public.properties SET is_available = true  WHERE id = '<test id>';  -- does NOT fire
--   SELECT count(*) FROM net._http_response WHERE created > now() - interval '2 min';
--   -- expect exactly ONE new row from the four statements above.
--
--   -- 4. Config is readable on THIS connection (it binds per-session):
--   SELECT current_setting('app.notify_url', true) IS NOT NULL AS url_set;
-- =============================================================================
