# Deploy checklist

Written 21 Aug 2026. Everything here is a thing **only an account holder can
do** — none of it can be fixed by changing code, which is why it is a list and
not a commit.

Do them in this order. Step 1 is the one that takes the site down if skipped.

---

## 1. BLOCKER — set the primary domain to the apex, before deploying

**Symptom if you skip this: the entire site returns `ERR_TOO_MANY_REDIRECTS`.**

Two redirects currently point at each other:

| Where | Rule | Live today? |
|---|---|---|
| Vercel dashboard → Domains | `mogadishurents.com` → `www.mogadishurents.com` | **yes** |
| `vercel.json` → `redirects` | `www.mogadishurents.com` → `mogadishurents.com` | **no — not deployed yet** |

The live build is from **12 Aug 06:19 UTC**. The commit that added the
`vercel.json` rule (`1b796ad`) landed at **12 Aug 19:00 UTC**, thirteen hours
later. That gap is the only reason the site is up: the two rules have never
been active at the same time. The next deploy makes them both active.

Verify the current state yourself:

```bash
curl -s -o /dev/null -w "apex -> %{http_code} %{redirect_url}\n" https://mogadishurents.com/
```

**The fix — in the Vercel dashboard, not in code:** open Project → Settings →
Domains and make `mogadishurents.com` the **Primary Domain**, so `www`
redirects to the apex instead of the other way round.

### Why the apex is the correct direction

Not a preference — the whole codebase already committed to it:

- `src/lib/seo.ts` → `SITE_URL = "https://mogadishurents.com"`
- `src/lib/structured-data.ts` → `siteUrl`, and every JSON-LD `@id`
- `scripts/generate-sitemap.mjs` → every URL in `sitemap.xml`
- `index.html` → `<link rel="canonical">`, `og:url`, `twitter:image`
- `public/robots.txt` → the `Sitemap:` line

**This is already costing you.** Every canonical tag says apex, and every
visitor is redirected away from it to `www`. Google is being told "the real
page is at the apex" while the apex bounces to somewhere else. Fixing the
primary domain fixes the redirect loop *and* the canonical conflict together.

---

## 2. Apply the pending migrations

Six are written and unapplied. They are ordered and each states its own
preconditions, so a single push applies them in sequence:

```bash
npx supabase db push
```

| Migration | What it does |
|---|---|
| `20260906000001_hotel_theme` | per-hotel fonts, corners, colour scheme |
| `20260907000001_hotel_page_home_repair` | gives a home page to hotels created after the multipage migration — without it their public page shows the generic template |
| `20260908000001_role_and_trial_integrity` | account type is a one-time choice; one free trial per account ever; `is_verified` no longer self-settable |
| `20260909000001_last_admin_guard` | the last platform admin cannot be demoted or deleted |
| `20260910000001_attendance_time_order` | a shift may not end before it starts |
| `20260910000002_hotel_manager_gets_pms` | a hotel account may list ordinary property — it pays for the PMS |

Three of them **print a report** as they run. Read the output:

- `20260908000001` lists every account holding `admin` / `semi_admin`
- `20260909000001` warns if only **one** admin exists
- `20260910000001` lists any attendance row that ends before it starts

Re-runnable at any time: `scripts/audit-roles.sql`.

---

## 3. Create a second platform admin

`20260909000001` stops you removing the *last* admin, but it cannot help if you
lose the password to the only one. There is no way back in through the product:
`user_roles` has no admin INSERT policy, `set_my_role()` refuses `admin` by
design, and `BOOTSTRAP_ADMIN_IDS` only fires on a Clerk `user.created` event, so
it cannot readmit an existing account. The only route is the SQL editor.

---

## 4. Online payment is not switched on

`supabase/functions/sifalo-payment` has never been deployed — it currently
returns 404.

```bash
npx supabase functions deploy sifalo-payment
```

Then set the credentials **as Edge Function secrets**:

```bash
npx supabase secrets set SIFALO_API_USER=... SIFALO_API_KEY=... SIFALO_CALLBACK_SECRET=...
```

> **Never put these in `.env` or any `VITE_`-prefixed variable.** Everything
> prefixed `VITE_` is compiled into the JavaScript bundle and served to every
> visitor. Your merchant key would be readable with View Source.

Until this is done the booking form degrades honestly — "pay at the hotel" keeps
working and the UI says online payment is unavailable rather than blaming the
guest's connection.

---

## 5. Team invitations need one Clerk claim

Invites match `hotel_invites.email` against the `email` claim on the Clerk JWT.
That claim is documented for JWT-template **Option A** and is *not* confirmed
for Option B. If it is missing, `accept_hotel_invites()` returns 0 for everyone,
forever — the invite sends, the email arrives, and the invitee is told there is
nothing waiting for them.

In the Clerk dashboard → JWT Templates → the Supabase template, add:

```json
{ "email": "{{user.primary_email_address}}" }
```

Since 21 Aug the team screen detects this and shows a warning to anyone who can
manage members, so you will see it in the app if it is still wrong. To check
directly, run this in the Supabase SQL editor **while signed in as a user**:

```sql
SELECT public.jwt_email();
```

`NULL` means the claim is missing.

---

## 6. Confirm the deploy actually shipped

The repo is **35 commits ahead** of what is live. After deploying:

```bash
curl -sI https://mogadishurents.com/ | grep -i last-modified
```

If that date is still 12 August, the deploy did not run — check that the Vercel
project is connected to `github.com/dabshidbay2034-lgtm/iskuday` and that
auto-deploy on `main` is enabled.

A second check, because a stale build is easy to miss: the live `sitemap.xml`
currently has **4** URLs. A current build produces **39**.

```bash
curl -sL https://mogadishurents.com/sitemap.xml | grep -c "<url>"
```

(`-L` matters until step 1 is done — without it the apex→www redirect is
counted instead of the file, and you get `0` rather than the real number.)

---

## Verified before this list was written

- production build exits 0 — 102 pre-rendered pages, 39 sitemap URLs
- 185 tests pass, `tsc` clean, `eslint` 0 errors
- the public homepage renders in full with **both** Clerk and Supabase
  unreachable, so an auth outage cannot take down the listings or the SEO pages
