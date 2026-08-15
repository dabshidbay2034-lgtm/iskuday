-- =============================================================================
-- Migration: 20260819000001_bnb_type.sql
--
-- Adds 'bnb' to the property_type enum. NOTHING ELSE.
--
-- A BnB is a short-let unit: it is a property in every way an apartment is —
-- one owner, expenses, maintenance, staff, documents — but it earns by the
-- night and takes reservations, the way a hotel room does. It is deliberately
-- NOT a hotel: a hotel is one building with a front desk and a public website,
-- a BnB is a unit in a portfolio.
--
-- ── WHY THIS FILE CONTAINS ONE STATEMENT ───────────────────────────────────
-- `ALTER TYPE ... ADD VALUE` is special. Since PG12 it may run inside a
-- transaction block, but the new label CANNOT BE USED by anything else in that
-- same transaction — Postgres raises
--     unsafe use of new value "bnb" of enum type property_type
-- The Supabase CLI wraps each migration file in one transaction, so any file
-- that both adds the label and then references it in a CHECK, an index, a
-- backfill or a validated function body will fail halfway, leaving the enum
-- extended and the rest missing.
--
-- Splitting is the fix: this file widens the type, and 20260819000002 uses it.
-- Two files that each succeed completely beat one that can half-apply. This is
-- also why there is no backfill here — there is nothing to backfill, because
-- no row can be 'bnb' until the label exists.
--
-- ── NO CHANGE IS NEEDED TO THE ACCOUNT-TYPE TRIGGER ────────────────────────
-- 20260812000002 enforces the agency/hotel split as:
--     type  = 'hotel'  requires a hotel_manager
--     type <> 'hotel'  requires NOT a hotel_manager
-- 'bnb' falls into the second branch by construction, so agencies and solo
-- landlords may list one and hotel accounts may not — which is exactly the
-- intent — without editing that trigger. Verified below.
--
-- RE-RUNNABLE: ADD VALUE IF NOT EXISTS.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'property_type') THEN
    RAISE EXCEPTION
      E'public.property_type is missing — this database is not initialised.\n\nNothing has been changed by this script.';
  END IF;
END $$;

ALTER TYPE public.property_type ADD VALUE IF NOT EXISTS 'bnb';

-- =============================================================================
-- Verify with:
--
--   -- 1. The label is there:
--   SELECT enumlabel FROM pg_enum e
--     JOIN pg_type t ON t.oid = e.enumtypid
--    WHERE t.typname = 'property_type'
--    ORDER BY e.enumsortorder;
--   -- expect: villa, apartment, hotel, commercial, bnb
--
--   -- 2. THEN apply 20260819000002_bnb_booking.sql. Applying it in the same
--   --    session is fine; applying it in the same TRANSACTION is not.
-- =============================================================================
