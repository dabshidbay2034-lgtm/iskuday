-- =============================================================================
-- Migration: 20260815000001_staff_documents.sql
--
-- The STAFF DOCUMENT VAULT — an employer's file on each team member.
--
-- An employer has to keep paperwork for everyone on the roster: the CV they
-- were hired on, a passport or national ID scan, the signed contract, trade
-- certificates, a staff photo. Today those live in someone's phone gallery or a
-- WhatsApp thread. `staff_documents` puts them against the `hotel_staff` row
-- they belong to, with an expiry date so a lapsed passport surfaces BEFORE the
-- member is turned away at a border or a labour inspection.
--
-- WHAT THIS ADDS:
--   • public.staff_documents      — one row per file, hung off hotel_staff.
--   • storage bucket `staff-documents` (PRIVATE) — the bytes themselves.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PRIVACY — READ THIS BEFORE CHANGING ANY POLICY BELOW
--
-- A PASSPORT SCAN MUST NEVER BE PUBLICLY READABLE. The bucket is created with
-- `public = false` and every download goes through a short-lived signed URL
-- that the storage SELECT policy only issues to someone who can already read
-- the owning `staff_documents` row. Flipping `public` to true on this bucket
-- would expose every ID scan and contract in the vault to anyone who can guess
-- (or scrape) an object path — there is no second lock behind it. Don't.
-- This mirrors the `lease-documents` bucket from 20260806000001 exactly, in
-- shape and in intent.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ACCESS MODEL — `public.hotel_staff_managed(staff_id)` IS THE WHOLE BOUNDARY.
--
--   That helper (20260810000001) already answers "may the current user manage
--   this team member?" for the solo operator, the matching agency's
--   admin/manager/agent, and platform admins. Every one of the four policies
--   below delegates to it, so the vault can never drift out of step with the
--   roster it hangs off: lose access to the member, lose access to their file.
--
--   THERE IS DELIBERATELY NO "the staff member can read their own documents"
--   BRANCH, and none should be added by guesswork.
--   `hotel_staff` rows are RECORDS MAINTAINED BY AN EMPLOYER, not user
--   accounts — exactly like `tenants`. A member has no Clerk identity in this
--   system, so there is no `auth.jwt()->>'sub'` to match them against; the
--   table has no user-id column at all. Any "self-service" branch someone
--   invents here would have to key on `email` or a similar soft field, which is
--   a spoofable identity check standing between the internet and a folder of
--   passport scans. If self-service is ever genuinely wanted, it needs a real
--   linked account column on `hotel_staff` first, and a fresh review of this
--   file — not a widened USING clause.
--
-- RE-RUNNABLE: policies dropped dynamically at the top, table/index via
--   IF NOT EXISTS, constraints dropped-then-added, storage policies dropped by
--   name before creation.
--
-- PREREQUISITES: 20260810000001 (hotel_staff + hotel_staff_managed), which in
--   turn needs the 20260805000001 foundation. STEP 0 fails loudly otherwise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT. This migration is meaningless without the roster it hangs
--          off, and a missing helper would silently produce a table whose
--          policies reference a function that doesn't exist. Fail before we
--          create anything.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hotel_staff' AND c.relkind = 'r'
  ) THEN missing := array_append(missing, 'public.hotel_staff (table)'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'hotel_staff_managed'
  ) THEN missing := array_append(missing, 'public.hotel_staff_managed(uuid)'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Staff document vault migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun supabase/migrations/20260810000001_hotel_staff_payroll.sql first. Nothing has been changed by this script.',
      array_to_string(missing, ', ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the table this file owns, so the CREATE
--          POLICY statements below can never hit 42710 on a re-run.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('staff_documents')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — public.staff_documents.
--
--   owner_id / org_id  denormalised from hotel_staff so the vault carries the
--                      same ownership stamp as payroll does. They are NOT the
--                      access check — hotel_staff_managed(staff_id) is — but
--                      they make "whose vault is this?" answerable without a
--                      join, and keep the shape consistent with staff_payroll.
--   file_path          NOT NULL: a metadata row with no object behind it is a
--                      broken download button. The upload flow writes the
--                      object first and only then inserts the row.
--   issued_on/expires_on  what makes this a vault rather than a folder. The UI
--                      warns inside a 30-day window and shouts once past it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_documents (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  staff_id    UUID        NOT NULL REFERENCES public.hotel_staff(id) ON DELETE CASCADE,
  owner_id    TEXT        NOT NULL,                -- Clerk id of the employer
  org_id      TEXT,                                -- NULL for solo operators
  title       TEXT        NOT NULL,
  doc_type    TEXT        NOT NULL DEFAULT 'other',
  file_name   TEXT,
  file_path   TEXT        NOT NULL,                -- object path in staff-documents
  mime_type   TEXT,
  size_bytes  BIGINT,
  issued_on   DATE,
  expires_on  DATE,
  uploaded_by TEXT,                                -- Clerk id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_documents_pkey PRIMARY KEY (id)
);

ALTER TABLE public.staff_documents DROP CONSTRAINT IF EXISTS staff_documents_doc_type_check;
ALTER TABLE public.staff_documents
  ADD CONSTRAINT staff_documents_doc_type_check
  CHECK (doc_type IN ('cv','passport','national_id','contract','certificate','photo','other'));

-- Every read is "the documents for this member", so this is the one index the
-- vault actually needs.
CREATE INDEX IF NOT EXISTS idx_staff_documents_staff ON public.staff_documents(staff_id);


-- -----------------------------------------------------------------------------
-- STEP 3 — RLS. All four verbs, one gate: hotel_staff_managed(staff_id).
--
-- See the ACCESS MODEL note in the header before adding a branch here. In
-- particular: no "the staff member sees their own" clause — they are records,
-- not accounts.
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employer sees staff documents" ON public.staff_documents
  FOR SELECT
  USING (public.hotel_staff_managed(staff_id));

CREATE POLICY "Employer can upload staff documents" ON public.staff_documents
  FOR INSERT
  WITH CHECK (public.hotel_staff_managed(staff_id));

-- USING and WITH CHECK are both gated so a row can't be re-pointed at a member
-- the caller doesn't manage (which would smuggle a file into someone else's
-- vault, or out of it).
CREATE POLICY "Employer can update staff documents" ON public.staff_documents
  FOR UPDATE
  USING (public.hotel_staff_managed(staff_id))
  WITH CHECK (public.hotel_staff_managed(staff_id));

CREATE POLICY "Employer can delete staff documents" ON public.staff_documents
  FOR DELETE
  USING (public.hotel_staff_managed(staff_id));


-- -----------------------------------------------------------------------------
-- STEP 4 — The PRIVATE `staff-documents` bucket + scoped object policies.
--
-- Shape copied verbatim from the `lease-documents` bucket (20260806000001):
--
--   Read:   an EXISTS join back to a staff_documents row the caller can read.
--           Because that subquery repeats the table's own gate, a signed URL is
--           only ever issued for a file whose member the caller manages.
--   Insert: objects must land in the uploader's OWN folder, `<auth.sub>/<file>`.
--           This is a containment rule, not the real gate — the file only
--           becomes part of a member's vault when the staff_documents INSERT
--           policy above lets the metadata row through.
--   Delete: folder owner only, so cleaning up an orphaned upload never reaches
--           into another user's folder.
--
-- `public = false` is load-bearing. See the PRIVACY note in the header.
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-documents', 'staff-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Belt and braces: if an earlier run (or a console click) ever flipped this
-- bucket public, put it back. A passport scan is not a listing photo.
UPDATE storage.buckets SET public = false WHERE id = 'staff-documents' AND public;

DROP POLICY IF EXISTS "Auth can read managed staff documents" ON storage.objects;
CREATE POLICY "Auth can read managed staff documents" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'staff-documents'
    AND EXISTS (
      SELECT 1 FROM public.staff_documents sd
      WHERE sd.file_path = storage.objects.name
        AND public.hotel_staff_managed(sd.staff_id)
    )
  );

DROP POLICY IF EXISTS "Auth can upload own staff documents" ON storage.objects;
CREATE POLICY "Auth can upload own staff documents" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'staff-documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.jwt()->>'sub'
  );

DROP POLICY IF EXISTS "Auth can delete own staff documents" ON storage.objects;
CREATE POLICY "Auth can delete own staff documents" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'staff-documents'
    AND (storage.foldername(name))[1] = auth.jwt()->>'sub'
  );


-- =============================================================================
-- Verify with:
--
--   -- 1. The bucket is PRIVATE. This must return exactly one row, public = f.
--   --    If it says t, downloads bypass RLS entirely — treat as an incident.
--   SELECT id, public FROM storage.buckets WHERE id = 'staff-documents';
--
--   -- 2. All four verbs are gated, and every one of them on the same helper.
--   SELECT policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'staff_documents'
--    ORDER BY cmd;
--   -- expect 4 rows (SELECT/INSERT/UPDATE/DELETE), each mentioning
--   -- hotel_staff_managed, and NONE mentioning an email or name comparison.
--
--   -- 3. An UNRELATED user gets ZERO rows. Run as a signed-in user who does
--   --    not own (and shares no org with) the member the documents belong to:
--   SELECT count(*) FROM public.staff_documents;                 -- expect 0
--   SELECT count(*) FROM storage.objects
--    WHERE bucket_id = 'staff-documents';                        -- expect 0
--   -- ...and the employer, in the same query, sees their own:
--   SELECT count(*) FROM public.staff_documents;                 -- expect > 0
--
--   -- 4. A signed URL for someone else's document is refused:
--   --    storage.createSignedUrl('<their-path>', 3600) → error, not a link.
-- =============================================================================
