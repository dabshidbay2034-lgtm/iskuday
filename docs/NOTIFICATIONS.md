# Email notifications

Until this shipped, **nothing in this app told anybody anything.** A guest
submitted a booking request and the hotel found out whenever it next happened to
open `/manage/hotel`. A visitor asked about a service and the inquiry sat unread
in the admin panel. Three notifications close that gap.

| Event | Who gets the email | Why them |
|---|---|---|
| A guest requests a booking | The hotel (`hotels.contact_email`), else the platform desk | They're the ones who have to call the guest back |
| Someone submits a service inquiry | The platform desk (`ADMIN_NOTIFY_EMAIL`) | Services are admin-managed; there is no per-service owner |
| A hotel admin invites a team member | The invitee (`hotel_invites.email`) | It carries their one-time join link |

## Email here is staff-facing only. Read this before adding more.

**No guest ever receives an email from this system, on purpose.**

This is Mogadishu. The market is mobile-first and WhatsApp-heavy. A guest who
books a room will not open an email to look for a confirmation, and the hotel
will not reply to one either — they will phone the number on the request. That
is why the booking email puts the **guest's phone number** front and centre and
tells the hotel to call.

If you want guest-facing confirmations — and you should — build them on
**WhatsApp**, not here. A `wa.me` deep link or the WhatsApp Business API is what
this audience actually reads. Adding a guest email to this function would produce
a message nobody opens and a support burden nobody asked for.

The one place email carries real weight is the **hotel invite**, because a new
team member may not be in anybody's contacts yet. Even then, most admins will
still copy the link and send it over WhatsApp — the email is a backstop.

---

## Moving parts

```
guest submits booking form
        │
        ▼
create_booking_request()  ──INSERT──▶  public.bookings   (row committed)
                                             │
                                    AFTER INSERT trigger
                                             │
                                    pg_net (async, in-DB)
                                             │
                          POST /functions/v1/send-notification
                          header: x-notify-secret
                          body:   {"type":"booking_requested","booking_id":"…"}
                                             │
                                             ▼
                          edge function verifies the secret,
                          re-reads every fact from Postgres,
                          POSTs to api.resend.com/emails
```

Two files: `supabase/functions/send-notification/index.ts` and
`supabase/migrations/20260814000001_notification_triggers.sql`.

Two design decisions worth knowing before you debug anything:

1. **The trigger sends IDs only.** Not the recipient, not the body. The edge
   function re-reads everything with the service-role key. So somebody who
   learns the shared secret still cannot make it mail arbitrary text to an
   arbitrary address — there is no field for either.
2. **Nothing in this path is allowed to fail the database write.** The trigger
   functions swallow their own errors; the edge function returns `200` for
   every outcome except a bad secret. A notification failure must never roll
   back a booking or an invite. If mail stops arriving, the rows are still
   there.

---

## 1. Resend account and domain verification

You own `mogadishurents.com`, so send from it. Sending from an unverified domain
is the single most common reason "it silently doesn't work".

1. Sign up at **[resend.com](https://resend.com)** (free tier is 3,000
   emails/month, 100/day — far more than this needs).
2. **Domains → Add Domain →** `mogadishurents.com`. Pick the region closest to
   your users.
3. Resend shows you DNS records. Add every one of them at whoever hosts your DNS
   (the registrar, or Cloudflare/Vercel if you moved the nameservers). They look
   like this — **use the exact values Resend shows you**, the selector and the
   public key are unique to your domain:

   | Type | Name / Host | Value | Notes |
   |---|---|---|---|
   | `TXT` | `resend._domainkey` | `p=MIGfMA0GCSq…` (long key) | **DKIM.** Required. This is what proves the mail is yours. |
   | `MX` | `send` | `feedback-smtp.<region>.amazonses.com` (priority `10`) | Bounce/complaint feedback for the sending subdomain. |
   | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` | **SPF** for the sending subdomain. |
   | `TXT` | `_dmarc` | `v=DMARC1; p=none;` | **DMARC.** Optional for Resend, but Gmail and Yahoo require it for bulk senders and it materially improves inbox placement. Start at `p=none`, tighten later. |

   If you use **Cloudflare**, set these records to **DNS only (grey cloud)** —
   proxying breaks them. If your DNS host auto-appends the domain, enter
   `resend._domainkey`, not `resend._domainkey.mogadishurents.com`.

4. Back in Resend, click **Verify**. Propagation is usually minutes, sometimes
   up to a few hours. The status must read **Verified** before anything sends.
5. **API Keys → Create API Key.** Permission **Sending access** is enough — do
   not create a full-access key for this. Copy the `re_…` value; Resend shows it
   once.

> The `FROM_EMAIL` address must be **at the domain you just verified**. Resend
> rejects anything else with a 403, which is exactly what
> `[send-notification] Resend rejected the send: 403 …` in the logs means.

---

## 2. Environment variables

All of these are **edge function secrets**. None may ever get a `VITE_` prefix —
that prefix is what puts a value into the browser bundle for anyone to read.

| Variable | Required? | What it is |
|---|---|---|
| `NOTIFY_WEBHOOK_SECRET` | **Yes** | Shared secret the trigger presents as `x-notify-secret`. Without it the function rejects every request with 401 — it fails closed, because an unauthenticated "send email" URL is worse than no notifications. |
| `SUPABASE_URL` | Yes | Injected by the platform. Nothing to do. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Needed to read `service_inquiries` and `hotel_invites`, which are admin-only under RLS. |
| `RESEND_API_KEY` | No | Absent ⇒ **every send is a silent no-op that returns 200**, mirroring `src/lib/analytics.ts`. Nothing breaks; nothing sends. |
| `FROM_EMAIL` | No, but effectively yes | e.g. `Mogadishu Rents <noreply@mogadishurents.com>`. Unset ⇒ an obviously-broken placeholder that Resend rejects loudly, so a misconfiguration shows up in logs instead of looking like a Resend outage. |
| `ADMIN_NOTIFY_EMAIL` | No, but service inquiries need it | The platform desk. Unset ⇒ service inquiries log and send nothing, and the booking fallback has nowhere to go. |
| `SITE_URL` | No | Defaults to `https://mogadishurents.com`. Base for the `/manage/hotel`, `/admin-panel` and `/join/<token>` links. |

Set them:

```bash
npx supabase secrets set \
  NOTIFY_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  RESEND_API_KEY="re_..." \
  FROM_EMAIL="Mogadishu Rents <noreply@mogadishurents.com>" \
  ADMIN_NOTIFY_EMAIL="you@mogadishurents.com" \
  SITE_URL="https://mogadishurents.com"
```

**Write the generated `NOTIFY_WEBHOOK_SECRET` down before you run that** — you
need the identical string in step 3, and `supabase secrets list` only shows a
digest, never the value. If you lose it, generate a new one and set it in both
places.

Verify what is set (values are hashed in the output; that is expected):

```bash
npx supabase secrets list
```

---

## 3. Database config

The trigger reads the function URL and the secret from **database settings**, not
from the migration file — the migration is in git, and a secret in git is a
published secret.

Run this once in the Supabase SQL editor, as the database owner:

```sql
ALTER DATABASE postgres SET app.notify_url    = 'https://hetaveowlxcjuxbtckqt.supabase.co/functions/v1/send-notification';
ALTER DATABASE postgres SET app.notify_secret = 'the-same-value-you-set-as-NOTIFY_WEBHOOK_SECRET';
```

(`hetaveowlxcjuxbtckqt` is this project's ref — see `docs/DEPLOY_FUNCTIONS.md`.
The database is named `postgres`.)

> **`ALTER DATABASE` only affects NEW connections.** Sessions already open — and
> the connection pooler holds plenty — keep the old value. Nothing fires until
> connections turn over. Force it with **Settings → Database → Restart**, or
> wait it out.

Confirm from a fresh session, without printing the secret:

```sql
SELECT current_setting('app.notify_url', true)                   AS url,
       (current_setting('app.notify_secret', true) IS NOT NULL)  AS secret_set;
```

---

## 4. Run the migration and deploy

Migration first — the function reads tables that `20260813000001` creates, and
the trigger has nothing to call until the function exists.

```bash
npx supabase db push
npx supabase functions deploy send-notification
```

Check it answers. `404` means not deployed; **`401` means deployed and correctly
rejecting an unsigned request** — that is the healthy response here:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://hetaveowlxcjuxbtckqt.supabase.co/functions/v1/send-notification" \
  -H "Content-Type: application/json" -d '{}'
# expect: 401
```

Then confirm the triggers exist (`tgenabled = 'O'` means enabled):

```sql
SELECT c.relname AS table_name, t.tgname, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE t.tgname LIKE 'trg_notify_%';
```

You should see three rows: `bookings`, `service_inquiries`, `hotel_invites`.

---

## 5. Test each notification

Watch the logs while you do this: **Supabase Dashboard → Edge Functions →
send-notification → Logs.**

### Plumbing check (no email sent)

```sql
SELECT public.notify_edge_function('{"type":"noop"}'::jsonb);   -- returns a request id
SELECT id, status_code, left(content, 300) AS body, created
  FROM net._http_response ORDER BY created DESC LIMIT 5;
```

`200` means URL, secret and deployment are all correct — the body will be
`{"ok":true,"ignored":"noop"}`, or `{"ok":true,"skipped":"no_resend_key"}` if you
have not set `RESEND_API_KEY` yet. Do this before blaming Resend for anything.

### Booking request

The realistic test is the real form: open a published hotel page, pick a room,
submit a booking request. Or do it in SQL against a real hotel-type, daily-rate
room:

```sql
SELECT public.create_booking_request(
         '<room-uuid>'::uuid, CURRENT_DATE + 3, CURRENT_DATE + 5,
         2, 0, 'Test Guest', '+252610000000', 'test@example.com', 'ignore me');
```

Expect an email at that room's `hotels.contact_email` with the guest's name,
phone, dates, nights, room title and total, plus a link to `/manage/hotel`.

- No hotel page lists the room, or `contact_email` is empty ⇒ it goes to
  `ADMIN_NOTIFY_EMAIL`, and the log says so.
- **A booking created from the Manage screen sends nothing.** The trigger only
  fires on `status = 'requested'`; a walk-in typed at the front desk does not
  need an email telling the person who typed it what they just did.

### Service inquiry

Submit the form on any service page (or `/property/<id>` → service inquiry
dialog). Expect an email at `ADMIN_NOTIFY_EMAIL` with the service title, the
sender's name, email, phone and their message, and a link to `/admin-panel`.

### Hotel invite

Invite someone from the hotel team screen. Expect an email at that address with
the hotel name, the role in plain words, and an **Accept the invitation** button
pointing at `/join/<token>`.

**Check the security properties while you are there:**

- the token appears **only** inside the link — never in the subject line, never
  in the edge function logs, never in a Postgres `WARNING`;
- the body says the link is single-use and gives the expiry date;
- opening the link twice fails the second time (`accept_hotel_invite_by_token`
  raises `P0001`) — and the function refuses to email an already-accepted
  invite at all.

Anyone holding that link can redeem it. That is inherent to invite links and is
bounded by `expires_at`, single use, and revocation — see STEP 13 of
`20260813000001_native_hotel_team.sql`.

---

## Troubleshooting

Start here every time:

```sql
-- What pg_net actually got back, newest first.
SELECT id, status_code, content_type, left(content, 500) AS body, created
  FROM net._http_response ORDER BY created DESC LIMIT 10;
```

> If that errors with `relation "net._http_response" does not exist`, pg_net was
> installed into a different schema. Find it:
> ```sql
> SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
>  WHERE c.relname = '_http_response';
> ```
> and read `<that schema>._http_response` instead. pg_net prunes this table
> (roughly every 6 hours), so test and look promptly.

### `status_code` 401 — the secret does not match

The most common failure, and it looks like total silence: rows appear in
`_http_response` with `401` and body `{"error":"Unauthorized."}`, and the edge
logs say `rejected a request with a bad or missing x-notify-secret`.

`app.notify_secret` and the `NOTIFY_WEBHOOK_SECRET` edge secret are not the same
string. Neither can be read back, so do not try to compare them — **set both
again from one freshly generated value**:

```bash
NEW=$(openssl rand -hex 32); echo "$NEW"
npx supabase secrets set NOTIFY_WEBHOOK_SECRET="$NEW"
```
```sql
ALTER DATABASE postgres SET app.notify_secret = 'paste the same value';
```

Then restart the database (new connections only — see step 3) and re-test.

A body of `{"error":"Not configured."}` instead means `NOTIFY_WEBHOOK_SECRET` is
unset on the function side. It fails closed on purpose.

### Nothing in `_http_response` at all — the request never left

`app.notify_url` is unset in the sessions doing the writing. Check the Postgres
logs (Dashboard → Logs → Postgres) for:

```
WARNING: notify_edge_function: app.notify_url is not set - notification skipped.
```

Set it (step 3) and remember the new-connections caveat. If you set it and the
warning persists, your connections have not turned over — restart the database.

### `status_code` 404 — the function is not deployed

`npx supabase functions deploy send-notification`. As of writing, **none of the
edge functions in this repo were deployed** (`docs/DEPLOY_FUNCTIONS.md`), so
this is the expected first result.

### `pg_net is not available` when running the migration

The migration refuses to install triggers that cannot call anything. Enable the
extension — Dashboard → **Database → Extensions** → search `pg_net` → toggle on
— then re-run the migration. On self-hosted Postgres, install the `pg_net`
package first.

To confirm it is present:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_net';
```

### `status_code` 200 but no email arrives

`200` only means the edge function acknowledged the request — by design it
returns 200 for almost everything. The reason is in the **edge function logs**:

| Log line | Meaning |
|---|---|
| `RESEND_API_KEY is not set — email is disabled` | Expected when you have not set the key. Nothing was sent, nothing broke. |
| `FROM_EMAIL is not set — using the placeholder …` | Set `FROM_EMAIL`. Resend will reject the placeholder. |
| `Resend rejected the send: 403 …` | Usually **the domain is not verified**, or `FROM_EMAIL` is not at the verified domain. Go back to step 1; the Resend dashboard's Domains page must read **Verified**. |
| `Resend rejected the send: 422 …` | Malformed `from` — it must be `Name <address@domain>` or a bare address. |
| `Resend rejected the send: 429 …` | Rate limited (free tier: 100/day). |
| `no recipient could be resolved` | The room is on no hotel page, that page has no `contact_email`, **and** `ADMIN_NOTIFY_EMAIL` is unset. Fill in the hotel's contact email. |
| `ADMIN_NOTIFY_EMAIL is not set` | Service inquiries have nowhere to go. Set it. |
| `booking … not found` | The transaction rolled back after the trigger fired. pg_net is asynchronous and does not participate in the transaction, so this is possible and harmless. |

If the logs are clean and Resend's own **Emails** dashboard shows the message as
`delivered`, the problem is downstream: check spam, and check that the recipient
domain is not silently filtering an unverified sender (which is what SPF, DKIM
and DMARC in step 1 are for).

### The domain isn't verified — what it looks like

`_http_response` shows `200`, Resend's dashboard shows nothing at all, and the
edge logs show `Resend rejected the send: 403 {"statusCode":403,"message":"The
mogadishurents.com domain is not verified…"}`. There is no partial mode: an
unverified domain sends zero mail. The only exception is Resend's own
`onboarding@resend.dev` sender, which can only deliver to the email address that
owns the Resend account — usable for a smoke test, useless in production.

---

## Known gaps

- **The booking "fall back to the property owner" path cannot reach the owner.**
  No table in this database stores a user's email address: `profiles` has no
  email column (that is why hotel invites are addressed to an email *string* —
  see `20260813000001` STEP 7) and `profile_contacts` holds phone numbers only.
  Emails live in Clerk. So when a room has no hotel page or the page has no
  `contact_email`, the notification goes to `ADMIN_NOTIFY_EMAIL` — a human who
  can phone the owner — and the log names the owner's Clerk id. Fixing this
  properly means mirroring the Clerk email into `profiles` from
  `clerk-webhook`, or asking owners for a notification address directly.
- **Hotel staff invited via `hotel_staff` (payroll) are not notified.** Only
  `hotel_invites` fires.
- **No digest, no retry, no delivery record.** One insert, one attempt, one log
  line. If it matters that a specific message arrived, check Resend's dashboard.
- **Nothing notifies the guest.** Deliberate — see the top of this file.
