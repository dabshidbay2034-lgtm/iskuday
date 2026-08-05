# Plan — Property Management System & Services

Status: **proposal, nothing built yet**. Supersedes nothing; extends the Clerk
org/staff work in `docs/CLERK_SETUP.md`.

---

## 1. What we're building

**Property owners, real-estate agents and hotels** register free accounts, list
their units, and manage them month to month. Each owner/agency is a Clerk
Organization and can invite staff with scoped permissions.

Confirmed requirements:

| # | Requirement |
|---|---|
| R1 | Free self-serve accounts for owners / agents / hotels |
| R2 | Register a unit with bedrooms, living rooms, kitchens, toilets, monthly fee, deposit |
| R3 | Mark a unit **occupied** or **free to rent**; only free units appear in the public rental cards |
| R4 | **Phone numbers are never public** — only platform admins can see them |
| R5 | **Private notes** per property, visible only to that owner/agency |
| R6 | Owners/agents/hotels add staff to their profile |
| R7 | Staff do privileged work: edit listings, mark the monthly fee paid, record electricity & water bills |
| R8 | Admin-managed **Services** catalog with a public page and an inquiry form |

---

## 2. Recommendations (read this section first)

These are my calls on the parts that were open. Each one is a decision you can
overturn, but I'd argue for them.

### R-1. Enforce phone privacy in the database, not the UI — this is currently broken

Today `profiles` carries `phone`, and the live policy is:

```sql
CREATE POLICY "Profiles viewable by everyone" ON public.profiles
  FOR SELECT USING (true);
```

**Every phone number in your database is readable by anyone with the anon key.**
Hiding the field in React changes nothing — the row still ships to the browser.
This is a live data-exposure bug independent of anything new we build.

Postgres RLS is row-level, not column-level, so "hide one column" has no clean
policy. **Move contact details into their own table:**

```
profile_contacts (user_id PK, phone, whatsapp, alt_phone, updated_at)
  RLS: SELECT allowed only if user_id = current user  OR  caller is platform admin
```

`profiles` keeps only public-safe fields (name, avatar, org). Then no policy
mistake can leak a number, because the number isn't in the public table at all.

Renters reach an owner through the existing `inquiries` table — they never see a
number, which is exactly the behaviour you asked for.

### R-2. Same treatment for private notes

`property_private (property_id PK, private_notes, internal_ref, updated_at)`,
RLS scoped to the owning org. Keeping notes as a column on `properties` means
one careless `select('*')` leaks them into the public property feed. A separate
table makes that structurally impossible.

### R-3. Split "occupied" from "listed" — they are not the same flag

`is_available` today does double duty. Three real states exist:

| occupancy_status | is_listed | Meaning |
|---|---|---|
| `vacant` | true | Advertised, appears in rental cards |
| `vacant` | false | Empty but not advertised (renovation, held) |
| `occupied` | false | Tenanted, still tracked for rent & bills |

One boolean cannot express that, and you need the third row for the PMS to work
— an occupied unit must stay in the ledger while vanishing from the marketplace.

### R-4. A rent ledger needs rows per month, not a `paid` boolean

"Mark the monthly fee paid" only means something against a period. One row per
property per month (`period_month` = first of month), created by a scheduled job
or lazily on first view. This gives arrears history, "who marked it paid", and
month-over-month revenue for free. A boolean gives you none of that and can't
answer "was March paid?".

### R-5. Add a light tenant record

You didn't ask for tenants, but "occupied" and "rent paid" both imply *someone*.
Without it you can't answer "who owes March?". I'd keep v1 minimal — name,
phone (in the private contacts table), lease start/end, deposit held — and skip
full lease-document management until it's asked for.

### R-6. Separate financial permissions from listing permissions

Editing a listing and marking money received are different levels of trust. A
junior agent should be able to fix a typo in a description without being able to
mark 12 months of rent as collected. My proposed split is in §5.

### R-7. Create profiles from the Clerk webhook, not the browser

You said registration must work without errors. The current flow has
`CompleteProfile.tsx` insert the profile row from the client, which is fragile:
it depends on RLS being exactly right, it races the Clerk session, and it fails
silently for anyone who closes the tab. The `clerk-webhook` edge function
already exists and runs with the service-role key (bypassing RLS entirely).
**Make the webhook authoritative for creating `profiles` + default
`user_roles`**, and reduce `CompleteProfile` to updating phone and chosen role.
That removes a whole class of "couldn't register" bugs.

### R-8. Utility bills: one row per property per month per utility

Not two columns on a monthly record. You will want a third utility (rubbish,
generator, security) within a year, and a table costs nothing now.

---

## 3. Data model

### New tables

```
profile_contacts
  user_id TEXT PK          -- Clerk id
  phone, whatsapp, alt_phone TEXT
  updated_at TIMESTAMPTZ

property_private
  property_id UUID PK -> properties(id) ON DELETE CASCADE
  org_id TEXT
  private_notes TEXT
  internal_ref TEXT
  updated_at TIMESTAMPTZ

tenants
  id UUID PK
  org_id TEXT NOT NULL
  property_id UUID -> properties(id)
  full_name TEXT NOT NULL
  contact_phone TEXT          -- org-scoped, not public
  lease_start DATE, lease_end DATE
  deposit_held NUMERIC
  is_active BOOLEAN
  created_at

rent_ledger
  id UUID PK
  property_id UUID -> properties(id) ON DELETE CASCADE
  org_id TEXT NOT NULL
  tenant_id UUID -> tenants(id) NULL
  period_month DATE NOT NULL          -- always day 1
  amount_due NUMERIC NOT NULL
  amount_paid NUMERIC NOT NULL DEFAULT 0
  status TEXT  -- 'unpaid' | 'partial' | 'paid'
  paid_at TIMESTAMPTZ
  marked_by TEXT                       -- Clerk id of staff
  method TEXT  -- 'cash' | 'evc' | 'zaad' | 'bank' | 'other'
  note TEXT
  UNIQUE (property_id, period_month)

utility_bills
  id UUID PK
  property_id UUID -> properties(id) ON DELETE CASCADE
  org_id TEXT NOT NULL
  period_month DATE NOT NULL
  utility_type TEXT  -- 'electricity' | 'water' | 'other'
  amount NUMERIC NOT NULL
  meter_reading NUMERIC NULL
  status TEXT  -- 'unpaid' | 'paid'
  recorded_by TEXT
  note TEXT
  UNIQUE (property_id, period_month, utility_type)

services                      -- admin-managed catalog (R8)
  id UUID PK
  title, slug, description TEXT
  icon TEXT, image_url TEXT
  price_from NUMERIC NULL, price_note TEXT
  sort_order INT, is_published BOOLEAN
  created_by TEXT, created_at, updated_at

service_inquiries
  id UUID PK
  service_id UUID -> services(id)
  property_id UUID NULL -> properties(id)
  sender_name, sender_email, sender_phone, message
  status TEXT -- 'new' | 'contacted' | 'closed'
  created_at
```

### Changes to `properties`

```
+ occupancy_status TEXT NOT NULL DEFAULT 'vacant'   -- 'vacant' | 'occupied'
+ is_listed BOOLEAN NOT NULL DEFAULT true
```

**No `monthly_fee` column.** Decision D1 settles this: the platform collects
nothing, and the "monthly fee" is simply the rent the owner records. That is the
existing `properties.price`. Do not add a second money column — two fields both
meaning "the rent" will drift apart.

**`org_id` is nullable on every PMS table, and RLS carries an owner fallback.**
An individual landlord who never creates a Clerk organization is a first-class
user, so `tenants`, `rent_ledger`, `utility_bills` and `property_private` all
resolve access as:

```sql
(org_id IS NOT NULL AND org_id = public.current_org_id())
OR EXISTS (SELECT 1 FROM public.properties p
           WHERE p.id = property_id AND p.owner_id = auth.jwt()->>'sub')
```

The owner branch must key on `properties.owner_id`, never merely on the absence
of an active org — otherwise an `org:agent` could drop out of their org context
to bypass the rent-marking restriction.

`bedrooms`, `living_rooms`, `kitchens`, `toilets`, `deposit` already exist — R2
needs no schema change beyond making them required in the form.

---

## 4. Security model

Every new table is org-scoped and follows the pattern already established by the
Clerk migration:

```sql
USING (org_id = public.current_org_id())
```

with writes further narrowed by `public.current_org_role()`. Three rules:

1. **Nothing financial is publicly readable.** `rent_ledger`, `utility_bills`,
   `tenants`, `property_private` have no public SELECT policy at all.
2. **Phone access is platform-admin only**, via `has_role(current_user_id(), 'admin')`.
3. **The public marketplace reads a narrow view**, not the base table — so a
   future column can't accidentally become public.

---

## 5. Permission matrix

Extends `src/lib/permissions.ts`. New permission keys:

```
org:rent:view          org:rent:mark_paid
org:utilities:view     org:utilities:record
org:tenants:manage     org:notes:manage
```

| Capability | Admin | Manager | Agent | Viewer |
|---|:--:|:--:|:--:|:--:|
| Edit listing | ✅ | ✅ | ✅ | — |
| Publish / unpublish | ✅ | ✅ | — | — |
| Delete property | ✅ | — | — | — |
| Set occupancy | ✅ | ✅ | ✅ | — |
| View rent ledger | ✅ | ✅ | ✅ | ✅ |
| **Mark rent paid** | ✅ | ✅ | — | — |
| Record utility bills | ✅ | ✅ | ✅ | — |
| Manage tenants | ✅ | ✅ | — | — |
| Private notes | ✅ | ✅ | ✅ | — |
| Invite staff | ✅ | ✅ | — | — |
| **See phone numbers** | platform admin only — no org role grants this |

Rationale for the two bolded rows: recording a bill is data entry; marking money
received is a financial control. Agents get the first, not the second (R-6).

---

## 6. UI

**New pages**
- `/manage` — portfolio dashboard: units, occupancy, this month's rent status, arrears.
- `/manage/property/:id` — one unit: details, occupancy toggle, rent ledger, utility bills, notes, tenant.
- `/services` — public catalog + inquiry form.
- `/admin/services` — admin CRUD for services.
- `/admin/contacts` — admin-only phone lookup.

**Changed**
- `AddProperty` — add occupancy, monthly fee, private notes; make room counts required.
- `PropertyCard` / `Properties` — filter on `is_listed AND occupancy_status='vacant'`.
- `Team` — no change; it already covers R6.

---

## 7. Build order

| Phase | Contents | Why here |
|---|---|---|
| **0** | Fix the phone leak (R-1): `profile_contacts` + tighten the profiles policy | Live data exposure — do it before anything else |
| **1** | Webhook-authoritative registration (R-7); `occupancy_status` + `is_listed` | Makes R1/R3 solid; unblocks everything downstream |
| **2** | `property_private`, notes UI, new permission keys | Small, self-contained |
| **3** | `rent_ledger` + `/manage` dashboard + mark-paid flow | The core of the PMS |
| **4** | `utility_bills` + entry UI | Mirrors phase 3 |
| **5** | `tenants` | Optional; ledger works without it |
| **6** | Services catalog + public page + admin CRUD | Independent of 0-5, can run in parallel |

Phases 0-1 are prerequisites. 2-5 are sequential. 6 is parallelisable — good
candidate to hand to a second agent.

---

## 8. Decisions (settled — do not re-litigate)

- **D1 — "Monthly fee" is the rent, and the platform collects nothing.** Owner,
  agency or staff type in the monthly amount and mark it paid; that recorded
  number is the truth. No platform billing, no owner-facing invoices, no
  sibling fee table. `rent_ledger` as specified in §3 is the whole model.
- **D2 — No tenant logins.** Tenants are records maintained by staff. Public
  visitors browse anonymously and contact via the inquiry / "call us" flow on a
  property. No tenant portal, no tenant auth.
- **D3 — Hotels and agencies get a public profile page** listing all their
  published properties, reachable by clicking through from a listing. **No
  per-room parent/child model** — a hotel's units stay ordinary `properties`
  rows. The explore page stays randomised.
- **D4 — Payments stay manual.** No payment provider integration. Revisit only
  if collection is ever brought in-house (EVC Plus / Waafi / Zaad; Stripe does
  not operate in Somalia).

## 9. Work split

Two parallel tracks, divided by file ownership so they never collide.

**Track A — Gemini: public surface & services**
`/services` public catalog, `/admin/services` CRUD, agency & hotel public
profile pages, randomised explore, marketplace filtering on the new occupancy
columns. Owns its own migration file for `services` + `service_inquiries`.

**Track B — this agent: security & PMS core**
Phone-leak fix, webhook-authoritative registration, occupancy/listed split,
private notes, rent ledger, utility bills, tenants, `/manage`. Owns the
foundation migration and `src/lib/permissions.ts`.

The foundation migration and permission keys are written first and are the
contract both tracks build against.
