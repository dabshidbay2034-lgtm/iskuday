-- =============================================================================
-- Migration: 20260805000003_fix_admin_services.sql
--
-- Fixes three issues surfaced in the admin/services audit:
--   1. user_roles allowed one row PER (user_id, role), but the app treats role
--      as singular (useAppAuth resolves it with .maybeSingle()). CompleteProfile's
--      onConflict-less upsert created a second row alongside the webhook's 'user'
--      default, and .maybeSingle() then errored on the pair — locking the user
--      out of every role-gated page right after profile completion. This makes
--      user_id UNIQUE (one role per user), dedupes the rows the bug already
--      created, and updates the webhook + CompleteProfile conflict targets to
--      match (those edits are in code, not SQL).
--   2. service_inquiries.property_id is a UUID FK, but the inquiry dialog
--      collected it as free text ("Property ID or address if applicable") — so
--      any non-UUID input failed the FK and killed the whole insert. Add a
--      property_ref TEXT column for the free-text reference and stop abusing the
--      FK column for it.
--   3. services had no updated_at trigger (unlike every PMS table); the client
--      set it by hand, which drifts if another writer ever appears.
--
-- Re-runnable: guarded with IF EXISTS / existence checks throughout.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — Collapse each user to a single user_roles row, then make user_id
--          UNIQUE so the bug can't recur.
--
--          Precedence when a user has several role rows: keep the most
--          privileged. The legacy UNIQUE(user_id, role) let CompleteProfile add
--          e.g. an 'owner' row next to the webhook's 'user' default; we keep
--          'owner' and drop the stale 'user'. has_role() and the rest of the app
--          read exactly one row either way, so this is lossless for anyone whose
--          role was ever actually upgraded.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  deleted_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY
               CASE role
                 WHEN 'admin'         THEN 0
                 WHEN 'semi_admin'    THEN 1
                 WHEN 'owner'         THEN 2
                 WHEN 'hotel_manager' THEN 3
                 WHEN 'agent'         THEN 4
                 WHEN 'user'          THEN 5
                 ELSE 6
               END,
               id DESC   -- deterministic tiebreak (no created_at on this table)
           ) AS rn
    FROM public.user_roles
  )
  DELETE FROM public.user_roles
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
   RETURNING 1 INTO deleted_count;

  RAISE NOTICE 'user_roles dedup: removed % duplicate row(s).', COALESCE(deleted_count, 0);
END $$;

-- Drop the old composite unique constraint (auto-named user_roles_user_id_role_key)
-- so the stricter single-column unique can replace it. IF EXISTS for re-runs.
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

-- Add UNIQUE(user_id) if it isn't already there. No ADD CONSTRAINT IF NOT EXISTS
-- in Postgres, so guard through pg_constraint for re-runnability.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass
      AND conname = 'user_roles_user_id_key'
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_key UNIQUE (user_id);
    RAISE NOTICE 'Added user_roles_user_id_key (UNIQUE user_id).';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — service_inquiries.property_ref: free-text property reference.
--          property_id stays as the UUID FK for a real linked property; the new
--          column is where the dialog's text input lands so it can't break the FK.
-- -----------------------------------------------------------------------------
ALTER TABLE public.service_inquiries ADD COLUMN IF NOT EXISTS property_ref TEXT;


-- -----------------------------------------------------------------------------
-- STEP 3 — services.updated_at trigger, matching every other updated table.
--          Lets useUpdateService drop its manual JS timestamp.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_services_updated_at ON public.services;
CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
