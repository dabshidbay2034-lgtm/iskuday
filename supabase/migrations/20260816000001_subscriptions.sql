-- =============================================================================
-- Migration: 20260816000001_subscriptions.sql
--
-- SUBSCRIPTIONS + TRIALS — the money layer.
--
-- Two paid plans, one 14-day trial each:
--
--   hotel  ($99.99/mo)  hotel rooms, front desk, bookings, housekeeping, pages
--   pms    ($60.00/mo)  rent ledger, utilities, expenses, maintenance, leases,
--                       tenants
--
-- WHAT THIS ADDS:
--   • public.subscriptions          — one row per (subject, plan).
--   • public.subscription_payments  — money actually received, manually recorded.
--   • public.owns_subscription(uuid)      — "is this subscription mine?"
--   • public.subscription_state(...)      — the EFFECTIVE state, computed now().
--   • public.start_trial(...)             — the one sanctioned self-serve write.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- NO PAYMENT PROCESSOR. READ THIS BEFORE ADDING ONE.
--
-- Stripe does not support Somalia as a business location, and this market pays
-- by mobile money. So there is deliberately no `stripe_customer_id`, no
-- `provider` column and no webhook table here. What there IS:
--
--   `subscription_payments.method` uses the rent-collection vocabulary
--   (`cash | evc | zaad | bank | other`, see src/hooks/use-rent.ts:41) PLUS
--   `sifalo` (Sifalo Pay, the Somali aggregator the owner also collects
--   through), and a nullable `external_ref` for whatever transaction id the
--   rail hands back.
--
-- The day-one flow is a human one: the operator sends $60 over EVC, Zaad or
-- Sifalo Pay, a platform admin confirms the transfer landed, records the
-- payment here and moves the subscription to 'active'. That is a FIRST-CLASS
-- path, not a stopgap — every policy below works without a processor.
-- When a rail is finally chosen, it writes to these same two tables through a
-- service-role edge function. Nothing here needs to change.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ═════════════════════════════════════════════════════════════════════════════
-- THE SECURITY PROPERTY OF THIS ENTIRE FILE, IN ONE SENTENCE:
--
--   A SUBSCRIBER CAN READ THEIR OWN SUBSCRIPTION AND NOTHING ELSE — THEY CAN
--   NEVER WRITE THEIR OWN `status`, `trial_ends_at` OR `current_period_end`.
--
-- `subscriptions` and `subscription_payments` have NO subscriber-facing
-- INSERT, UPDATE or DELETE policy. Only a platform admin writes them. This is
-- money: if a subscriber could UPDATE their own row, the product would be free
-- to anyone who can open a browser console and type
-- `.from('subscriptions').update({ status: 'active' })`. There is no second
-- lock behind this one — the entitlement checks in the React app read these
-- rows and believe them.
--
-- The single self-serve write in the whole file is `public.start_trial()`, a
-- SECURITY DEFINER function that can ONLY ever produce `status = 'trialing'`
-- with a server-computed `trial_ends_at = now() + 14 days`, refuses to act for
-- a subject that isn't the caller, and is a no-op when a row already exists
-- (so a used trial can never be restarted). The 14 is hard-coded IN SQL on
-- purpose: a client-supplied duration is a client-supplied free subscription.
--
-- If you are widening a policy below, the question to answer first is "can the
-- person this now lets in give themselves a paid plan for free?"
-- ═════════════════════════════════════════════════════════════════════════════
--
-- RE-RUNNABLE: policies dropped dynamically at the top, table/index via
--   IF NOT EXISTS, constraints dropped-then-added, trigger dropped by name,
--   functions via CREATE OR REPLACE.
--
-- PREREQUISITES: 20260804000001 (Clerk auth — has_role(TEXT, app_role),
--   current_org_id()) and 20260306213635 (update_updated_at_column()).
--   STEP 0 fails loudly otherwise.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 0 — PREFLIGHT. Every policy below leans on has_role() and
--          current_org_id(). A missing helper would create tables whose
--          policies reference a function that doesn't exist — which fails at
--          CREATE POLICY time on a good day, and silently denies everything on
--          a bad one. Fail before we create anything.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Checked against proargtypes, NOT against the formatted argument string.
  --
  -- This file originally compared pg_get_function_identity_arguments(p.oid) to
  -- the literal 'text, app_role'. That function renders a type name
  -- schema-qualified whenever the type is not on the caller's search_path, so
  -- it yields 'text, app_role' from psql but 'text, public.app_role' from the
  -- Supabase SQL editor — and the equality test then reported a perfectly
  -- healthy database as missing its own auth helper, refusing to run.
  --
  -- 20260805000001_pms_foundation.sql:109 already documents this exact trap and
  -- solves it this way. Same shape here, deliberately: one convention, and one
  -- that has actually been run against this database.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
      AND p.pronargs >= 1
      AND p.proargtypes[0] = 'text'::regtype
  ) THEN missing := array_append(missing, 'public.has_role(TEXT, public.app_role)'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_org_id'
  ) THEN missing := array_append(missing, 'public.current_org_id()'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN missing := array_append(missing, 'public.update_updated_at_column()'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      E'Subscriptions migration cannot run yet.\n\nMissing prerequisite(s): %\n\nRun supabase/migrations/20260804000001_migrate_to_clerk_auth.sql first. Nothing has been changed by this script.',
      array_to_string(missing, ', ');
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 1 — Drop every RLS policy on the two tables this file owns, so the
--          CREATE POLICY statements below can never hit 42710 on a re-run.
--
--          Dropping by dynamic enumeration rather than by name on purpose: a
--          policy added by hand in the dashboard (say, a well-meaning "let
--          users update their own subscription") would survive a name-based
--          drop and quietly become the hole this whole file exists to close.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('subscriptions', 'subscription_payments')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I;',
      pol.policyname, pol.schemaname, pol.tablename
    );
    RAISE NOTICE 'Dropped policy % on %.%', pol.policyname, pol.schemaname, pol.tablename;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 2 — public.subscriptions.
--
--   subject_type / subject_id
--       WHO is subscribed. Two shapes, because the platform serves two shapes
--       of landlord (see useManageScope in use-rent.ts): an AGENCY is a Clerk
--       organization ('org' + org id), a SOLO landlord or hotelier has no
--       organization at all ('user' + Clerk user id). Gating on an org would
--       have locked out exactly the small Mogadishu landlords this product is
--       for. TEXT, not UUID — Clerk ids are `user_2ab…` / `org_2cd…`.
--
--   plan
--       'hotel' or 'pms'. Not an enum: a third plan should be a one-line CHECK
--       change here and a one-line addition to src/lib/plans.ts, not an
--       ALTER TYPE that can't run inside a transaction.
--
--   status
--       The RECORDED status. It is NOT the whole truth — read the note on
--       subscription_state() in STEP 5 before using this column directly.
--
--   trial_ends_at / current_period_end
--       The timestamps that actually decide entitlement.
--
--   UNIQUE (subject_type, subject_id, plan)
--       One subscription per subject per plan. This is also what makes
--       start_trial() idempotent — the ON CONFLICT below needs this exact
--       constraint to hang off.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  subject_type       TEXT        NOT NULL,
  subject_id         TEXT        NOT NULL,          -- Clerk user id or org id
  plan               TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'trialing',
  trial_ends_at      TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id)
);

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_subject_type_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_subject_type_check
  CHECK (subject_type IN ('user', 'org'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('hotel', 'pms'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired'));

-- A 'trialing' row MUST carry an end date. Without this, the combination
-- (status='trialing', trial_ends_at=NULL) is a PERMANENTLY ENTITLED
-- SUBSCRIPTION: subscription_state() only resolves a trial to 'expired' when
-- the timestamp is non-null, so a null one is never revisited and the account
-- is free forever.
--
-- That state is reachable by accident, not by attack. `status` DEFAULTs to
-- 'trialing' and `trial_ends_at` is nullable, so the most natural hand-written
-- INSERT an admin could type —
--     INSERT INTO subscriptions (subject_type, subject_id, plan) VALUES (…);
-- — produces exactly it, silently, with no error and nothing in the UI to show
-- for it. start_trial() always sets the timestamp, so this constrains only the
-- paths that bypass it.
--
-- Enforced as a constraint rather than fixed inside subscription_state()
-- because the bad row should not be creatable in the first place: any future
-- reader of the state (a report, an export, a second app) would otherwise have
-- to independently remember to special-case null.
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_trialing_needs_end;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_trialing_needs_end
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL);

-- One row per subject per plan. Load-bearing: start_trial()'s ON CONFLICT
-- targets this, and without it a double-click on "Start trial" would open two
-- trials and the reads below would pick one at random.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_subject_plan
  ON public.subscriptions(subject_type, subject_id, plan);

-- Every read is "what does this subject have?", so this is the one extra index
-- the table needs.
CREATE INDEX IF NOT EXISTS idx_subscriptions_subject
  ON public.subscriptions(subject_type, subject_id);

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- -----------------------------------------------------------------------------
-- STEP 3 — public.subscription_payments. Money that actually arrived.
--
--   amount / currency
--       NUMERIC(12,2), never a float. $99.99 must stay $99.99 after a hundred
--       round trips. CHECK (amount >= 0): a refund is not a negative payment
--       row, it is a separate decision that needs its own design.
--
--   method
--       The five rent-collection values (use-rent.ts:41) PLUS 'sifalo'.
--       Sharing the vocabulary is deliberate: the operator who records "tenant
--       paid rent by Zaad" and the admin who records "operator paid their
--       subscription by Zaad" are describing the same real-world act, and the
--       reports should be able to say so.
--
--       ⚠ THE TWO VOCABULARIES HAVE DELIBERATELY DIVERGED. `rent_ledger.method`
--       does NOT allow 'sifalo' — Sifalo Pay is how operators pay US, and no
--       one has asked for it as a way tenants pay their landlord. Do not
--       "helpfully" unify them: `rent_ledger`'s CHECK lives in its own applied
--       migration (20260805000001) and widening it from here would leave two
--       migrations fighting over one constraint. If tenants genuinely start
--       paying rent through Sifalo, that is its own migration, with its own
--       update to PAYMENT_METHODS in src/hooks/use-rent.ts.
--
--   external_ref
--       Nullable transaction id — an EVC reference today, a processor's charge
--       id if a rail is ever wired up. Nullable because cash has no reference
--       and forcing one would mean inventing fake ones.
--
--   covers_period_start / covers_period_end
--       WHAT the money bought. Kept separate from the subscription's own
--       `current_period_end` because they answer different questions: this is
--       an immutable receipt, that is the current entitlement window.
--
--   recorded_by
--       Clerk id of the admin who confirmed it. With a manual rail this is the
--       audit trail — the only evidence of who decided the money landed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  subscription_id     UUID          NOT NULL
                                    REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency            TEXT          NOT NULL DEFAULT 'USD',
  method              TEXT          NOT NULL DEFAULT 'other',
  external_ref        TEXT,
  paid_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  covers_period_start DATE,
  covers_period_end   DATE,
  recorded_by         TEXT,                          -- Clerk id of the admin
  note                TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT subscription_payments_pkey PRIMARY KEY (id)
);

ALTER TABLE public.subscription_payments
  DROP CONSTRAINT IF EXISTS subscription_payments_method_check;
ALTER TABLE public.subscription_payments
  ADD CONSTRAINT subscription_payments_method_check
  CHECK (method IN ('cash', 'evc', 'zaad', 'sifalo', 'bank', 'other'));

-- Every read is "the receipts for this subscription, newest first".
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription
  ON public.subscription_payments(subscription_id, paid_at DESC);


-- -----------------------------------------------------------------------------
-- STEP 4 — public.owns_subscription(uuid).
--
-- "Is this subscription mine?" — the subject test, in one place, so the
-- payments policy and the subscriptions policy can never drift apart.
--
-- SECURITY DEFINER so the payments policy doesn't depend on RLS-inside-RLS
-- semantics when it looks up the parent row. It answers only about the CALLER,
-- so it cannot be used to ask about anyone else.
--
-- current_org_id() is NULL for a user with no active organization, and
-- `subject_id = NULL` is NULL (not true) — so a solo landlord never matches an
-- org-owned subscription by accident. That is the correct behaviour, and it is
-- why this is written as an equality rather than a COALESCE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_subscription(_subscription_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.id = _subscription_id
      AND (
        (s.subject_type = 'user' AND s.subject_id = auth.jwt()->>'sub')
        OR (s.subject_type = 'org' AND s.subject_id = public.current_org_id())
      )
  );
$$;


-- -----------------------------------------------------------------------------
-- STEP 5 — public.subscription_state(): the EFFECTIVE state, computed at query
--          time. This is the function to trust, not the `status` column.
--
-- WHY IT EXISTS: nothing runs a cron against this database. No scheduler, no
-- edge function on a timer, nobody watching. So a row written as 'trialing' on
-- day 1 is still literally 'trialing' on day 400 — the column was never wrong,
-- it was just never revisited. Reading `status` alone hands out a free
-- subscription to every account that ever opened a trial.
--
-- So an expired trial is resolved HERE, by comparing trial_ends_at to now(),
-- every single time it is asked.
--
-- WHY 'active' IS **NOT** DEMOTED THE SAME WAY: a lapsed `current_period_end`
-- on an active subscription is ambiguous. It means either "they stopped
-- paying" or "they paid by EVC on Sunday and the admin confirms it on
-- Tuesday". With a manual rail the second is routine, and auto-locking a
-- paying customer out of their own rent records because an admin was slow is a
-- far worse failure than a couple of unbilled days. An admin moves them to
-- 'past_due' or 'expired' deliberately. Do not "fix" this into a timestamp
-- comparison without first building the thing that reliably records payments.
--
-- Returns 'none' when there is no row at all — a subject who has never even
-- started a trial is a distinct case from one whose trial ran out, and the UI
-- says different things to each.
--
-- SECURITY DEFINER + STABLE, granted to `authenticated`, so it can be called
-- from a policy or from another SECURITY DEFINER function without RLS hiding
-- the row from itself. It discloses only a state string, and only to someone
-- who already knows the exact Clerk subject id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_state(
  _subject_type TEXT,
  _subject_id   TEXT,
  _plan         TEXT
)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
               -- An expired trial is 'expired' whatever the column says.
               WHEN s.status = 'trialing'
                 AND s.trial_ends_at IS NOT NULL
                 AND s.trial_ends_at <= now()
                 THEN 'expired'
               ELSE s.status
             END
        FROM public.subscriptions s
       WHERE s.subject_type = _subject_type
         AND s.subject_id   = _subject_id
         AND s.plan         = _plan
       LIMIT 1
    ),
    'none'
  );
$$;

GRANT EXECUTE ON FUNCTION public.subscription_state(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_subscription(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- STEP 6 — public.start_trial(): the ONLY self-serve write in this file.
--
-- The tables are admin-write-only (STEP 7). But a new operator has to be able
-- to begin their own 14 days without waiting for a human, so exactly one
-- narrow, server-controlled door exists — and every field it can write is
-- fixed by this function, not by the caller:
--
--   status         always 'trialing'. Never 'active'.
--   trial_ends_at  always now() + 14 days, computed by Postgres. The caller
--                  does not get to pass a duration, because a caller-supplied
--                  duration is a caller-supplied free subscription.
--   subject        must be the caller (their own user id, or the org id in
--                  their own JWT). You cannot open a trial on someone else's
--                  account, and you cannot open one for an org you left.
--
-- IDEMPOTENT VIA ON CONFLICT DO NOTHING — which is also what makes a used
-- trial unrestartable. Calling this again after the 14 days have run out
-- changes nothing and returns 'expired'. There is no UPDATE here at all, so
-- there is no code path in which this function can extend anything.
--
-- Admins are allowed through the subject check so support can open a trial on
-- an operator's behalf over the phone; they could write the row directly
-- anyway, so this grants nothing new.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_trial(
  _subject_type TEXT,
  _subject_id   TEXT,
  _plan         TEXT
)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _caller TEXT := auth.jwt()->>'sub';
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to start a trial.' USING ERRCODE = '42501';
  END IF;

  -- Validate here as well as in the CHECK constraints: a clear message beats a
  -- constraint violation surfacing in the UI as "23514".
  IF _subject_type IS NULL OR _subject_type NOT IN ('user', 'org') THEN
    RAISE EXCEPTION 'Unknown subject type: %', _subject_type USING ERRCODE = '22023';
  END IF;

  IF _plan IS NULL OR _plan NOT IN ('hotel', 'pms') THEN
    RAISE EXCEPTION 'Unknown plan: %', _plan USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (_subject_type = 'user' AND _subject_id = _caller)
    OR (_subject_type = 'org' AND _subject_id = public.current_org_id())
    OR public.has_role(_caller, 'admin')
  ) THEN
    RAISE EXCEPTION 'You can only start a trial for your own account.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.subscriptions (subject_type, subject_id, plan, status, trial_ends_at)
  VALUES (_subject_type, _subject_id, _plan, 'trialing', now() + INTERVAL '14 days')
  ON CONFLICT (subject_type, subject_id, plan) DO NOTHING;

  RETURN public.subscription_state(_subject_type, _subject_id, _plan);
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_trial(TEXT, TEXT, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- STEP 7 — RLS. THE PART THAT MATTERS.
--
-- subscriptions:
--   SELECT  the subject (own Clerk user id, or org_id = current_org_id()),
--           or a platform admin.
--   INSERT  platform admin ONLY.
--   UPDATE  platform admin ONLY.
--   DELETE  platform admin ONLY.
--
-- subscription_payments: same shape — the subject reads their own receipts,
--   only an admin writes them. A subscriber who could INSERT a payment could
--   manufacture a receipt for money that never arrived.
--
-- THERE IS NO SUBSCRIBER-FACING WRITE POLICY ON EITHER TABLE, AND NONE SHOULD
-- BE ADDED. The trial door is start_trial() above, which is auditable in one
-- screenful. A "users can update their own subscription" policy — however
-- carefully its WITH CHECK is written — puts the status column within reach of
-- the browser, and the status column is what the product charges for.
--
-- Note that with no UPDATE policy at all, an attempt does not raise: RLS
-- filters the row out and Postgres reports "UPDATE 0". See the verify block.
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Subject sees own subscription" ON public.subscriptions
  FOR SELECT
  USING (
    (subject_type = 'user' AND subject_id = auth.jwt()->>'sub')
    OR (subject_type = 'org' AND subject_id = public.current_org_id())
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- Admin-only writes. This is money.
CREATE POLICY "Admins insert subscriptions" ON public.subscriptions
  FOR INSERT
  WITH CHECK (public.has_role(auth.jwt()->>'sub', 'admin'));

CREATE POLICY "Admins update subscriptions" ON public.subscriptions
  FOR UPDATE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'))
  WITH CHECK (public.has_role(auth.jwt()->>'sub', 'admin'));

CREATE POLICY "Admins delete subscriptions" ON public.subscriptions
  FOR DELETE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));

CREATE POLICY "Subject sees own subscription payments" ON public.subscription_payments
  FOR SELECT
  USING (
    public.owns_subscription(subscription_id)
    OR public.has_role(auth.jwt()->>'sub', 'admin')
  );

-- Admin-only writes. A self-written receipt is a forged receipt.
CREATE POLICY "Admins record subscription payments" ON public.subscription_payments
  FOR INSERT
  WITH CHECK (public.has_role(auth.jwt()->>'sub', 'admin'));

CREATE POLICY "Admins update subscription payments" ON public.subscription_payments
  FOR UPDATE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'))
  WITH CHECK (public.has_role(auth.jwt()->>'sub', 'admin'));

CREATE POLICY "Admins delete subscription payments" ON public.subscription_payments
  FOR DELETE
  USING (public.has_role(auth.jwt()->>'sub', 'admin'));


-- =============================================================================
-- Verify with:
--
--   -- 1. The policy inventory. Expect 4 rows per table; the three write verbs
--   --    on each must mention has_role(...,'admin') and NOTHING ELSE. If any
--   --    INSERT/UPDATE/DELETE row mentions auth.jwt()->>'sub' outside of
--   --    has_role(), the subscriber can write their own status — treat as an
--   --    incident.
--   SELECT tablename, policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('subscriptions','subscription_payments')
--    ORDER BY tablename, cmd;
--
--   -- 2. ★ A NON-ADMIN CANNOT UPDATE A SUBSCRIPTION — the whole point.
--   --    Run these as a signed-in NON-ADMIN who OWNS the row (via PostgREST or
--   --    with the Clerk JWT set on the session):
--   SELECT id, status, trial_ends_at FROM public.subscriptions;  -- their row, visible
--
--   UPDATE public.subscriptions SET status = 'active';
--   -- EXPECT: "UPDATE 0".
--   -- Read that carefully — it is NOT an error, and it is NOT success. With no
--   -- UPDATE policy the row is filtered out before the update is considered,
--   -- so zero rows match. Through PostgREST the client sees 0 rows affected.
--
--   SELECT status FROM public.subscriptions;   -- EXPECT: still 'trialing'. ★
--
--   INSERT INTO public.subscriptions (subject_type, subject_id, plan, status)
--   VALUES ('user', '<their clerk id>', 'pms', 'active');
--   -- EXPECT: ERROR 42501 new row violates row-level security policy.
--
--   INSERT INTO public.subscription_payments (subscription_id, amount, method)
--   VALUES ('<their subscription id>', 60.00, 'evc');
--   -- EXPECT: ERROR 42501. A subscriber cannot write their own receipt.
--
--   -- 3. A STRANGER sees nothing. Run as a signed-in user who is neither the
--   --    subject nor an admin:
--   SELECT count(*) FROM public.subscriptions;          -- expect 0
--   SELECT count(*) FROM public.subscription_payments;  -- expect 0
--
--   -- 4. The trial door is narrow. As any signed-in non-admin:
--   SELECT public.start_trial('user', '<their own clerk id>', 'pms');   -- 'trialing'
--   SELECT public.start_trial('user', '<their own clerk id>', 'pms');   -- 'trialing', still ONE row
--   SELECT count(*) FROM public.subscriptions
--    WHERE subject_id = '<their own clerk id>' AND plan = 'pms';        -- expect 1
--   SELECT public.start_trial('user', '<SOMEONE ELSE>', 'pms');
--   -- EXPECT: ERROR 42501 "You can only start a trial for your own account."
--
--   -- 5. An expired trial resolves WITHOUT anything having updated the row.
--   --    As an admin, backdate the trial and confirm the column still lies
--   --    while the function tells the truth:
--   UPDATE public.subscriptions
--      SET trial_ends_at = now() - INTERVAL '1 day'
--    WHERE subject_id = '<clerk id>' AND plan = 'pms';
--   SELECT status FROM public.subscriptions
--    WHERE subject_id = '<clerk id>' AND plan = 'pms';        -- 'trialing'  (stale)
--   SELECT public.subscription_state('user', '<clerk id>', 'pms');  -- 'expired'  ★
--
--   -- 6. No row at all reads as 'none', not NULL:
--   SELECT public.subscription_state('user', 'user_does_not_exist', 'hotel'); -- 'none'
--
--   -- 6b. A 'trialing' row cannot exist without an end date — the free-forever
--   --     combination. As an ADMIN:
--   INSERT INTO public.subscriptions (subject_type, subject_id, plan)
--   VALUES ('user', 'user_test_forever', 'pms');
--   -- EXPECT: ERROR 23514 violates check constraint
--   --         "subscriptions_trialing_needs_end".
--   -- Before that constraint existed this INSERT succeeded and produced an
--   -- account that never expired.
--
--   -- 7. The payment vocabulary took 'sifalo' and rent_ledger did NOT.
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname IN ('subscription_payments_method_check',
--                      'rent_ledger_method_check');
--   -- expect subscription_payments to list sifalo, rent_ledger not to.
--   -- That divergence is intentional — see the `method` note in STEP 3.
-- =============================================================================
