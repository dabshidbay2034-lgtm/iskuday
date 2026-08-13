# Deploying the edge functions

**Status right now: none of the three functions are deployed.** Verified by probing
production — `clerk-webhook` and `increment-view` both return `404`.

That single fact is causing two live bugs and blocking a third feature:

| Function | What breaks while it's undeployed |
|---|---|
| `clerk-webhook` | **Every new signup gets no `profiles` row.** The Clerk migration deliberately dropped the `handle_new_user()` DB trigger and no client code inserts into `profiles`, so nothing creates it. Their name never appears anywhere, `Dashboard.tsx:68`'s `.single()` throws for them, and "save name" silently updates 0 rows. `BOOTSTRAP_ADMIN_IDS` also never fires. |
| `increment-view` | **View counting has never worked.** Every property page throws a CORS error on preflight, because a 404 can't answer `OPTIONS`. `properties.views` is permanently 0. |
| `send-notification` | Booking requests and service inquiries reach nobody. |

Existing accounts predate the migration, which is why this hasn't surfaced yet.

---

## 1. Authenticate the CLI

The CLI in this repo is not logged in and the project is not linked
(`supabase projects list` returns an empty table).

```bash
npx supabase login
```

That opens a browser. In CI, set `SUPABASE_ACCESS_TOKEN` instead — generate it at
Account → Access Tokens.

> **Never commit that token, and never paste it into a chat.** It grants full control
> of every project on the account.

## 2. Link the project

```bash
npx supabase link --project-ref hetaveowlxcjuxbtckqt
```

It will ask for the database password (Project Settings → Database). This writes
`supabase/.temp/project-ref`, which is gitignored.

## 3. Set the function secrets

These are **server-side only**. None may ever get a `VITE_` prefix — that prefix is what
puts a value into the browser bundle for anyone to read.

### Use an env file, not the command line

Two reasons, and the second is the important one:

1. `supabase secrets set A=1 B=2` on one line is fragile the moment a value contains a
   character your shell treats specially. **On Windows the bash-style `\` line
   continuation does not work at all** — PowerShell reads each line as its own command
   and you get `The term 'SUPABASE_SERVICE_ROLE_KEY=...' is not recognized`.
2. **PowerShell records your command history to disk in plain text**
   (`$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`).
   A service-role key pasted on the command line stays in that file. An env file does
   not touch history.

`supabase/.env.production` is already covered by `.gitignore` (`.env.*`) — confirm with
`git check-ignore -v supabase/.env.production` before you put anything real in it.

Create the file with this content, replacing every placeholder:

```ini
CLERK_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
NOTIFY_WEBHOOK_SECRET=<paste the value generated below>
ADMIN_NOTIFY_EMAIL=you@mogadishurents.com
FROM_EMAIL=Mogadishu Rents <noreply@mogadishurents.com>
SITE_URL=https://mogadishurents.com
```

> **Do not add `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, or any other
> `SUPABASE_*` name.** The CLI rejects them —
> `Env name cannot start with SUPABASE_, skipping: …` — because the platform
> **injects them into every edge function automatically at runtime**. Setting
> them is unnecessary and the CLI blocks it so you cannot shadow the real ones
> with a stale copy. Seeing that skip message is the expected outcome, not an
> error.

Do **not** wrap the values in quotes — the file is parsed as `NAME=VALUE`, so quotes
become part of the value.

Generate `NOTIFY_WEBHOOK_SECRET` (PowerShell). This uses the cryptographic RNG, not
`Get-Random`, because it is an authentication secret:

```powershell
$b = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { '{0:x2}' -f $_ }) -join ''
```

Then push them all at once:

```powershell
npx supabase secrets set --env-file supabase/.env.production
```

Optional: add `BOOTSTRAP_ADMIN_IDS=user_2abc,user_2def` — comma-separated Clerk ids that
get the `admin` role on first signup. This is the **only** supported route to your first
platform admin; there is no in-app path (see `supabase/bootstrap_admin.sql`).

Verify what landed (names only — values are never echoed back):

```powershell
npx supabase secrets list
```

> Keep the file after deploying, or delete it — either is fine. If you keep it, it is
> your only local copy of `NOTIFY_WEBHOOK_SECRET`, which must match the
> `app.notify_secret` you set in step 7.

<details>
<summary>macOS / Linux equivalent</summary>

```bash
NOTIFY_WEBHOOK_SECRET=$(openssl rand -hex 32)
npx supabase secrets set --env-file supabase/.env.production
```
</details>

## 4. Deploy

```bash
npx supabase functions deploy clerk-webhook increment-view send-notification
```

Then confirm they answer — a `404` means not deployed; `401`/`400` means deployed and
correctly rejecting an unsigned request:

```powershell
foreach ($f in "clerk-webhook","increment-view","send-notification") {
  $u = "https://hetaveowlxcjuxbtckqt.supabase.co/functions/v1/$f"
  try   { $c = (Invoke-WebRequest -Uri $u -Method POST -Body '{}' -UseBasicParsing).StatusCode }
  catch { $c = $_.Exception.Response.StatusCode.value__ }
  "{0}: {1}" -f $f, $c
}
```

A `404` here means the function is not deployed. `401` or `400` means it **is** deployed
and correctly refusing an unsigned request — that is the result you want.

<details>
<summary>macOS / Linux equivalent</summary>

```bash
for f in clerk-webhook increment-view send-notification; do
  printf "%s: " "$f"
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "https://hetaveowlxcjuxbtckqt.supabase.co/functions/v1/$f" -d '{}'
done
```
</details>

## 5. Point Clerk at the webhook

Clerk Dashboard → Webhooks → Add Endpoint:

- **URL** `https://hetaveowlxcjuxbtckqt.supabase.co/functions/v1/clerk-webhook`
- **Events** `user.created`, `user.updated`, `user.deleted`,
  `organizationMembership.created`, `organizationMembership.updated`,
  `organizationMembership.deleted`
- Copy the signing secret into `CLERK_WEBHOOK_SECRET` (step 3) and redeploy.

**Test it before trusting it:** sign up a throwaway account, then check a row appeared:

```sql
select user_id, full_name, created_at from public.profiles order by created_at desc limit 1;
select user_id, role from public.user_roles order by id desc limit 1;
```

No row means the webhook isn't firing — check Clerk's delivery log for the response code.

## 6. Backfill the users who were missed

Every account created while the webhook was down has no `profiles` row. Find them:

```sql
select ur.user_id
from public.user_roles ur
left join public.profiles p on p.user_id = ur.user_id
where p.user_id is null;
```

There is no way to recover their names from the database — Clerk holds them. Either
re-send `user.created` for each from Clerk's dashboard, or insert placeholder rows and
let them correct their name in Settings:

```sql
insert into public.profiles (user_id, full_name)
select ur.user_id, 'Member'
from public.user_roles ur
left join public.profiles p on p.user_id = ur.user_id
where p.user_id is null;
```

---

## Ordering

Migrations first, then functions — `send-notification` reads tables that
`20260813000001` creates.

```
20260811000001_fix_generate_monthly_payroll_volatility.sql
20260812000001_security_hardening.sql          ← must run AFTER the older migrations;
                                                  they drop-and-recreate policies on the
                                                  same tables and would re-open its fixes
20260812000002_account_type_separation.sql
20260813000001_native_hotel_team.sql
20260814000001_notification_triggers.sql
```

## Known limitation, unrelated to deployment

`increment-view/index.ts` still resolves the caller with `userClient.auth.getUser()` —
Supabase Auth, which this project stopped using at the Clerk migration. It returns null
for a Clerk session, so the owner-self-view exclusion never fires and the 24-hour rate
limit falls back to a client-supplied `X-Forwarded-For` header. Deploying makes view
counting *work*; it does not make it *accurate*. Fixing it means verifying the Clerk JWT
in the function.
