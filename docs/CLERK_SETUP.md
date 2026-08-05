# Clerk + Supabase setup

This app uses **Clerk for authentication** and **Supabase for the database,
storage, and JWT-claim-based RLS**. Agencies are modeled as **Clerk
Organizations**; staff roles are Clerk custom org roles.

This guide is the single source of truth for the dashboard configuration that
the code assumes. If anything here and the code disagree, **fix the dashboard to
match the code** (the migration and webhook are written against these exact
values).

---

## 1. Enable Organizations

1. Clerk Dashboard → **User & Authentication → Organizations**.
2. Enable **Organizations**.
3. Under **Settings**, allow users to **create organizations** (agency owners
   create their own agency via the "Create your agency" empty state in
   `src/components/team/create-agency-empty-state.tsx`).
4. Set the default role to `org:admin` (the creator becomes the admin).

---

## 2. Create custom organization roles

**Organizations → Roles** — create these four roles. The keys must match
`STAFF_ROLES` in `src/lib/permissions.ts` **exactly**:

| Key          | Label   | Use                                                    |
| ------------ | ------- | ------------------------------------------------------ |
| `org:admin`  | Admin   | Full agency control, can invite/remove/manage staff.   |
| `org:manager`| Manager | Edit/manage agency properties + inquiries.             |
| `org:agent`  | Agent   | Edit agency properties they're assigned to.            |
| `org:viewer` | Viewer  | Read-only access to the agency's properties/inquiries. |

> `org:admin` is Clerk's built-in admin and cannot be deleted. The other three
> are custom roles — create them with **Create role → Base permissions: none**;
> we attach *custom* permissions in step 3, not Clerk's base permission sets.

---

## 3. Create the 10 custom permissions and map them

**Organizations → Permissions** — create these 10 permissions (the keys must
match `PERMISSIONS` in `src/lib/permissions.ts`):

```
org:property:create
org:property:edit
org:property:delete
org:property:publish
org:inquiry:view
org:inquiry:respond
org:staff:invite
org:staff:manage
org:analytics:view
org:billing:manage
```

Then assign each permission to the roles that should have it. This **must
mirror `ROLE_PERMISSIONS`** in `src/lib/permissions.ts`:

| Permission              | admin | manager | agent | viewer |
| ----------------------- | :---: | :-----: | :---: | :----: |
| `org:property:create`   |  ✓   |   ✓    |  ✓   |        |
| `org:property:edit`     |  ✓   |   ✓    |  ✓   |        |
| `org:property:delete`   |  ✓   |   ✓    |      |        |
| `org:property:publish`  |  ✓   |        |      |        |
| `org:inquiry:view`      |  ✓   |   ✓    |  ✓   |        |
| `org:inquiry:respond`   |  ✓   |   ✓    |      |        |
| `org:staff:invite`      |  ✓   |   ✓    |      |        |
| `org:staff:manage`      |  ✓   |        |      |        |
| `org:analytics:view`    |  ✓   |   ✓    |  ✓   |   ✓    |
| `org:billing:manage`    |  ✓   |        |      |        |

The UI reads from `ROLE_PERMISSIONS` directly for the permission matrix and the
invite-dialog preview, so the dashboard mapping only needs to be consistent for
Clerk's own checks (and for documentation/audit).

---

## 4. Connect Supabase as a JWT template (third-party auth)

Clerk issues the JWT; Supabase validates it and exposes the claims to RLS via
`auth.jwt()`. Two equivalent options — pick **one**:

### Option A — JWT Template (classic)

1. Clerk Dashboard → **API Keys → JWT Templates → New template → Supabase**.
2. Set the **Signing key** to your Supabase project's **JWT secret**
   (Supabase Dashboard → Project Settings → API → JWT Settings → JWT Secret).
3. Set the template payload so the claims the migration expects are present:

   ```json
   {
     "sub": "{{user.id}}",
     "role": "authenticated",
     "iss": "https://<your-clerk-frontend-api>/.well-known/jwks.json",
     "aud": "authenticated",
     "exp": {{math.int (now.Unix) '+' 60}},
     "iat": {{now.Unix}},
     "email": "{{primary_email_address}}",
     "o": {
       "id": "{{org.id}}",
       "rol": "{{org.role}}",
       "slug": "{{org.slug}}"
     }
   }
   ```

   > **`"role": "authenticated"` is mandatory.** PostgREST reads that claim to
   > decide which Postgres role to run the request as. Without it every request
   > comes back `401 Unauthorized` before RLS is even consulted — the symptom is
   > a blanket 401 on *all* tables, including plain SELECTs that should have
   > succeeded. `aud` is not a substitute for it.

   The migration's RLS policies read:
   - `auth.jwt()->>'sub'` — current Clerk user id
   - `auth.jwt()->'o'->>'id'` — active organization id
   - `auth.jwt()->'o'->>'rol'` — active organization role

### Option B — Native Supabase integration (newer)

1. Clerk Dashboard → **Integrations → Supabase → Connect**.
2. Paste your Supabase **Database connection string** and select the project.
3. Clerk provisions the JWKS on Supabase automatically. Verify the same `o`
   object is present in the issued token — if your integration doesn't emit
   `o.id` / `o.rol`, switch to **Option A** so the migration's policies work.

Either way, confirm the token contains the `o` object by decoding a live JWT at
jwt.io before running the migration.

---

## 5. Configure the webhook

The edge function at `supabase/functions/clerk-webhook/index.ts` mirrors Clerk
state into `public.profiles` and `public.staff_permissions`.

1. **Deploy** the function:
   ```sh
   supabase functions deploy clerk-webhook --no-verify-jwt
   ```
   `--no-verify-jwt` is required — Clerk signs with Svix, not the Supabase JWT.
2. **Set its secrets** (Supabase Dashboard → Edge Functions → clerk-webhook →
   Secrets):
   ```
   CLERK_WEBHOOK_SECRET=<from Clerk, step 4>
   ```
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)
3. In Clerk, **Webhooks → Add endpoint**:
   - **Endpoint URL**: `https://<your-project>.functions.supabase.co/clerk-webhook`
   - **Signing secret**: copy it into `CLERK_WEBHOOK_SECRET` above.
   - **Events** — subscribe to exactly these:
     - `user.created`
     - `user.updated`
     - `user.deleted`
     - `organizationMembership.created`
     - `organizationMembership.updated`
     - `organizationMembership.deleted`

---

## 6. Environment variables

### Client (Vite — prefix `VITE_`, safe to ship to the browser)

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon/publishable key>
```

> Add these to `.env` locally and to Vercel → Project → Settings → Environment
> Variables. **Never** put a service-role or Clerk secret key in client code.

### Server (Edge Functions / Vercel serverless — never exposed to the browser)

For the `clerk-webhook` function (Supabase Dashboard → Edge Functions →
Secrets):

```
CLERK_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role key>
```

---

## 7. Pre-deploy checklist

- [ ] Organizations enabled; users can create orgs.
- [ ] Custom roles `org:manager`, `org:agent`, `org:viewer` created.
- [ ] All 10 custom permissions created and mapped per the table in step 3.
- [ ] Supabase JWT template (or native integration) issuing `sub`, `o.id`,
      `o.rol`.
- [ ] Existing Supabase Auth users imported into Clerk; `public.id_map`
      populated (see `supabase/migrations/20260804000001_migrate_to_clerk_auth.sql`).
- [ ] Database backup taken (the migration is destructive & irreversible).
- [ ] `clerk-webhook` deployed with `CLERK_WEBHOOK_SECRET` set.
- [ ] Clerk webhook endpoint added for the 6 events above.
- [ ] Client env vars (`VITE_CLERK_PUBLISHABLE_KEY`, etc.) set in Vercel.

After the migration runs, verify no policy still references the old auth
helpers:

```sql
SELECT polname
FROM pg_policy
WHERE pg_get_expr(polqual, polrelid) LIKE '%auth.uid()%'
   OR pg_get_expr(polqual, polrelid) LIKE '%auth.role()%';
-- should return 0 rows
```
