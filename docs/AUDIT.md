# Mogadishu Rents — Code & Product Audit

Four parallel audits (security/RLS, PMS money logic, frontend/a11y, intent-vs-implementation)
plus hands-on user testing in a real browser at mobile and desktop widths.

**Verification key**
- ✅ **Verified** — I confirmed this personally, against the source or live in the browser.
- 🔍 **Reported** — found by an auditor, traced to a specific line, not independently re-run by me.

Nothing in this document was exploited against the live database. Security findings are
established from policy text, not by writing to production.

---

## Verdict

The architecture is genuinely good. The RLS three-branch model, the phone-number
segregation into `profile_contacts`, the anti-double-booking `EXCLUDE` constraint, the
Tailwind JIT discipline, and the re-runnable migration pattern are all better than typical.
The codebase's own comments are unusually thoughtful.

The problems are almost all **the same shape**: something was designed correctly, and the
enforcement was left to the layer that can't enforce it. Policies check the value the client
supplies instead of the relationship it claims. UI dropdowns stand in for database
constraints. Features are written but never deployed or never mounted.

Five things are broken in production right now:

1. Any signed-in user can make themselves a platform admin.
2. Neither edge function is deployed — **new signups create no profile row**.
3. The payroll feature cannot work at all (three independent bugs).
4. Rent mark-paid can silently destroy a recorded payment.
5. Per-property staff — an entire shipped feature — is inert in the UI.

---

# P0 — Fix before anything else

### 1. Privilege escalation: any user can become a platform admin ✅
`supabase/migrations/20260804000001_migrate_to_clerk_auth.sql:300-304`

```sql
CREATE POLICY "Users can update own role" ON public.user_roles
  FOR UPDATE
  USING      (auth.jwt()->>'sub' = user_id)
  WITH CHECK (auth.jwt()->>'sub' = user_id);
```

The policy constrains **whose** row it is, never **what `role` may contain**.
`PATCH /rest/v1/user_roles?user_id=eq.<self>` with `{"role":"admin"}` succeeds. The only
thing preventing it is that the UI dropdown doesn't offer `admin` — and PostgREST is
directly reachable with the anon key that ships in the browser bundle.

Your own `supabase/bootstrap_admin.sql` states the invariant this violates: *"can
self-upgrade only up to owner / hotel_manager — never admin or semi_admin… There is no
in-app path to become the first admin."* There is one.

Blast radius, since `has_role(sub,'admin')` is the platform trust root: every phone number
in `profile_contacts`, all service inquiries, update/delete on any property, and
`"Admins can update any user role"` to rewrite everyone else.

**Fix.** Drop the self-INSERT/UPDATE policies entirely (the webhook provisions the row with
the service-role key), or constrain the value:
```sql
WITH CHECK (auth.jwt()->>'sub' = user_id
            AND role IN ('user','owner','agent','hotel_manager'))
```
Keep the same list in `USING` so an existing admin can't be laundered down and back.

### 2. Neither edge function is deployed — new signups are silently broken ✅
Both return **404** on the live project:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<project>.supabase.co/functions/v1/clerk-webhook
```

I traced the full chain before concluding:
- Migration `20260804000001` **deliberately dropped** the `handle_new_user()` trigger,
  commenting that the webhook owns provisioning.
- **No client code anywhere inserts into `profiles`** — grep shows only `select` and `update`.
- The webhook was not deployed when this was written. **It is now** — re-probed
  19 Aug 2026, `clerk-webhook` answers `401`. So the chain below describes
  accounts created BEFORE it shipped; new signups should be getting their row.
  Confirm on a fresh account before assuming either way.

So every new signup gets **no `profiles` row**. Downstream: `Dashboard.tsx:68` calls
`.single()` on profiles and throws for them; `ProfileSettings` "save name" updates 0 rows
and silently no-ops; their name never appears on property or agency pages;
`BOOTSTRAP_ADMIN_IDS` never fires. Existing accounts predate the migration, which is why
this hasn't surfaced.

`increment-view` is likewise undeployed, so **view counting has never worked** — every
property page throws a CORS error on the preflight. The code is correct; it was never shipped.

**Fix.**
```bash
npx supabase functions deploy clerk-webhook increment-view
```
Then set `CLERK_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `BOOTSTRAP_ADMIN_IDS` as
function secrets and register the endpoint in Clerk.

### 3. Self-assign into `property_staff` → full access to any property's PMS data 🔍
`20260806000001_pms_expenses_maintenance_lease_staff.sql:142-151`

The INSERT policy's org branch never checks that `property_id` belongs to that org. Any user
can create their own Clerk org (`use-staff.ts:168` `createAgency` is ungated), then insert
`(victim_property_id, self, own_org)`. `is_assigned_staff()` then returns true, which is the
third access branch on **nine** tables: `tenants` (names, phones), `rent_ledger`,
`utility_bills`, `property_private`, `property_expenses`, `maintenance_requests`,
`lease_documents`, `bookings` (guest names/phones/emails), `housekeeping_tasks` — plus the
private `lease-documents` bucket, so signed leases and ID scans become downloadable.

**Fix.** Add to the org branch of INSERT/UPDATE:
```sql
AND EXISTS (SELECT 1 FROM public.properties p
             WHERE p.id = property_id AND p.org_id = public.current_org_id())
```
Then audit existing rows for org mismatches.

### 4. `hotel_editor` can seize `hotels.owner_id`, and can delete the hotel ✅(delete) 🔍(seize)
`20260808000001_hotel_pages.sql:172-179`

`hotel_managed()` now includes `hotel_editor`, and the `hotels` UPDATE/DELETE policies are
row-level with no column restriction. An invited editor can `PATCH` `owner_id` to
themselves, which then satisfies `hotel_member_admin()` and lets them rewrite the membership
list. They can also simply `DELETE` the hotel, cascading `hotel_pages`, `hotel_rooms` and
`hotel_members`.

This defeats the invariant `20260810000002` states in caps: *"AN EDITOR MUST NOT BE ABLE TO
PROMOTE THEMSELVES."*

**Fix.** `hotels` DELETE → `USING (public.hotel_member_admin(id))`. Add a `BEFORE UPDATE`
trigger rejecting changes to `owner_id`/`org_id` unless `hotel_member_admin(OLD.id)`.

### 5. `org:agent` can rewrite `owner_id` and gain rent-mark-paid 🔍
`20260804000001:417-436`

The properties UPDATE `WITH CHECK` pins `org_id` but not `owner_id`. An agent sets
`owner_id` to themselves; `owns_property()` now returns true, granting exactly the
rent-mark-paid right the permission model deliberately withholds from agents. Same policy
also grants agents DELETE, which `ROLE_PERMISSIONS` reserves for org admins.

**Fix.** Trigger rejecting `owner_id` changes; narrow the DELETE role list to `org:admin`.

### 6. Anonymous callers can block every hotel room indefinitely 🔍
`20260807000001_hotel_booking.sql:361-431`, granted to `anon`

`create_booking_request` validates the room and computes the total server-side (good), but
has no date bounds and no rate limit. One unauthenticated POST with
`check_in='2026-01-01', check_out='2099-01-01'` makes a room permanently unbookable, because
`requested` participates in the anti-overlap `EXCLUDE` constraint. Room ids are public
marketplace data, so a script takes the whole inventory offline.

**Fix.** Reject past dates, cap stay length (~30 nights) and lead time (~18 months), add a
per-IP throttle. Best: drop `'requested'` from the EXCLUDE predicate so only *confirmed*
bookings hold dates — that removes the primitive entirely.

---

# P1 — Data loss and wrong money

### 7. Rent mark-paid destroys concurrent payments ✅(logic) 🔍(scenario)
`use-rent.ts:698`, `mark-paid-dialog.tsx:96`

`amount_paid = previousPaid + amount`, where `previousPaid` is captured when the dialog
opened and the upsert **replaces** rather than increments.

August rent $1,200. Manager A opens the dialog (captures `paid: 0`). Manager B records $500.
A enters $700 and saves → writes `0 + 700`. **$500 of collected rent is destroyed** and
becomes permanent arrears. Also reproducible with one user in two tabs.

**Fix.** Do the addition server-side via RPC (`SET amount_paid = amount_paid + $1`), or add
an append-only `rent_payments` child table with the total derived.

### 8. Payroll cannot work — three independent bugs ✅
All three verified:

- `20260810000001_hotel_staff_payroll.sql:288` declares the function `STABLE`; line 316
  does `INSERT`. Postgres raises `0A000: INSERT is not allowed in a non-volatile function`.
  **"Generate month" always fails.**
- `use-hotel-staff.ts:277,420,449` embed `staff(...)`. There is no `public.staff` table —
  only `hotel_staff`, `property_staff`, `staff_payroll`, `staff_permissions`. PostgREST
  returns `PGRST200`. The error is swallowed (no `useErrorToast`, page reads only
  `{data, isPending}`), so a month with 12 salary rows renders as **"Nothing here yet"**.
- `payrollKey()` returns `["hotel-staff","payroll",undefined]` — a 3-element array that
  cannot prefix-match `["hotel-staff","payroll","2026-08-01"]`. **Every payroll mutation
  invalidates nothing**, so "Mark paid" toasts success and the row stays Pending.

**Fix.** `VOLATILE`; `staff:hotel_staff(id, name, …)`; make the key factory prefix-safe.

### 9. Per-property staff is completely inert 🔍
`use-rent.ts:390-411`

`usePropertyAccess` resolves every right as `isSoloOwner || can(PERM)`. For a caretaker —
the exact user `property_staff` exists to serve — both are false, and there is no
`isAssignedStaff` branch. So expenses, maintenance, lease documents, bookings and
housekeeping all `return null` for them, even though the RLS explicitly grants those writes
via `is_assigned_staff()`. **The whole feature ships unusable.**

**Fix.** OR an `isAssigned` branch into the view/manage flags, mirroring the policies.

### 10. Booking date auto-fill is off by one in every UTC+ zone ✅(logic)
`booking-dialog.tsx:230` and `BookingRequestForm.tsx:148`

Both build a local date then serialise with `toISOString()`, converting back to UTC. In
Mogadishu (UTC+3), picking check-in `2026-08-12` sets check-out to `2026-08-12` — nights =
0, submit disabled, on a field the user never touched. This hits **every** booking attempt,
public and staff-side. `use-bookings.ts:169` already has the correct pattern.

### 11. Editing a utility bill creates a duplicate 🔍
`record-utility-dialog.tsx:99`

Edit never passes `bill.id`; the upsert conflicts on `(property_id, period_month,
utility_type)`. Change the type or month and it inserts a second row — the register then
double-counts. The dialog's own footer promises the opposite.

### 12. Editing an expense/maintenance job blanks its `org_id` 🔍
`use-expenses.ts:171,183`, `use-maintenance.ts:184,201`

The update path re-sends `org_id` from the editor's current session. An owner editing with
their org picker on "Personal" nulls it, and the row vanishes for agency staff who aren't
the owner or assigned. Money silently disappears from the register for some users only.
**Fix:** omit `org_id` from update payloads; set it on insert only.

### 13. Currency held in raw floats leaves months permanently "partial" 🔍
`use-rent.ts:297-304`; columns are unconstrained `NUMERIC`

$300.30 paid as $100.10 + $200.20 stores `300.29999999999995`, so status writes `partial`
and the row reads "$300.30 of $300.30 — Partial" with $0.00 outstanding, carrying float dust
into arrears forever. **Fix:** round to cents at the boundary, add a half-cent tolerance,
and `ALTER TYPE NUMERIC(12,2)` (which `staff_payroll` already gets right).

### 14. Lazy ledger rows invent rent for vacant units and hotel rooms 🔍
`use-rent.ts:626-661`

Merely *visiting* a property page opens a `rent_ledger` row at `amount_due = monthlyRent`,
with no occupancy or `is_daily_rate` check. Ten vacant $800 units become $8,000 "expected"
and then $8,000 of arrears. For hotel rooms `monthlyRent` is the **nightly** rate, so a
$40/night room books $40 of monthly rent.

### 15. `requested` bookings are unactionable ✅(earlier) 🔍
`hotel-bookings-card.tsx:131`

`active` excludes `requested`, but the action row is gated on `active` while Confirm is
gated on `requested` — an unreachable branch. Since `requested` blocks dates via the EXCLUDE
constraint, an online request holds the room with no UI exit.

### 16. Failed housekeeping insert reports a completed checkout as failed 🔍
`use-bookings.ts:369-378`

The booking is already committed when the unguarded housekeeping insert throws. The user
sees "Couldn't update the booking", the dialog stays open, no cache is invalidated — but the
guest *is* checked out and their payment recorded. **Fix:** try/catch the side effect.

---

# P2 — User-visible defects

| # | Finding | Where |
|---|---|---|
| 17 ✅ | **House badges render `class="undefined"` and lowercase "house".** Confirmed live: two badges carry a literal `undefined`, while "Apartment" renders correctly. Maps are keyed `villa` but every surface remaps to `house` first. Three divergent copies of these maps exist. | `PropertyCard.tsx:17-28`, `Dashboard.tsx:34`, `PropertyDetail.tsx:28` |
| 18 ✅ | **Hotel page footer was buried under `BottomNav`** — including the "Powered by Mogadishu Rents" backlink. **Fixed and verified during this audit.** | `HotelPage.tsx` |
| 19 ✅ | **`safe-area-bottom` is not a real class** — used in BottomNav, defined nowhere. Nav sits under the iPhone home indicator. | `BottomNav.tsx:15` |
| 20 ✅ | **Pinch-zoom disabled** (`user-scalable=no`) — WCAG 1.4.4 failure, in a UI with 10–11px text. | `index.html:5` |
| 21 🔍 | **Homepage grid reshuffles on every keystroke** — `rawProperties` is a fresh array each render, so the shuffle `useMemo` never caches. Cards jump under the user's finger. | `FeaturedProperties.tsx:177-191` |
| 22 🔍 | **Filters apply to one page; the pager counts all rows.** "1 property found" above 8 pages of arbitrary subsets. | `FeaturedProperties.tsx:99-148` |
| 23 🔍 | **Photos can't be removed on touch** — remove button is `opacity-0 group-hover:*`. Owners who pick a wrong image must abandon the wizard. Same for Dashboard's photo reorder, whose helper text literally says "Hover a photo". | `PhotoUploader.tsx:73`, `Dashboard.tsx:469` |
| 24 ✅ | **17 gallery images, none lazy, none with dimensions** — layout shift plus a full eager download on your slowest-connection audience. `PropertyCard` does this right; `ImageGallery` doesn't. | `ImageGallery.tsx` |
| 25 🔍 | **No `staleTime` on 44 of 45 queries.** Every navigation refetches the full property list with joined images. Single biggest bandwidth win available. | `App.tsx:46-59` |
| 26 ✅ | **Hero search selects are 28px tall** — the primary conversion control, well under the 44px touch minimum, and unlabelled for screen readers. | `HeroSection.tsx:89` |
| 27 🔍 | **A failed query is indistinguishable from "no results"** — Saved shows the cheerful empty state when the fetch errored. | `Saved.tsx:27`, `Properties.tsx:103` |
| 28 🔍 | **AddProperty: 35 concurrent uploads, no size check, duplicate rows on retry.** The property row is inserted *before* uploads, so a failed upload + retry creates a second listing. | `AddProperty.tsx:212-233` |
| 29 🔍 | **About and Privacy have no clearance under the fixed nav** — same bug as #18, still present. | `About.tsx:8`, `Privacy.tsx:21` |
| 30 🔍 | **`increment_property_view` is callable directly by anyone**, bypassing the (undeployed) rate-limiting function entirely. `has_role()` is also anon-callable with an arbitrary user id, enabling admin enumeration. | Missing `REVOKE` |

---

# P3 — Worth knowing

- **~1,100 lines of dead code.** `TenantCard`, `TenantDialog`, `PrivateNotesCard` are fully
  built and mounted nowhere, so **the app has no tenant records and no lease-expiry warnings
  at all**. `use-tenants.ts` (333 lines) is entirely unreachable. `use-floating-panel.ts`
  (222 lines) ✅ has zero importers.
- **`row`/`column` block types exist and render nothing.** The insert strip offers "Add
  Columns", but `PageSectionView` has no case for it and `EditorCanvas` never walks
  `children`. Add a `default: return null` so unknown types can't fall through silently.
- **Audit trails overwritten on edit.** `recorded_by` is rewritten by whoever edits an
  expense; `resolved_at` is restamped on every maintenance save.
- **Re-running `20260805000001` silently strips the `is_assigned_staff` branches** — both it
  and `20260806000001` dynamically drop all policies on the same four tables.
- **Arrears silently capped at 11 months** despite the docstring promising "every month".
- **`/manage/staff` and `/manage/payroll` are only linked if you own a hotel room**, though
  neither depends on that.
- **PWA 512 icon points at the 192 file**; manifest theme colour contradicts `index.html`.
- **Six render-blocking font imports**, two of which (`Work Sans`, `Inconsolata`) are unused,
  and two duplicated with the `<link>` in `index.html`.

---

# What's genuinely healthy

Worth stating, because the list above is long:

- `.or()` **injection is properly guarded** — `AgencyProfile.tsx:46`'s `SAFE_ID` regex
  excludes the entire PostgREST filter grammar. `use-hotels.ts` contains no `.or()` at all.
- **PII segregation works.** `profile_contacts` has no public SELECT, `property_private` is
  never joined into a public query, `PropertyDetail` selects explicit columns rather than
  `*`, and there's a regression test (`privacy-guards.test.ts`) that fails the build if
  anyone reintroduces `profiles.phone`.
- **`clerk-webhook` verifies the Svix signature before touching the payload** and uses
  `ignoreDuplicates` so it can't clobber an upgraded role. (It just isn't deployed.)
- **Every `SECURITY DEFINER` function sets `search_path`.** No exceptions.
- **The 3-page cap trigger is exemplary** — `SECURITY DEFINER` so the COUNT isn't
  RLS-filtered, an advisory lock closing the concurrent-insert race, and it fires on
  `UPDATE OF hotel_id` to catch re-parenting.
- **Tailwind JIT discipline holds** across every file audited — no constructed class names.
  The failure mode that *did* bite is the adjacent one: lookups returning `undefined` and
  emitting it as a literal class (#17).
- **Robustness is good.** `/property/<garbage>` degrades cleanly to "Property not found";
  no horizontal overflow at 375px anywhere tested; `/properties` bottom padding correct.
- `property_view_logs` RLS-on-with-zero-policies is deliberate and correct.
- No secrets are tracked in git.

---

# Suggested order

1. **Today:** the `user_roles` policy (#1) — two lines, and it makes every other boundary
   moot. Then deploy the two edge functions (#2).
2. **This week:** the remaining escalation paths (#3, #4, #5), the booking DoS (#6), and
   rent mark-paid (#7).
3. **Next:** payroll (#8) and per-property staff (#9) — two whole features that don't
   currently function.
4. **Then:** the P2 list, starting with `staleTime` (#25) and the badge bug (#17), which are
   cheap and immediately visible.

One caveat on scope: I could not run SQL against the live database, so I cannot confirm
**which** migrations are actually applied, nor whether policies were edited through the
Supabase dashboard — several migrations explicitly note that dashboard-created policies
never appear in these files. Findings above are established from the migration text as
written.
