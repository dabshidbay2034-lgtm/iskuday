# Handover — overnight session

Everything below is **written and typechecking, committed to nothing**. It is all in the
working tree for you to review.

The single most important thing on this page: **nothing I wrote can run until you apply
the migrations and deploy the functions.** I have no Supabase credentials and did not ask
for any. Section 1 is the whole critical path.

---

## 0. The outage is RESOLVED — but read this before re-running that migration

**Status: fixed.** I re-probed at the end of the session and `properties` returns `200`.
You ran the GRANT. Nothing to do here now.

Recording it because **it will come back if `20260812000001` is ever re-run**, and because
the reasoning inside that file is still wrong:

```sql
-- the fix, if it recurs
GRANT EXECUTE ON FUNCTION public.has_role(TEXT, public.app_role) TO anon, authenticated;
```

Cause: STEP 6 of `20260812000001_security_hardening.sql` revoked EXECUTE on `has_role`.
The reasoning in that file is wrong — Postgres **does** check EXECUTE privilege on a
function called from an RLS policy, as the querying role. That migration's own agent
flagged STEP 6 as the one fix it could not verify locally and shipped a rollback GRANT
for exactly this. Run the line above before anything else.

The original concern was legitimate — `has_role(user_id, role)` takes the user id as a
parameter, so anyone can probe whether a given Clerk id is an admin, and those ids ship
publicly with every listing. The correct fix is a caller-only wrapper, not a revoke:

```sql
CREATE OR REPLACE FUNCTION public.i_have_role(_role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.has_role(auth.jwt()->>'sub', _role) $$;
```
Migrate policies onto it, and only then revoke the parameterised form — after checking
`pg_policies` that nothing still calls it.

---

## 1. Critical path — do these in order

### 1a. Apply migrations (Supabase SQL editor, in this order)

```
20260811000001_fix_generate_monthly_payroll_volatility.sql   payroll RPC could never insert
20260812000001_security_hardening.sql                        6 privilege-escalation fixes
20260812000002_account_type_separation.sql                   agency ≠ hotel, enforced on INSERT
20260813000001_native_hotel_team.sql                         team roles + token invites
20260814000001_notification_triggers.sql                     pg_net → send-notification
20260815000001_staff_documents.sql                           staff document vault
```

`20260812000001` **must** run after the older migrations. They drop-and-recreate policies
on the same tables, so running one of them afterwards silently re-opens its fixes.

Then immediately re-run the GRANT from §0 — `20260812000001` is what removes it.

### 1b. Deploy the functions

Full runbook: `docs/DEPLOY_FUNCTIONS.md`. Short version:

```powershell
npx supabase login
npx supabase link --project-ref hetaveowlxcjuxbtckqt
npx supabase secrets set --env-file supabase/.env.production
npx supabase functions deploy clerk-webhook increment-view send-notification
```

Do **not** put `SUPABASE_*` names in that env file — the platform injects them and the
CLI rejects them. That warning you saw is expected.

### 1c. The bug that gets worse every day it waits

`clerk-webhook` has never been deployed, and the Clerk migration deliberately dropped the
`handle_new_user()` DB trigger. **No client code inserts into `profiles`.** So every
account created since that migration has no profile row — their name appears nowhere,
`Dashboard.tsx:68`'s `.single()` throws for them, and "save name" silently updates zero
rows. Find them:

```sql
select ur.user_id from public.user_roles ur
left join public.profiles p on p.user_id = ur.user_id
where p.user_id is null;
```

Their names live only in Clerk. Recovery options are in `DEPLOY_FUNCTIONS.md` §6.

---

## 2. Teams — invite by email, they accept, they're in

Built and wired. Roles are **yours, not Clerk's** — `hotel_members` is a plain table.

| Role | Can do |
|---|---|
| `admin` | Everything for that hotel, including the team |
| `agent` | Edit and publish pages, run the desk — never membership |
| `viewer` | Read only |

Per-hotel. A member on Hotel A has zero reach into Hotel B, any agency, or the platform
admin panel.

**How an invite actually travels.** Authorization is a **token**, not the email address.
I verified against a live session that your Clerk JWT contains no `email` claim at all —
only `sub`, `o`, `role`, `sid` and friends — so the database can never match an invite to
a signed-in user by address. The address is a label; the link is the credential.

So the flow is: admin enters email + role → row in `hotel_invites` with a secret token →
they open `/join/<token>` while signed in → `accept_hotel_invite_by_token()` trades it
for a membership row → redirected to the hotel.

**I added a "copy invite link" button** to the pending-invite list. Without it there was
no way to deliver an invitation at all unless Resend was already deployed — the token
was never exposed to the UI. Copying the link works the moment the migration is applied,
and this market shares over WhatsApp anyway. Email delivery is a bonus once `1b` is done.

Known rough edge: the member list shows raw Clerk ids (`user_2abc…`) rather than names,
because `profiles` rows do not exist for anyone who signed up while the webhook was down.
Fixing §1c fixes this too.

---

## 3. Staff, payroll, documents

**Payroll had three independent bugs, all verified, all fixed:**
1. A `STABLE` function doing `INSERT` — Postgres raises `0A000`, so "Generate month"
   could never work. It *looked* fine only when every staff member already had a row,
   because the loop body never ran.
2. Every query embedded `staff(...)`. There is no `public.staff` table — only
   `hotel_staff`. PostgREST returned `PGRST200`, the error was swallowed, and a month
   with 12 salary rows rendered as "Nothing here yet". Fixed to `staff:hotel_staff(...)`
   and **verified live against your database** — the old form still 400s, the new one 200s.
3. `payrollKey()` returned `["hotel-staff","payroll",undefined]`, a 3-element key that
   prefix-matches nothing, so **every payroll mutation invalidated nothing**. "Mark paid"
   toasted success and the row stayed Pending.

**Payroll totals were also wrong, and are now fixed.** `staff_payroll.amount` is
`CHECK (amount >= 0)`, so the sign lives only in `pay_type` — and the page summed every
row regardless. A salary of $400 with a $100 advance and a $20 penalty displayed a
"Payroll total" of **$520**, when the real wage bill is $400 and the amount still to hand
over is $280. Now: salary and bonus positive, penalty negative, advance excluded from the
total and surfaced separately as "Already advanced", with `stillOwed = pending − advanced`.
All totals round to cents (`roundCents`) — these are JS doubles accumulating values
Postgres stored as `NUMERIC(12,2)`, so drift was reachable.

**Verified at the end of session:** `/manage/payroll` renders, the "Already advanced" tile
is present, and the empty state it shows is *genuine* — `hotel_staff` and `staff_payroll`
both return `200 []`. No staff are registered yet, so register one to exercise the rest.
"Generate month" still needs `20260811000001` applied before it can work at all.

**Document vault** — `staff_documents` plus a **private** `staff-documents` bucket,
modelled on the `lease_documents` pattern that already works for properties (that is the
"apartments are like that" you meant — same shape). CV, passport, national ID, contract,
certificate, photo. Downloads are 1-hour signed URLs; a passport scan is never publicly
readable. Expiring documents are flagged.

---

## 3b. Billing — $99.99 hotel / $60 PMS, 14-day trial

Built and typechecking. **Not yet enforcing anything** — see the mount note below.

`subscriptions` + `subscription_payments`, with `method` covering
`cash | evc | zaad | sifalo | bank | other`. Sifalo Pay is new to this codebase;
`rent_ledger.method` deliberately does **not** match, and there is a comment saying so, so
nobody "helpfully" unifies two applied CHECK constraints.

**The security property:** subscribers can only SELECT. Every write is platform-admin
only, so nobody can set their own status to `active`. Starting a trial goes through
`start_trial()` — SECURITY DEFINER, duration hard-coded in SQL, `ON CONFLICT DO NOTHING`,
so a used trial can never be restarted and the client can never name its own length.

Three judgement calls worth your sign-off:

1. **An `active` subscription is not auto-demoted when `current_period_end` passes.** With
   a manual rail, "paid by EVC on Sunday, admin confirms Tuesday" is routine, and
   auto-locking a paying customer because an admin was slow is worse than a few unbilled
   days. An admin sets `past_due` deliberately. Revenue leaks if nobody watches the list —
   reverse it if you would rather over-lock than under-charge.
2. **Trial does not start on mount.** `'none'` shows a "Start 14-day free trial" button
   instead. A side effect on render means one misplaced gate burns the trial clock for
   everyone who loads that route.
3. **The paywall is NOT mounted yet.** Deliberate. Recommended: `/manage/hotel`,
   `/manage/hotels`, `/manage/staff`, `/manage/payroll` (hotel plan) and
   `/manage/property/:id` (pms plan — where the value is). **Do not gate `/manage`
   itself**: invited hotel-team members who own nothing and pay nothing land there, and
   gating it locks out people who were never the customer. Never gate `/hotels/:slug` or a
   tenant subdomain — those are your customers' public pages, shown to *their* guests.

**Admin panel — built.** `/admin-panel` → **Billing** tab. Lists every subscription
sorted by who needs action, records an EVC/Zaad/Sifalo payment and activates in one step,
extends from `max(today, current_period_end)` so consecutive payments add rather than
overwrite, and guards double-submit with a ref set synchronously (a `busy` state flag
resets too late — two taps land in the same React batch).

**Gates are now mounted**, at the route level in `App.tsx`:

| Route | Plan |
|---|---|
| `/manage/property/:id` | `pms` |
| `/manage/hotel`, `/manage/hotels`, `/manage/hotels/:id` | `hotel` |
| `/manage/staff`, `/manage/payroll` | `hotel` |

`/manage` itself is deliberately **ungated** — invited hotel-team members who own nothing
and pay nothing land there, and `Manage.tsx` routes them through it to their hotel.
Gating it locks out people who were never the customer. Public `/hotels/:slug` pages and
tenant subdomains are never gated; those are your customers' shop windows.

Two fixes I made while mounting:

1. **`BillingGate` now renders its own `Header`/`BottomNav` in the locked state.** It
   replaces the page, and every gated page renders its own header — so without this a
   locked operator lost the nav entirely: no route to `/billing`, no org switcher, no
   sign-out. They'd have been stuck with the browser back button.
2. **A failed entitlement query no longer locks anyone.** `useEntitlement` did not
   consider `isError`, so any failure — dropped connection, RLS change, or this migration
   simply not being applied — resolved to `none` and hard-locked **every paying customer
   at once**. It now treats an error as "not known yet" and renders the page. Failing open
   is correct here: this gate is a commercial control, not a security boundary, and every
   table behind it is independently protected by RLS that never consults subscription
   status. Cost of failing open is minutes of unbilled access; cost of failing closed was
   locking out the entire paying base on a blip.

## 4. SEO — the biggest single fix in this session

Your `index.html` shipped `<link rel="canonical" href="https://mogadishurents.com/">` on
**every one of 29 routes**. In Google's own language that says *"this page is a duplicate
of the homepage — don't index it"*, on all 15 listings and every hotel page. That is now
per-page and correct, verified live.

Also: real per-page titles and descriptions, JSON-LD structured data
(`RealEstateListing` + `Offer` for listings, `Hotel` for hotel pages, breadcrumbs), a
sitemap that went from **4 URLs to 21** (every listing and hotel page, zero private
routes), and a `robots.txt` that no longer blocks two paths that never existed while
leaving your real admin routes open.

**The thing worth knowing:** WhatsApp, Facebook and X run no JavaScript. They read the
raw HTML and stop. So a property shared on WhatsApp still unfurls as the generic
homepage. Google renders JS and will see the new tags; unfurlers never will. The fix is
prerendering the public routes at build time — that also removes the "Google crawls JS
slower" caveat. Given your entire contact flow is `wa.me` links, I think this is worth
more than any further ranking work, and it is the first thing I would do next.

Not done, and deliberately: the 18 district landing pages (`kiro Hodan`,
`guri kiro Wadajir` …). That is the real ranking play — ~70 targeted pages instead of 5
competing ones — but it belongs after prerendering, not before.

Ranking is not only code. Backlinks, a Google Business Profile (free, 20 minutes, and for
local searches often more visible than organic), and time all matter more than anything
further I can do in the repo.

---

## 5. Subdomains

`hotelname.mogadishurents.com` is wired end to end in code and typechecks. It needs:

1. `*.mogadishurents.com CNAME cname.vercel-dns.com`
2. The wildcard added in Vercel → Domains
3. `hotels.subdomain` set per hotel (already backfilled from slug)

Test with no DNS at all: `http://localhost:8080/?__tenant=<slug>`.

**On SEO: subdomains are worse, not better.** Google treats a subdomain as a largely
separate site, so each one starts near zero authority and splits what you have instead of
compounding it. Medium migrated *off* `username.medium.com` for exactly this reason. Use
them for branding, and set the canonical back to the apex so ranking signals consolidate:

```html
<link rel="canonical" href="https://mogadishurents.com/hotels/jazeera" />
```

Auth deliberately stays on the apex — Clerk sessions are domain-scoped, so a satellite
setup that goes wrong silently signs people out.

---

## 6. Still open

- **`properties.org_id` is writable by owners** — the policy has `USING` with no
  `WITH CHECK`, so an owner can PATCH their listing into any agency's dashboard. Real, and
  I left it because fixing it may break a legitimate "attach my property to my agency"
  flow. Your call.
- **`increment-view` uses Supabase Auth** (`auth.getUser()`) after the Clerk migration, so
  it always sees an anonymous caller. Deploying makes view counting *work*, not
  *accurate*: the owner-self-view exclusion never fires and the 24h rate limit falls back
  to a client-supplied `X-Forwarded-For` anyone can rotate.
- **~1,100 lines of dead code** — `TenantCard`, `TenantDialog`, `PrivateNotesCard` are
  fully built and mounted nowhere, so the app has no tenant records and no lease-expiry
  warnings at all.
- **`row`/`column` page-builder blocks** are offered in the insert menu and render
  nothing — the tree renderer was never finished.
- Full ranked list of 30 findings: `docs/AUDIT.md`.
