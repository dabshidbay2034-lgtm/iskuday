-- =============================================================================
-- Migration: 20260812000001_security_hardening.sql
--
-- Closes SIX confirmed privilege-escalation / abuse holes found by auditing the
-- live policy set against the migration source. Every one of them is reachable
-- today with nothing but the anon key and curl — none of them needs a bug in the
-- React app, because PostgREST exposes the tables directly and the UI is not a
-- security boundary.
--
--   1. CRITICAL  user_roles — self-UPDATE never constrained the role VALUE, so
--                PATCH /rest/v1/user_roles?user_id=eq.<self> {"role":"admin"}
--                made any signed-in user a platform admin.   [20260804000001]
--   2. CRITICAL  property_staff — the org branch of INSERT never checked that
--                the property belongs to that org, so anyone could create a
--                Clerk org, self-assign to a stranger's unit, and inherit
--                is_assigned_staff() on nine tables + the private
--                lease-documents bucket.                      [20260806000001]
--   3. HIGH      hotels — an invited hotel_editor could PATCH owner_id to
--                themselves (hotel_managed() admits editors, and RLS is
--                ROW-level: it cannot freeze a column), which promoted them
--                through hotel_member_admin() and let them delete the hotel.
--                                                             [20260808000001]
--   4. HIGH      properties — the org UPDATE policy pins org_id but not
--                owner_id, so an org:agent could name themselves owner and pick
--                up owns_property(), i.e. the mark-rent-paid right the
--                permission model deliberately withholds from agents. The same
--                block also handed DELETE to org:agent.       [20260804000001]
--   5. HIGH      create_booking_request() is granted to anon with no date
--                bounds, and 'requested' participates in the bookings_no_overlap
--                EXCLUDE constraint — one unauthenticated POST with a 70-year
--                range permanently blocks a room. Room ids are public
--                marketplace data.                            [20260807000001]
--   6. MEDIUM    has_role(text, app_role) takes the user id as a PARAMETER and
--                is PUBLIC-executable → anyone can enumerate platform admins
--                with the anon key. increment_property_view(uuid) is
--                PUBLIC-executable → the edge function's rate limiting is
--                optional.                        [20260309013406 / 20260804000001]
--
-- ── WHAT THIS FILE DOES **NOT** DO ──────────────────────────────────────────
--   • No column is dropped or altered. No data is rewritten.
--   • hotels.sections is untouched (20260810000002 header explains why).
--   • bookings_no_overlap keeps 'requested' in its predicate — see STEP 6.
--
-- ── ORDERING ────────────────────────────────────────────────────────────────
-- Run AFTER 20260804000001, 20260805000001, 20260806000001, 20260807000001,
-- 20260808000001 and 20260810000002. Those files drop every policy on the
-- tables they own before recreating them, so re-running any of them re-opens
-- the holes patched here (fixes 1-4 in particular). If you re-run an earlier
-- migration, re-run this one after it. STEP 0 refuses to proceed if a
-- prerequisite helper is missing.
--
-- ── RE-RUNNABLE ─────────────────────────────────────────────────────────────
-- Policies are dropped by name with IF EXISTS immediately before being
-- recreated (only the ones this file owns — the admin-override policies are
-- deliberately left alone), functions use CREATE OR REPLACE, triggers use
-- DROP TRIGGER IF EXISTS, grants are REVOKE/GRANT which are idempotent.
--
-- ── CLAIM MAPPING (unchanged) ───────────────────────────────────────────────
--     current Clerk user   →  auth.jwt()->>'sub'
--     active org id        →  public.current_org_id()
--     active org role      →  public.current_org_role()
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT.
--
-- This file references four helpers it does not create. Two of them live in
-- different migrations than you would guess: hotel_member_admin() is from
-- 20260810000002, not 20260808000001. Running out of order without this guard
-- dies partway through with a bare "function does not exist" — and because the
-- Supabase SQL editor wraps nothing in a transaction, whatever already ran stays
-- applied, leaving a half-hardened database. Same shape as the preflight in
-- 20260805000001 / 20260810000002, and probed through pg_proc for the same
-- reason (a missing public.app_role type must report as "has_role is missing",
-- not as an unrelated type-resolution error).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_member_admin'
  ) THEN missing := array_append(missing, 'public.hotel_member_admin(uuid)  [20260810000002]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_id'
  ) THEN missing := array_append(missing, 'public.current_org_id()  [20260804000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'owns_property'
  ) THEN missing := array_append(missing, 'public.owns_property(uuid)  [20260805000001]'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
      AND p.pronargs >= 1
      AND p.proargtypes[0] = 'text'::regtype
  ) THEN missing := array_append(missing, 'public.has_role(TEXT, public.app_role)  [20260804000001]'); END IF;

  -- create_booking_request() is CREATE OR REPLACEd in STEP 6. If it is absent
  -- the REPLACE silently becomes a CREATE of a function 20260807000001 will
  -- later overwrite with the UNGUARDED version — the hole would look fixed and
  -- not be. Fail instead.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_booking_request'
  ) THEN missing := array_append(missing, 'public.create_booking_request(...)  [20260807000001]'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Security hardening migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun the migration named in brackets to completion first. Nothing has been changed by this script.',
      array_to_string(missing, E'\n                        ');
  END IF;
END $$;


-- =============================================================================
-- STEP 1 — CRITICAL: user_roles self-write must constrain the ROLE VALUE.
--
-- ── THE ATTACK ──────────────────────────────────────────────────────────────
-- 20260804000001 wrote the self-update policy as
--
--     USING      (auth.jwt()->>'sub' = user_id)
--     WITH CHECK (auth.jwt()->>'sub' = user_id)
--
-- Both halves only answer "is this MY row?". Neither says anything about what
-- `role` may become. So any signed-in user — every account starts as 'user',
-- provisioned by the clerk-webhook — can run
--
--     PATCH /rest/v1/user_roles?user_id=eq.<their own clerk id>
--     { "role": "admin" }
--
-- and has_role(sub,'admin') is true from the next request onward. That single
-- flag is the platform-admin trust root: it unlocks every hidden property, every
-- private phone number in profile_contacts, every hotel via hotel_managed(), and
-- the Admin panel that grants the same to anyone else. No UI involvement, no
-- second bug required — the anon key and the user's own JWT are enough.
--
-- supabase/bootstrap_admin.sql already documents the intended invariant in
-- prose: "CompleteProfile / ProfileSettings can self-upgrade only up to
-- owner / hotel_manager — never admin or semi_admin", and "there is no in-app
-- path to become the first admin". This encodes that invariant in the database,
-- which is the only place it holds.
--
-- ── WHY THE LIST IS IN **BOTH** USING AND WITH CHECK ────────────────────────
-- WITH CHECK alone stops user→admin. It does not stop admin→laundering: an
-- account that is already 'admin' or 'semi_admin' could step DOWN to 'owner'
-- (allowed by a WITH CHECK-only rule) and then back up... which is harmless on
-- its own, but the same asymmetry lets a compromised elevated row be rewritten
-- by the self policy at all. Putting the list in USING too means the self policy
-- simply does not apply to a privileged row: an admin's own row is only
-- writable through "Admins can update any user role", which requires actually
-- being an admin already. Least surprise, and one rule instead of two.
--
-- The two admin-override policies from 20260804000001 ("Admins can update any
-- user role", "Admins can view all user roles", "Semi admins can view all user
-- roles") are NOT touched: they are permissive and OR'd, so a real platform
-- admin keeps full control of every row including their own.
--
-- NOTE ON is_verified: deliberately NOT constrained here. ProfileSettings calls
-- setPlatformRole(userId, newRole, true) and CompleteProfile auto-verifies
-- renters/agents, so a client legitimately writes is_verified today. Tightening
-- it is a product change, not a security fix — see the report.
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own roles" ON public.user_roles;
CREATE POLICY "Users can insert own roles" ON public.user_roles
  FOR INSERT
  WITH CHECK (
    auth.jwt()->>'sub' = user_id
    -- Self-service ceiling. 'admin' and 'semi_admin' are absent on purpose:
    -- they are granted by an existing admin or by supabase/bootstrap_admin.sql.
    AND role IN ('user', 'owner', 'agent', 'hotel_manager')
  );

DROP POLICY IF EXISTS "Users can update own role" ON public.user_roles;
CREATE POLICY "Users can update own role" ON public.user_roles
  FOR UPDATE
  USING (
    auth.jwt()->>'sub' = user_id
    AND role IN ('user', 'owner', 'agent', 'hotel_manager')
  )
  WITH CHECK (
    auth.jwt()->>'sub' = user_id
    AND role IN ('user', 'owner', 'agent', 'hotel_manager')
  );


-- =============================================================================
-- STEP 2 — CRITICAL: property_staff self-assignment must prove the property
--          actually belongs to the org.
--
-- ── THE ATTACK ──────────────────────────────────────────────────────────────
-- 20260806000001's INSERT policy reads
--
--     (org_id IS NOT NULL AND org_id = current_org_id()
--      AND current_org_role() IN ('org:admin','org:manager'))
--     OR owns_property(property_id)
--
-- The org branch checks the ROW's org_id against the caller's active org — it
-- never checks that `property_id` belongs to that org. Creating a Clerk
-- Organization is ungated (anyone can make one and is its org:admin), so the
-- attack is three steps:
--
--     1. create an org in Clerk           → current_org_role() = 'org:admin'
--     2. POST /rest/v1/property_staff
--        { property_id: <any victim property, ids are public marketplace data>,
--          user_id: <self>, org_id: <own org> }        ← passes the org branch
--     3. is_assigned_staff(victim_property) is now TRUE
--
-- Step 3 is the payload. is_assigned_staff() gates read and/or write branches on
-- maintenance_requests, property_expenses, lease_documents, tenants,
-- rent_ledger, utility_bills, property_private, bookings and housekeeping_tasks
-- — plus the storage read policy on the PRIVATE lease-documents bucket, i.e.
-- signed leases and scanned identification for a stranger's tenants.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- Bind the org branch to reality: the property must itself carry that org_id.
-- Written as an EXISTS against public.properties rather than a FK because
-- property_staff.org_id is legitimately NULL on the owner path, and because a
-- property can move between orgs.
--
-- The owns_property(property_id) branch is untouched — it matches
-- properties.owner_id against the caller and never consults org membership (see
-- 20260805000001 STEP 3b), so it cannot be spoofed the same way. A solo landlord
-- with no Clerk org keeps assigning caretakers exactly as before.
--
-- (The SELECT and DELETE policies are left as 20260806000001 wrote them. DELETE
-- is not an escalation — removing a bogus row is the desired outcome — and the
-- self-read branch is what an assigned caretaker relies on to find their unit.)
-- =============================================================================

DROP POLICY IF EXISTS "Org managers or owner can assign staff" ON public.property_staff;
CREATE POLICY "Org managers or owner can assign staff" ON public.property_staff
  FOR INSERT
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
      -- NEW: the unit must belong to the org doing the assigning.
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_id
          AND p.org_id = public.current_org_id()
      )
    )
    OR public.owns_property(property_id)
  );

DROP POLICY IF EXISTS "Org managers or owner can update staff" ON public.property_staff;
CREATE POLICY "Org managers or owner can update staff" ON public.property_staff
  FOR UPDATE
  USING (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_id
          AND p.org_id = public.current_org_id()
      )
    )
    OR public.owns_property(property_id)
  )
  WITH CHECK (
    (
      org_id IS NOT NULL
      AND org_id = public.current_org_id()
      AND public.current_org_role() IN ('org:admin', 'org:manager')
      AND EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = property_id
          AND p.org_id = public.current_org_id()
      )
    )
    OR public.owns_property(property_id)
  );


-- =============================================================================
-- STEP 3 — HIGH: a hotel_editor must not be able to seize the hotel.
--
-- ── THE ATTACK ──────────────────────────────────────────────────────────────
-- 20260810000002 widened hotel_managed() to admit hotel_editor, and
-- 20260808000001's UPDATE/DELETE policies on `hotels` are gated on
-- hotel_managed(id). RLS is ROW-level: "this row is yours to edit" cannot mean
-- "…except these two columns". PostgREST will happily PATCH any column. So an
-- invited editor runs
--
--     PATCH /rest/v1/hotels?id=eq.<hotel>   { "owner_id": "<their clerk id>" }
--
-- and hotel_member_admin() — which admits `h.owner_id = sub` — now returns true
-- for them. That is exactly the promotion 20260810000002 STEP 9 spends a
-- paragraph preventing on hotel_members; it was simply reachable one table over.
-- With owner_id seized they can rewrite the membership list, lock the real owner
-- out, and DELETE the hotel (cascading hotel_pages, hotel_rooms, hotel_members).
-- Setting org_id is the same attack wearing an agency hat: it hands an unrelated
-- Clerk org admin/manager/agent staff full hotel_managed() rights.
--
-- ── THE FIX, IN TWO PARTS ───────────────────────────────────────────────────
-- (a) DELETE is narrowed from hotel_managed() to hotel_member_admin(): deleting
--     a hotel site is an ownership act, not an editing act. Owner, hotel_admin
--     and platform admin only — an org:agent or hotel_editor can no longer
--     destroy a site they were invited to help maintain.
--
-- (b) owner_id and org_id are frozen by a BEFORE UPDATE TRIGGER, not a policy.
--     This is the part that cannot be done in RLS: a policy's WITH CHECK sees
--     the candidate row, not the transition, so it cannot say "this column must
--     equal its old value". A trigger sees OLD and NEW and is the only place
--     the rule actually holds. UPDATE itself stays on hotel_managed() — editors
--     must keep editing pages, colours, publish state and everything else.
-- =============================================================================

-- 3a. DELETE → hotel_member_admin(). Policy name kept identical to
--     20260808000001 so the object mapping stays 1:1 and this file is a clean
--     re-run (see ORDERING in the header).
DROP POLICY IF EXISTS "Managers can delete hotel pages" ON public.hotels;
CREATE POLICY "Managers can delete hotel pages" ON public.hotels
  FOR DELETE
  USING (public.hotel_member_admin(id));

-- 3b. Freeze ownership columns.
--
--     hotel_member_admin() is SECURITY DEFINER (20260810000002 STEP 6), so the
--     lookup is not itself filtered by hotels' RLS and a draft hotel does not
--     make the owner branch return NULL. It admits the hotel's own hotel_admin,
--     the current owner, and platform admins — so a genuine ownership transfer
--     by the owner still works, and an editor's PATCH raises.
--
--     The service_role / superuser escape is deliberate and does not weaken
--     anything: those roles already BYPASS RLS entirely (the clerk-webhook and
--     every edge function hold the service key, which is never shipped to a
--     browser), and without the escape a future backfill or support script run
--     from the SQL editor would be unable to reassign a hotel at all.
CREATE OR REPLACE FUNCTION public.hotels_guard_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Nested rather than one AND so hotel_member_admin() — which hits hotels and
  -- hotel_members — is only called on the rare update that actually touches an
  -- ownership column. Every ordinary page edit pays nothing.
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
  THEN
    IF NOT COALESCE(public.hotel_member_admin(OLD.id), false) THEN
      RAISE EXCEPTION
        'Only the hotel owner, a hotel admin or a platform admin can change a hotel''s owner or agency.'
        USING ERRCODE = '42501';   -- insufficient_privilege
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hotels_guard_ownership ON public.hotels;
CREATE TRIGGER hotels_guard_ownership
  BEFORE UPDATE ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.hotels_guard_ownership();

COMMENT ON FUNCTION public.hotels_guard_ownership() IS
  'Freezes hotels.owner_id and hotels.org_id against everyone except hotel_member_admin() (owner / hotel_admin / platform admin). RLS is row-level and cannot express a frozen column; without this an invited hotel_editor could PATCH owner_id to themselves and inherit hotel_member_admin().';


-- =============================================================================
-- STEP 4 — HIGH: org:agent must not be able to rewrite properties.owner_id,
--          and must not hold DELETE.
--
-- ── THE ATTACK ──────────────────────────────────────────────────────────────
-- 20260804000001 STEP 9 grants UPDATE to org:admin/manager/agent with
--
--     WITH CHECK (org_id IS NOT NULL AND org_id = current_org_id() AND …)
--
-- which pins org_id — the row cannot be moved to another agency — but says
-- nothing about owner_id. An org:agent therefore runs
--
--     PATCH /rest/v1/properties?id=eq.<an agency unit>
--     { "owner_id": "<their own clerk id>" }
--
-- and owns_property() now returns true for them on that unit. That single
-- helper is the solo-landlord bypass wired into every PMS policy, and it is
-- explicitly the thing 20260805000001 STEP 6 warns must never become reachable
-- from org membership:
--
--     "an org:agent is denied UPDATE on rent_ledger, and an owner-branch that
--      keyed off org membership would hand them exactly the privilege that
--      denial exists to withhold."
--
-- Nobody rewrote owns_property() — the agent rewrote the DATA it reads, which
-- has the same effect. Post-PATCH the agent can mark twelve months of rent as
-- collected (the financial control §5 withholds from agents), delete ledger
-- rows, manage tenants and upload/delete lease documents on that unit. It also
-- silently steals the listing from the real landlord, who is no longer its
-- owner in any query.
--
-- Second, smaller finding in the same block: 20260804000001 STEP 9 grants
-- DELETE to org:agent, while ROLE_PERMISSIONS in src/lib/permissions.ts gives
-- PROPERTY_DELETE to org:admin ONLY (it is absent from the MANAGER list too).
-- The UI hides the button; the API did not.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
-- (a) A BEFORE UPDATE trigger — again, a frozen column is not expressible in a
--     row-level policy. owner_id may only change when the CURRENT owner is
--     making the change (a genuine handover) or a platform admin is. Note this
--     is strictly narrower than the policy set: org staff keep UPDATE on every
--     other column of their agency's listings.
--
-- (b) The org DELETE policy's role list is narrowed to ('org:admin'), matching
--     ROLE_PERMISSIONS. "Owners can delete own properties" and "Admins can
--     delete any property" from 20260804000001 are untouched, so a landlord and
--     a platform admin are unaffected.
--
-- Nothing in src/ ever writes properties.owner_id after the initial INSERT
-- (AddProperty.tsx sets it once to the creator), so (a) breaks no live flow.
-- =============================================================================

-- 4a. Freeze properties.owner_id.
CREATE OR REPLACE FUNCTION public.properties_guard_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Same rationale as hotels_guard_ownership(): these roles bypass RLS already.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Nested rather than one AND so has_role() is only consulted on the rare
  -- update that actually touches owner_id — every ordinary listing edit (and
  -- every occupancy/price change from the PMS) pays nothing.
  -- COALESCE on both branches: owner_id is NOT NULL today, but an anonymous
  -- caller's auth.jwt()->>'sub' is NULL, and `NULL = NULL` is NULL, not false —
  -- an unguarded NOT(NULL) is NULL, which an IF treats as "no exception".
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    IF NOT (
         -- The outgoing owner handing the listing over is legitimate.
         COALESCE(OLD.owner_id = auth.jwt()->>'sub', false)
         -- Platform admins arbitrate disputes / clean up abandoned listings.
         OR COALESCE(public.has_role(auth.jwt()->>'sub', 'admin'), false)
       )
    THEN
      RAISE EXCEPTION
        'Only the current owner or a platform admin can change a property''s owner.'
        USING ERRCODE = '42501';   -- insufficient_privilege
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS properties_guard_owner ON public.properties;
CREATE TRIGGER properties_guard_owner
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.properties_guard_owner();

COMMENT ON FUNCTION public.properties_guard_owner() IS
  'Freezes properties.owner_id against everyone but the current owner and platform admins. Without it an org:agent could name themselves owner and pick up owns_property(), which grants the rent-mark-paid control the permission model withholds from agents (20260805000001 STEP 6).';

-- 4b. DELETE is an org:admin action, per ROLE_PERMISSIONS.PROPERTY_DELETE.
DROP POLICY IF EXISTS "Org staff can delete agency properties" ON public.properties;
CREATE POLICY "Org staff can delete agency properties" ON public.properties
  FOR DELETE
  USING (
    org_id IS NOT NULL
    AND org_id = public.current_org_id()
    AND public.current_org_role() IN ('org:admin')
  );


-- =============================================================================
-- STEP 5 — HIGH: bound the anonymous booking request.
--
-- ── THE ATTACK ──────────────────────────────────────────────────────────────
-- create_booking_request() is GRANTed to `anon` (correctly — the public booking
-- form on a room page must work without an account). It validates that the room
-- exists, is a hotel type and is nightly-rate; it does NOT bound the dates. And
-- 'requested' is one of the three states inside bookings_no_overlap:
--
--     EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&)
--       WHERE (status IN ('requested','confirmed','checked_in'))
--
-- So a single unauthenticated POST with check_in = today and check_out = 2096
-- takes the room off the market permanently — the double-booking guard, working
-- exactly as designed, now enforces the attacker's reservation. Room ids are
-- public marketplace data (they are in every listing URL), and nothing rate
-- limits the call, so this is a one-liner against an entire hotel.
--
-- ── THE FIX APPLIED HERE ────────────────────────────────────────────────────
-- Three cheap bounds inside the function: no past check-in, no stay longer than
-- 30 nights, nothing further out than 18 months. That turns "block a room
-- forever with one request" into "block ≤30 nights, and only inside an 18-month
-- window" — a nuisance an operator can cancel, not a permanent denial. The body
-- is otherwise BYTE-FOR-BYTE the original: same signature, same SECURITY
-- DEFINER, same search_path, same org_id derivation, same computed total, same
-- return shape. The GRANT is re-issued because CREATE OR REPLACE keeps existing
-- grants but re-stating it makes the file self-contained.
--
-- ── THE DEEPER FIX, DELIBERATELY NOT MADE HERE ──────────────────────────────
-- The structural answer is to drop 'requested' from the EXCLUDE predicate, so
-- only 'confirmed' and 'checked_in' hold dates and an unconfirmed request cannot
-- block anything at all. It is not done here because it CHANGES PRODUCT
-- BEHAVIOUR, not just safety:
--   • today, two visitors cannot request the same nights — the second gets a
--     clean 23P01 and knows immediately. Without 'requested' in the predicate
--     both requests succeed and the manager has to disappoint one of them by
--     hand, and confirming the second one would then fail against the first.
--   • the room page's availability calendar treats a request as taken; it would
--     need to distinguish "requested" from "booked" or start showing rooms as
--     free that a guest already asked for.
--   • existing 'requested' rows would stop reserving dates the moment the
--     constraint is rebuilt.
-- That is a product decision plus a UI change, and belongs in its own migration
-- alongside them. Rate limiting the RPC per IP (an edge function in front of it,
-- like increment-view) is the other half and is likewise out of scope here.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_booking_request(
  p_room_id   uuid,
  p_check_in  date,
  p_check_out date,
  p_adults    int,
  p_children  int,
  p_guest_name  text,
  p_guest_phone text,
  p_guest_email text,
  p_notes       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prop     public.properties%ROWTYPE;
  v_nights   int;
  v_total    numeric;
  v_booking_id uuid;
BEGIN
  SELECT * INTO v_prop FROM public.properties WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_check_out IS NULL OR p_check_in IS NULL OR p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── ADDED 20260812000001: bounds on an anonymous, unauthenticated request ──
  -- Each message is safe to show a guest verbatim: it says what is wrong and
  -- what to do, and leaks nothing about the room, the hotel or other bookings.

  -- A stay in the past cannot be honoured, and would sit in the EXCLUDE
  -- constraint blocking nothing useful.
  IF p_check_in < CURRENT_DATE THEN
    RAISE EXCEPTION 'Check-in cannot be in the past. Please choose today or a later date.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Long stays are a real request, but not a self-service one — and an unbounded
  -- range is what turns one anonymous POST into a permanent room lockout.
  IF (p_check_out - p_check_in) > 30 THEN
    RAISE EXCEPTION 'Online bookings are limited to 30 nights. Please contact the hotel directly for a longer stay.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Nobody books a room in Mogadishu three years out; an attacker does.
  IF p_check_in > (CURRENT_DATE + INTERVAL '18 months')::date THEN
    RAISE EXCEPTION 'Bookings can only be made up to 18 months in advance.'
      USING ERRCODE = 'P0001';
  END IF;
  -- ── end of added guards; everything below is the original body ─────────────

  -- Only nightly-rate hotel rooms are bookable.
  IF (v_prop.type IS DISTINCT FROM 'hotel') OR (v_prop.is_daily_rate IS NOT TRUE) THEN
    RAISE EXCEPTION 'This unit cannot be booked online.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_adults IS NULL OR p_adults < 1 THEN
    p_adults := 1;
  END IF;
  IF p_children IS NULL OR p_children < 0 THEN
    p_children := 0;
  END IF;

  v_nights := p_check_out - p_check_in;
  v_total  := v_nights * COALESCE(v_prop.price, 0);

  INSERT INTO public.bookings (
    room_id, org_id, guest_name, guest_phone, guest_email,
    check_in, check_out, adults, children,
    rate_per_night, total_amount, amount_paid,
    status, source, notes
  ) VALUES (
    p_room_id, v_prop.org_id,
    NULLIF(btrim(p_guest_name), ''),
    NULLIF(btrim(p_guest_phone), ''), NULLIF(btrim(p_guest_email), ''),
    p_check_in, p_check_out, p_adults, p_children,
    COALESCE(v_prop.price, 0), v_total, 0,
    'requested', 'online', NULLIF(btrim(p_notes), '')
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'id', v_booking_id,
    'total_amount', v_total,
    'nights', v_nights
  );
END $$;

-- Unchanged from 20260807000001 — the public booking form still needs anon.
GRANT EXECUTE ON FUNCTION public.create_booking_request(
  uuid, date, date, int, int, text, text, text, text
) TO anon, authenticated;


-- =============================================================================
-- STEP 6 — MEDIUM: stop handing out EXECUTE on two functions nobody outside the
--          database should be calling.
--
-- ── has_role(TEXT, public.app_role) ─────────────────────────────────────────
-- THE ATTACK: it takes the user id as a PARAMETER, and PostgREST exposes every
-- executable function as POST /rest/v1/rpc/<name>. Clerk user ids are not
-- secret — properties.owner_id ships with every marketplace listing and every
-- profile row — so with the anon key alone an attacker can walk the listing feed
-- and ask, for each id, "is this one an admin?". That is a target list for
-- phishing or credential stuffing, handed over by the API.
--
-- WHY REVOKING IS SAFE FOR RLS (verified, not assumed):
--   EXECUTE privilege on a function is checked when the QUERY NAMING IT is
--   parsed. RLS quals are not part of the user's query text — they are stored
--   expression trees that the rewriter injects after parse analysis, exactly
--   like column DEFAULTs and CHECK constraints, and they are not re-ACL-checked
--   at execution. So "SELECT … FROM properties" continues to evaluate
--   has_role(...) inside its policy whether or not the caller holds EXECUTE.
--   On top of that, has_role is SECURITY DEFINER, so its body has always run as
--   the function owner and never depended on the caller's rights to user_roles.
--   The same reasoning covers hotel_managed(), hotel_member_admin(),
--   hotel_member_role(), owns_property() and is_assigned_staff(), which call
--   has_role from inside their own SECURITY DEFINER bodies — those bodies were
--   analysed once, at CREATE FUNCTION time, as their owner.
--   Nothing in src/ calls has_role over RPC (the app reads user_roles directly
--   through its own SELECT policy, see src/hooks/use-auth.ts).
--   If any policy DOES break, the rollback is one line — it is at the bottom of
--   the Verify block.
--
-- ── increment_property_view(uuid) ───────────────────────────────────────────
-- THE ATTACK: supabase/functions/increment-view/index.ts exists precisely to
-- rate limit this — one counted view per viewer per property per 24h, and never
-- for the owner. But the RPC is directly callable, so any of that is optional:
-- a loop over POST /rest/v1/rpc/increment_property_view inflates a listing's
-- view count without limit (or a competitor's, if the counter ever drives
-- ranking or pricing). The edge function holds the SERVICE-ROLE key, so it is
-- unaffected by this revoke.
--
-- service_role is re-granted explicitly on both so a Supabase project whose
-- default privileges leaned on PUBLIC does not lose the edge-function path.
-- =============================================================================

DO $$
DECLARE
  fn  TEXT;
  rol TEXT;
BEGIN
  -- Every has_role overload, whichever survived 20260804000001 STEP 6 (the UUID
  -- signature is dropped best-effort there and may still be present), plus
  -- increment_property_view. Iterating the catalog rather than naming
  -- signatures keeps this correct on a database where either drop was skipped.
  FOR fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('has_role', 'increment_property_view')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);

    -- anon / authenticated / service_role are Supabase-provisioned roles. They
    -- always exist on a hosted project, but a bare local Postgres (or a
    -- self-hosted variant) may not have them, and REVOKE on a missing role is a
    -- hard 42704 that would abort the run for no security reason.
    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', fn, rol);
      END IF;
    END LOOP;

    -- Re-granted explicitly so a project whose default privileges leaned on
    -- PUBLIC does not lose the edge-function path (increment-view uses the
    -- service-role key; the clerk-webhook may read roles the same way).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;

    RAISE NOTICE 'EXECUTE revoked from PUBLIC/anon/authenticated on %', fn;
  END LOOP;
END $$;


-- =============================================================================
-- End of migration.
--
-- Verify with: (run the read-only queries as any role; the ATTACK simulations
-- want a Clerk JWT — from the browser devtools Network tab of a signed-in
-- non-admin session — or the request.jwt.claims impersonation shown below,
-- which is what PostgREST itself sets.)
--
-- ── 0. Everything this file installs is present ─────────────────────────────
--   SELECT tgname, tgrelid::regclass FROM pg_trigger
--    WHERE tgname IN ('hotels_guard_ownership','properties_guard_owner');
--   -- expect 2 rows
--
-- ── 1. user_roles: self-escalation to admin is refused ──────────────────────
--   -- policy text must mention the role ceiling on BOTH halves (expect 0 rows):
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='user_roles'
--      AND policyname IN ('Users can insert own roles','Users can update own role')
--      AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%hotel_manager%';
--
--   -- live attack simulation, as a non-admin user (expect: 0 rows updated —
--   -- RLS filters the row out rather than raising):
--   BEGIN;
--     SET LOCAL role TO authenticated;
--     SET LOCAL request.jwt.claims TO '{"sub":"user_REPLACE_WITH_A_REAL_NON_ADMIN"}';
--     UPDATE public.user_roles SET role='admin'
--      WHERE user_id = 'user_REPLACE_WITH_A_REAL_NON_ADMIN';
--     -- expect UPDATE 0
--     UPDATE public.user_roles SET role='owner'
--      WHERE user_id = 'user_REPLACE_WITH_A_REAL_NON_ADMIN';
--     -- expect UPDATE 1 — the legitimate self-upgrade still works
--   ROLLBACK;
--
-- ── 2. property_staff: cross-tenant self-assignment is refused ──────────────
--   -- both write policies must now consult properties (expect 0 rows):
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='property_staff' AND cmd IN ('INSERT','UPDATE')
--      AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%properties%';
--
--   BEGIN;
--     SET LOCAL role TO authenticated;
--     SET LOCAL request.jwt.claims TO
--       '{"sub":"user_ATTACKER","o":{"id":"org_ATTACKER_OWN","rol":"org:admin"}}';
--     INSERT INTO public.property_staff (property_id, user_id, org_id)
--     SELECT id, 'user_ATTACKER', 'org_ATTACKER_OWN'
--       FROM public.properties WHERE org_id IS DISTINCT FROM 'org_ATTACKER_OWN' LIMIT 1;
--     -- expect: ERROR 42501 new row violates row-level security policy
--   ROLLBACK;
--
-- ── 3. hotels: an editor cannot seize or delete ─────────────────────────────
--   -- DELETE must be gated on hotel_member_admin, not hotel_managed:
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename='hotels' AND cmd='DELETE';
--   -- expect qual = hotel_member_admin(id)
--
--   BEGIN;
--     SET LOCAL role TO authenticated;
--     SET LOCAL request.jwt.claims TO '{"sub":"user_AN_INVITED_HOTEL_EDITOR"}';
--     UPDATE public.hotels SET owner_id='user_AN_INVITED_HOTEL_EDITOR'
--      WHERE id='<hotel they can edit>';
--     -- expect: ERROR 42501 Only the hotel owner, a hotel admin or a platform admin…
--     UPDATE public.hotels SET tagline='still editable' WHERE id='<same hotel>';
--     -- expect UPDATE 1 — editing is unaffected
--   ROLLBACK;
--
-- ── 4. properties: an agent cannot become owner, and cannot delete ──────────
--   BEGIN;
--     SET LOCAL role TO authenticated;
--     SET LOCAL request.jwt.claims TO
--       '{"sub":"user_AGENT","o":{"id":"org_THEIR_AGENCY","rol":"org:agent"}}';
--     UPDATE public.properties SET owner_id='user_AGENT' WHERE org_id='org_THEIR_AGENCY';
--     -- expect: ERROR 42501 Only the current owner or a platform admin…
--     UPDATE public.properties SET description='still editable' WHERE org_id='org_THEIR_AGENCY';
--     -- expect UPDATE >= 1 — normal agency editing is unaffected
--     DELETE FROM public.properties WHERE org_id='org_THEIR_AGENCY';
--     -- expect DELETE 0 — org:agent is no longer in the DELETE role list
--   ROLLBACK;
--
--   SELECT policyname, qual FROM pg_policies
--    WHERE schemaname='public' AND tablename='properties' AND cmd='DELETE'
--      AND policyname='Org staff can delete agency properties';
--   -- expect the role list to contain org:admin only
--
-- ── 5. bookings: the anonymous 70-year lockout is refused ───────────────────
--   SELECT public.create_booking_request(
--     '<a real hotel room id>', CURRENT_DATE, CURRENT_DATE + 25000, 1, 0,
--     'DoS', NULL, NULL, NULL);
--   -- expect: ERROR P0001 Online bookings are limited to 30 nights…
--   SELECT public.create_booking_request(
--     '<same room>', CURRENT_DATE - 5, CURRENT_DATE + 2, 1, 0, 'DoS', NULL, NULL, NULL);
--   -- expect: ERROR P0001 Check-in cannot be in the past…
--   SELECT public.create_booking_request(
--     '<same room>', CURRENT_DATE + 800, CURRENT_DATE + 802, 1, 0, 'DoS', NULL, NULL, NULL);
--   -- expect: ERROR P0001 Bookings can only be made up to 18 months in advance.
--   SELECT public.create_booking_request(
--     '<same room>', CURRENT_DATE + 7, CURRENT_DATE + 9, 2, 0,
--     'Real Guest', '+2526...', NULL, NULL);
--   -- expect: {"id": …, "nights": 2, …} — a normal booking still works
--
-- ── 6. EXECUTE is gone, and the policies that call has_role still work ──────
--   SELECT p.oid::regprocedure::text AS fn,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('has_role','increment_property_view');
--   -- expect anon=false, auth_=false, svc=true on every row
--
--   -- the RLS path is unaffected (function ACLs are checked at PARSE time, and
--   -- RLS quals are injected by the rewriter, not parsed from the user's query):
--   BEGIN;
--     SET LOCAL role TO authenticated;
--     SET LOCAL request.jwt.claims TO '{"sub":"user_ANY_REAL_USER"}';
--     SELECT count(*) FROM public.properties;          -- policy calls has_role
--     SELECT count(*) FROM public.profile_contacts;    -- policy calls has_role
--     -- expect both to return a number, NOT "permission denied for function has_role"
--   ROLLBACK;
--
--   -- ROLLBACK for STEP 6 only, if a policy really does break:
--   --   GRANT EXECUTE ON FUNCTION public.has_role(text, public.app_role)
--   --     TO authenticated, anon;
-- =============================================================================
