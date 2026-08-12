-- =============================================================================
-- Migration: 20260814000001_notification_triggers.sql
-- Description: Fire the `send-notification` edge function from Postgres when a
--              booking is requested, a service inquiry arrives, or a hotel
--              invite is created. Uses pg_net (async HTTP from Postgres).
--
-- Nothing in this project notified anybody before this file. A guest submitted
-- a booking request and the hotel found out whenever it next opened
-- /manage/hotel; a visitor asked about a service and it sat unread in the admin
-- panel. These three triggers close that.
--
-- ⚠ THE SINGLE MOST IMPORTANT PROPERTY OF THIS FILE ⚠
-- Every trigger function below swallows its own errors and RETURNs NEW.
-- A trigger runs INSIDE the transaction of the statement that fired it, so an
-- unhandled exception here does not "fail to send an email" — it ROLLS BACK THE
-- BOOKING. A guest would see "could not book" because a mail service was down,
-- or because an operator had not run the ALTER DATABASE lines yet. That trade is
-- never worth making: a lost notification is a person checking a dashboard, a
-- lost booking is a lost customer. So every failure path here is a RAISE WARNING
-- and nothing more. The edge function takes the same posture from the other
-- side — it returns 200 for everything except a bad secret.
--
-- =============================================================================
-- OPERATOR SETUP — REQUIRED. These triggers are inert until you run these.
--
-- The function URL and the shared secret are NOT hardcoded here: this file is in
-- git, and a secret in git is a published secret. They are read at runtime from
-- database-level settings. Run these ONCE, as the database owner, in the
-- Supabase SQL editor (Dashboard → SQL Editor), replacing the placeholders:
--
--   ALTER DATABASE postgres SET app.notify_url    = 'https://<PROJECT-REF>.supabase.co/functions/v1/send-notification';
--   ALTER DATABASE postgres SET app.notify_secret = '<THE SAME VALUE AS THE NOTIFY_WEBHOOK_SECRET EDGE SECRET>';
--
-- For this project <PROJECT-REF> is `hetaveowlxcjuxbtckqt` (see
-- docs/DEPLOY_FUNCTIONS.md), and the database is named `postgres`.
--
-- ⚠ ALTER DATABASE only affects NEW connections. Existing pooled sessions keep
-- the old (or absent) value, so nothing fires until connections turn over.
-- Force it from the dashboard with Settings → Database → Restart, or just wait.
-- Confirm the value is visible from a fresh session with:
--
--   SELECT current_setting('app.notify_url', true) AS url,
--          (current_setting('app.notify_secret', true) IS NOT NULL) AS secret_set;
--
-- Never SELECT the secret itself into a shared screen or a support ticket.
--
-- Everything else (RESEND_API_KEY, FROM_EMAIL, ADMIN_NOTIFY_EMAIL, SITE_URL,
-- NOTIFY_WEBHOOK_SECRET) is an EDGE FUNCTION secret, not a database setting:
--   npx supabase secrets set NOTIFY_WEBHOOK_SECRET="..."   (see docs/NOTIFICATIONS.md)
--
-- =============================================================================
-- WHAT THIS FILE CREATES
--   • extension  extensions.pg_net (or net.pg_net — see STEP 1)
--   • function   public.notify_edge_function(jsonb)          — SECURITY DEFINER
--   • function   public.notify_booking_requested()           — trigger fn
--   • function   public.notify_service_inquiry()             — trigger fn
--   • function   public.notify_hotel_invite()                — trigger fn
--   • trigger    trg_notify_booking_requested ON public.bookings
--   • trigger    trg_notify_service_inquiry   ON public.service_inquiries
--   • trigger    trg_notify_hotel_invite      ON public.hotel_invites
--
-- Re-runnable: every object is CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
-- =============================================================================


-- =============================================================================
-- STEP 1 — pg_net, and a preflight that says something useful if it is missing.
--
-- pg_net gives Postgres a FIRE-AND-FORGET HTTP client: net.http_post() queues
-- the request in a background worker and returns a request id immediately. That
-- is the only acceptable shape for this job — a synchronous HTTP call from a
-- trigger would hold the booking transaction open for the round trip to the
-- edge function, and a slow response would become a slow booking.
--
-- WHERE THE FUNCTIONS LIVE: Supabase installs pg_net into `extensions` on some
-- projects and into `net` on others, and the extension is NOT relocatable, so a
-- blunt `WITH SCHEMA extensions` errors out on a project where it already lives
-- in `net`. Try the documented form, fall back to the default, then RESOLVE the
-- real schema below rather than assuming either.
-- =============================================================================
DO $preflight$
DECLARE
  v_schema text;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    -- Already installed elsewhere, or the control file pins its own schema.
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_net;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- reported by the hard check below, with a useful message
    END;
  END;

  SELECT n.nspname INTO v_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'http_post'
  LIMIT 1;

  IF v_schema IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'feature_not_supported',
      MESSAGE = 'pg_net is not available — notification triggers cannot be installed.',
      DETAIL  = 'net.http_post() was not found in any schema, so this migration has nothing to call.',
      HINT    = 'Enable it in the Supabase dashboard: Database -> Extensions -> search "pg_net" -> toggle on. Then re-run this migration. On self-hosted Postgres, install the pg_net extension package first.';
  END IF;

  RAISE NOTICE 'pg_net found: http_post() lives in schema "%".', v_schema;
END
$preflight$;


-- =============================================================================
-- STEP 2 — public.notify_edge_function(): the one place that speaks HTTP.
--
-- SECURITY DEFINER on purpose. The inserts that fire these triggers come from
-- ANON and AUTHENTICATED roles (the public booking form, the public service
-- inquiry form), and neither role has EXECUTE on net.http_post — Supabase grants
-- it to postgres. Without SECURITY DEFINER every public booking would raise
-- "permission denied for function http_post" from inside the trigger.
--
-- Built with dynamic SQL so the schema resolved in STEP 1 is baked in literally.
-- A `SET search_path = public, net, extensions` would be shorter, but search_path
-- games in a SECURITY DEFINER function are exactly how privilege escalation gets
-- written by accident; an explicit schema-qualified call cannot be hijacked.
--
-- It returns the pg_net request id (bigint) so a caller can correlate a row in
-- net._http_response, and NULL when it deliberately did nothing.
-- =============================================================================
DO $build$
DECLARE
  v_schema text;
BEGIN
  SELECT n.nspname INTO v_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'http_post'
  LIMIT 1;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.notify_edge_function(_payload jsonb)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $body$
    DECLARE
      v_url    text := current_setting('app.notify_url', true);
      v_secret text := current_setting('app.notify_secret', true);
    BEGIN
      -- Unconfigured is a NORMAL state, not an error: this migration ships
      -- before anyone has run the ALTER DATABASE lines, and a developer running
      -- the schema locally will never set them. Say so once, at WARNING, and
      -- return. See the header for why this must not raise.
      IF v_url IS NULL OR btrim(v_url) = '' THEN
        RAISE WARNING 'notify_edge_function: app.notify_url is not set - notification skipped. See the header of 20260814000001_notification_triggers.sql.';
        RETURN NULL;
      END IF;

      IF v_secret IS NULL OR btrim(v_secret) = '' THEN
        RAISE WARNING 'notify_edge_function: app.notify_secret is not set - notification skipped. The edge function rejects unsigned calls with 401.';
        RETURN NULL;
      END IF;

      -- The payload carries IDS ONLY. The edge function re-reads every fact it
      -- prints (and, above all, the recipient address) from this database with
      -- the service-role key. Putting an email address or body text in here
      -- would turn a leaked shared secret into "mail anything to anyone".
      --
      -- timeout_milliseconds bounds the BACKGROUND worker, not this transaction:
      -- http_post() has already returned by the time the request goes out.
      RETURN %I.http_post(
        url     := v_url,
        body    := _payload,
        params  := '{}'::jsonb,
        headers := jsonb_build_object(
                     'Content-Type',    'application/json',
                     'x-notify-secret', v_secret
                   ),
        timeout_milliseconds := 5000
      );
    END
    $body$;
  $fn$, v_schema);
END
$build$;

COMMENT ON FUNCTION public.notify_edge_function(jsonb) IS
  'Fire-and-forget POST to the send-notification edge function via pg_net. Reads app.notify_url / app.notify_secret from database settings; returns NULL and WARNs when either is unset. Payload must contain IDS ONLY - the edge function re-reads every fact server-side.';

-- Trigger functions below are SECURITY INVOKER and call this one; EXECUTE on a
-- function is granted to PUBLIC by default, which is what lets an anonymous
-- booking reach it. The privilege that matters (net.http_post) is held by the
-- DEFINER, not the caller.


-- =============================================================================
-- STEP 3 — bookings: notify the hotel that a guest ASKED for a room.
--
-- Fires only on status = 'requested'. `create_booking_request()` (the public
-- form's RPC) hardcodes that status; a walk-in typed in at the front desk is
-- inserted already confirmed or checked-in, and the person who typed it does not
-- need an email telling them what they just did.
--
-- The WHEN clause, rather than an IF in the body, so an insert that does not
-- qualify never even calls the function.
--
-- AFTER INSERT, not BEFORE. A BEFORE trigger would fire before the row has
-- survived the constraints on this table - and bookings has real ones, including
-- the `bookings_no_overlap` EXCLUDE guard. We would notify a hotel about a
-- double-booking that then failed to insert. AFTER means the row is real.
-- (The transaction can still roll back after us; pg_net is async and does not
-- participate, so a rolled-back booking can in principle still send a mail. That
-- is the direction we choose to be wrong in - a spurious alert about a booking
-- that vanished beats a booking lost to a mail failure.)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_booking_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.notify_edge_function(
    jsonb_build_object('type', 'booking_requested', 'booking_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- See the file header. Notifying is best-effort; the booking is not. Whatever
  -- went wrong (pg_net missing, worker queue full, settings revoked), this
  -- INSERT must still commit.
  RAISE WARNING 'notify_booking_requested failed for booking %: % (%). Booking kept.',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_booking_requested ON public.bookings;
CREATE TRIGGER trg_notify_booking_requested
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'requested')
  EXECUTE FUNCTION public.notify_booking_requested();


-- =============================================================================
-- STEP 4 — service_inquiries: notify the platform desk.
--
-- Every inquiry qualifies: the table's INSERT policy is `WITH CHECK (true)`
-- (20260805000002), i.e. anonymous visitors, and there is no state where one of
-- these should arrive unannounced. Services are admin-managed, so the recipient
-- is ADMIN_NOTIFY_EMAIL on the edge side - there is no per-service owner to
-- route to.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_service_inquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.notify_edge_function(
    jsonb_build_object('type', 'service_inquiry', 'inquiry_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An inquiry that reached the database is a lead. Losing it because a mail
  -- hop failed would be the worst possible outcome of adding notifications.
  RAISE WARNING 'notify_service_inquiry failed for inquiry %: % (%). Inquiry kept.',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_service_inquiry ON public.service_inquiries;
CREATE TRIGGER trg_notify_service_inquiry
  AFTER INSERT ON public.service_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_service_inquiry();


-- =============================================================================
-- STEP 5 — hotel_invites: send the invitee their join link.
--
-- ⚠ Only the invite ID crosses the wire. NEW.token is the credential (STEP 13 of
-- 20260813000001: the Clerk JWT carries no `email` claim, so the token IS the
-- authorization) and it must not appear in a pg_net payload, in net.http_request
-- history, or in a WARNING. The edge function reads the token itself, over the
-- service-role connection, and puts it only in the link inside the email body.
--
-- Note this makes the email the delivery mechanism for a credential. Until this
-- trigger existed, admins copied /join/<token> by hand and sent it over
-- WhatsApp, which is still the more reliable channel here - the email is the
-- backstop for someone who is not in your contacts.
--
-- AFTER INSERT: an invite whose row failed to commit must not have generated a
-- redeemable link in somebody's inbox.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.notify_hotel_invite()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.notify_edge_function(
    jsonb_build_object('type', 'hotel_invite', 'invite_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Deliberately logs the invite id and NEVER NEW.token. Postgres logs are read
  -- by more people than the invite was addressed to.
  RAISE WARNING 'notify_hotel_invite failed for invite %: % (%). Invite kept - the admin can still copy the join link from the team screen.',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_hotel_invite ON public.hotel_invites;
CREATE TRIGGER trg_notify_hotel_invite
  AFTER INSERT ON public.hotel_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_hotel_invite();


-- =============================================================================
-- Verify with:
--
--   -- 1. The three triggers exist and are enabled ('O' = enabled):
--   SELECT c.relname AS table_name, t.tgname, t.tgenabled
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname LIKE 'trg_notify_%';
--
--   -- 2. The settings are visible from THIS session (see the ALTER DATABASE
--   --    caveat in the header - a session opened before you set them shows NULL):
--   SELECT current_setting('app.notify_url', true) AS url,
--          (current_setting('app.notify_secret', true) IS NOT NULL) AS secret_set;
--
--   -- 3. Fire one by hand, then look at what pg_net got back. `status_code`
--   --    200 = delivered and acknowledged; 401 = the secret does not match the
--   --    NOTIFY_WEBHOOK_SECRET edge secret; 404 = the function is not deployed;
--   --    an empty table = the request never left, so re-read step 2.
--   SELECT public.notify_edge_function('{"type":"noop"}'::jsonb);  -- returns a request id
--   SELECT id, status_code, content_type, left(content, 300) AS body, created
--     FROM net._http_response
--    ORDER BY created DESC
--    LIMIT 5;
--
--   -- pg_net's response log lives in the same schema as its functions. If the
--   -- NOTICE from STEP 1 said "extensions", read extensions._http_response
--   -- instead of net._http_response. Find it with:
--   SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE c.relname = '_http_response';
--
--   -- 4. End to end, with a real row (use a real hotel-type, daily-rate room):
--   SELECT public.create_booking_request(
--            '<room-uuid>'::uuid, CURRENT_DATE + 3, CURRENT_DATE + 5,
--            2, 0, 'Test Guest', '+252610000000', 'test@example.com', 'ignore');
--   SELECT id, status_code, left(content, 300) FROM net._http_response
--    ORDER BY created DESC LIMIT 1;
--
--   -- Undo (leaves the rows and the edge function alone):
--   -- DROP TRIGGER IF EXISTS trg_notify_booking_requested ON public.bookings;
--   -- DROP TRIGGER IF EXISTS trg_notify_service_inquiry   ON public.service_inquiries;
--   -- DROP TRIGGER IF EXISTS trg_notify_hotel_invite      ON public.hotel_invites;
-- =============================================================================
