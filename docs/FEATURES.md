# Mogadishu Rents — Feature & Page Inventory

A complete map of what the product is: every page, every feature on it, and how each
feature actually works (hooks, tables, mutations, formulas).

Generated from source. All line references are `file:line`.

---

## At a glance

| | Count |
|---|---|
| **Routes** | **29** (`src/App.tsx:73-122`) |
| **Page components** | **29** (`src/pages/`) |
| **Distinct user-facing features** | **~125** (itemised below) |
| Public / no-auth pages | 11 |
| Signed-in pages | 18 |
| Database tables | 22 |
| Postgres functions / RPCs | 11 |
| Edge functions | 2 |
| Storage buckets | 3 |
| Custom hooks | 17 |
| shadcn/ui primitives | 48 |
| Test files | 7 (881 lines) |

**Stack:** React 18 + Vite + TypeScript · React Router · TanStack Query · Tailwind +
shadcn/ui · framer-motion · **Clerk** (auth + organizations) · **Supabase** (Postgres +
RLS + Storage + Edge Functions) · PostHog (optional) · PWA via `vite-plugin-pwa`.

**Two products in one codebase:**
1. A **public rental marketplace** (browse, filter, save, contact, book).
2. A **property management system (PMS)** for owners/agencies (rent ledger, utilities,
   expenses, maintenance, leases, staff, hotel front desk, hotel page builder).

---

## Route map

| # | Route | Page | Access |
|---|---|---|---|
| 1 | `/` | `Index.tsx` | Public |
| 2 | `/about` | `About.tsx` | Public |
| 3 | `/privacy` | `Privacy.tsx` | Public |
| 4 | `/properties` | `Properties.tsx` | Public |
| 5 | `/property/:id` | `PropertyDetail.tsx` | Public |
| 6 | `/services` | `Services.tsx` | Public |
| 7 | `/agency/:orgId` | `AgencyProfile.tsx` | Public |
| 8 | `/hotels/:slug` | `HotelPage.tsx` | Public (published only, via RLS) |
| 9 | `/signin/*` | `SignIn.tsx` | Public |
| 10 | `/signup/*` | `SignUp.tsx` | Public |
| 11 | `*` | `NotFound.tsx` | Public |
| 12 | `/forgot-password` | `ForgotPassword.tsx` | Public (redirect stub) |
| 13 | `/reset-password` | `ResetPassword.tsx` | Public (redirect stub) |
| 14 | `/complete-profile` | `CompleteProfile.tsx` | Signed in |
| 15 | `/profile` | `ProfileSettings.tsx` | Signed in |
| 16 | `/saved` | `Saved.tsx` | Signed in |
| 17 | `/dashboard` | `Dashboard.tsx` | `owner`, `agent`, `hotel_manager` |
| 18 | `/add-property` | `AddProperty.tsx` | `owner`, `agent`, `hotel_manager` |
| 19 | `/manage` | `Manage.tsx` | Signed in (RLS-scoped) |
| 20 | `/manage/property/:id` | `ManageProperty.tsx` | Signed in (RLS-scoped) |
| 21 | `/manage/hotel` | `HotelManager.tsx` | Signed in (RLS-scoped) |
| 22 | `/manage/hotels` | `ManageHotels.tsx` | Signed in (RLS-scoped) |
| 23 | `/manage/hotels/:id` | `EditHotel.tsx` | Signed in (RLS-scoped) |
| 24 | `/manage/staff` | `StaffManager.tsx` | Signed in (RLS-scoped) |
| 25 | `/manage/payroll` | `PayrollPage.tsx` | Signed in (RLS-scoped) |
| 26 | `/team` | `Team.tsx` | Org + `STAFF_MANAGE` |
| 27 | `/admin-panel` | `Admin.tsx` | `admin` |
| 28 | `/semiadmin` | `SemiAdmin.tsx` | `semi_admin`, `admin` |
| 29 | `/admin/services` | `AdminServices.tsx` | `admin` |

All 29 pages are `React.lazy()`-loaded behind one `<Suspense>` spinner (`App.tsx:14-41,71`).

---

## The permission model (read this first — every gate depends on it)

There are **two independent role systems**.

### A. Platform role — `user_roles.role`, one per user

`user` · `owner` · `hotel_manager` · `agent` · `admin` · `semi_admin`

- Read by `useAppAuth()` (`src/hooks/use-auth.ts:45-70`), cached 5 min.
- Deliberately **not** `.maybeSingle()` — legacy duplicate rows made PostgREST return
  406 and locked users out. It reads all rows and picks the highest by
  `PLATFORM_ROLE_PRECEDENCE` (`use-auth.ts:30-32`).
- Written via `setPlatformRole()` (`src/lib/user-role.ts:28-69`) — read-then-write, not
  upsert, because the unique constraint changed between migrations.
- Same table backs the `has_role()` RLS helper, so UI gate and DB gate agree.

### B. Organization role — Clerk Organization membership

`org:admin` · `org:manager` · `org:agent` · `org:viewer`

`can(permission)` (`use-auth.ts:77-90`) tries Clerk's native `has({permission})` first,
then falls back to the local map in `src/lib/permissions.ts`.

### The 27 permissions (`src/lib/permissions.ts:10-49`)

| Permission | admin | manager | agent | viewer |
|---|:--:|:--:|:--:|:--:|
| `PROPERTY_CREATE` / `_EDIT` / `_PUBLISH` / `_OCCUPANCY` | ✅ | ✅ | ✅ | — |
| `PROPERTY_DELETE` | ✅ | — | — | — |
| `INQUIRY_VIEW` / `_RESPOND` | ✅ | ✅ | ✅ | view only |
| `STAFF_INVITE` | ✅ | ✅ | — | — |
| `STAFF_MANAGE` | ✅ | — | — | — |
| `ANALYTICS_VIEW` | ✅ | ✅ | — | ✅ |
| `BILLING_MANAGE` | ✅ | — | — | — |
| `RENT_VIEW` | ✅ | ✅ | ✅ | ✅ |
| **`RENT_MARK_PAID`** | ✅ | ✅ | **—** | — |
| `UTILITIES_VIEW` / `_RECORD` | ✅ | ✅ | ✅ | view only |
| `TENANTS_MANAGE` | ✅ | ✅ | — | — |
| `NOTES_MANAGE` | ✅ | ✅ | ✅ | — |
| `MAINTENANCE_VIEW` / `_MANAGE` | ✅ | ✅ | ✅ | view only |
| `EXPENSES_VIEW` / `_RECORD` | ✅ | ✅ | ✅ | view only |
| `LEASE_VIEW` | ✅ | ✅ | ✅ | ✅ |
| `LEASE_MANAGE` | ✅ | ✅ | — | — |
| `BOOKING_VIEW` / `_MANAGE` | ✅ | ✅ | ✅ | view only |
| `HOUSEKEEPING_MANAGE` | ✅ | ✅ | ✅ | — |

The load-bearing distinction, annotated in-place at `permissions.ts:102` and
`supabase/migrations/20260805000001_pms_foundation.sql:629-647`:
**agents record work, they do not confirm money in.** An agent can log a utility bill or
an expense but cannot mark rent paid.

### C. The solo-landlord escape hatch

Every PMS table has a **nullable `org_id`**, and every PMS RLS policy is three-branched:

```sql
   (org_id IS NOT NULL AND org_id = current_org_id())  -- agency staff
OR owns_property(property_id)                          -- solo landlord
OR is_assigned_staff(property_id)                      -- per-unit caretaker
```

This is why `/manage/*` routes carry **no** `requireOrg` and **no** `requirePermission`
(`App.tsx:95-107`): a landlord with no Clerk organization would be locked out of the very
feature built for them. RLS makes permissiveness safe — a user with none of the three
branches simply sees an empty dashboard.

Client-side, `usePropertyAccess()` (`src/hooks/use-rent.ts:390-411`) resolves per-unit
rights as `isSoloOwner || can(PERM)` for each of 13 capabilities.

### `ProtectedRoute` (`src/components/ProtectedRoute.tsx`)

Three props: `allowedRoles`, `requirePermission`, `requireOrg`. The verdict is a single
memoised `denial` object (`:37-67`) so the redirect effect and the render path can never
disagree; `allowedRoles` is keyed by `.join(',')` because callers pass inline array
literals (without it the effect re-fired and double-toasted). Three distinct denial
reasons, each with its own message: `insufficient-platform-role`,
`no-active-organization`, `missing-permission`.

---

# Part 1 — Public marketplace (11 pages)

## 1. Home — `/` · `src/pages/Index.tsx`

Composition: `InstallBanner → Header → HeroSection → CategorySection →
FeaturedProperties → DistrictSection → "Why us" → Footer → BottomNav`.

### F1 · Hero search (`HeroSection.tsx`)
Three selects — **Where** (18 Mogadishu districts from `src/lib/districts.ts:2-21`),
**Property type** (villa/apartment/hotel/commercial), **Budget** (`0-300`, `300-800`,
`800-2000`, `2000+`). All local `useState`. Submit builds `URLSearchParams`
(`district`, `type`, `minPrice`, `maxPrice`), fires
`property_search_submitted`, then `navigate('/properties?…')` (`:34-53`).
`"all"` means "no filter".

### F2 · Category tiles (`CategorySection.tsx`)
4 static image tiles → `navigate('/properties?type=…')` (`:71`). No data fetch.

### F3 · Featured properties grid (`FeaturedProperties.tsx`)
The richest block on the site. One `useQuery(["featured-properties", page])` issues two
Supabase calls (`:99-125`): an exact `count`, and the page of rows with embedded
`property_images`. Both filter
`is_listed ∈ {true,null} AND occupancy_status ∈ {vacant,null} AND is_available = true`,
newest first, `.range()` at 20/page.

- **F3a Server-side pagination** — numbered pager + arrows, `totalPages = ceil(total/20)`.
- **F3b Text search** — client-side over `title` + `location`.
- **F3c Filter panel** — district, min/max price, min bedrooms (1-5), and 5 amenity
  chips (`parking`, `cctv`, `balcony`, `furnished`, `daily_rate`), AND-combined.
- **F3d Active-filter badge** — live count on the funnel button.
- **F3e Type pills** — All / Houses / Apartments / Hotels / Commercial (local state only).
- **F3f Sorting** — `price_asc`, `price_desc`, `newest`, and the default `randomized`,
  a Fisher–Yates shuffle (`:57-64`) so listings rotate on every visit.

### F4 · District explorer (`DistrictSection.tsx`)
Queries one cover image per district by reducing the newest available listings
(`:16-32`), renders all 18 districts as tiles → `/properties?district=…`.

### F5 · PWA install banner (`InstallBanner.tsx`)
Captures `beforeinstallprompt`, shows a dismissible top bar, calls `prompt()` +
`userChoice` on click.

---

## 2. Explore — `/properties` · `src/pages/Properties.tsx`

Same filter vocabulary as F3, but **URL-driven**, and it fetches all matching rows in one
query (no pagination).

- **F6 URL-backed state** — reads `type`, `district`/`location`, `minPrice`, `maxPrice`,
  `q` from `useSearchParams` (`:60-64`); an effect re-seeds local state on every query
  change (`:75-85`), fixing stale filters when navigating between two `/properties` URLs.
- **F7 Server-side type filter** — the only filter pushed to Postgres (`:115-119`);
  everything else runs client-side.
- **F8 Type pills mutate the existing `URLSearchParams`** rather than replacing it, so
  district and price survive a type change (`:344-353`).
- **F9** Free-text search, district select, price range, min bedrooms, 5 amenity chips,
  3 sort modes, active-filter badge, clear-all, skeletons, empty state, staggered
  motion entry.

DB enum `villa` is presented as "House" throughout (`:147-172`).

---

## 3. Property detail — `/property/:id` · `src/pages/PropertyDetail.tsx`

Three queries + one edge-function call.

- **F10 Image gallery** (`ImageGallery.tsx`) — Embla carousel, arrows, dot indicators
  (≤10 images) or an `n / total` counter, desktop thumbnail strip, `/placeholder.svg`
  fallback.
- **F11 View counting** — invokes the `increment-view` edge function on mount (`:45-51`).
  The function skips owner self-views and rate-limits one count per viewer per property
  per 24h using `property_view_logs`.
- **F12 Adaptive pricing display** — "Nightly Rate … /night" for hotels, "Monthly Rent …
  /mo" otherwise, plus deposit (`:200-219`).
- **F13 Amenities grid** — derived from 10 columns (bedrooms, toilets, living rooms,
  kitchens, floor, balcony, CCTV, parking, furnished, elevator), falsy entries dropped,
  with a "no details provided" fallback.
- **F14 Gated view count** — `property.views` renders only for the owner, `admin`, or
  `semi_admin` (`:256-261`).
- **F15 WhatsApp contact** — `wa.me` deep link with a prefilled, URL-encoded message
  containing title, location, type, price, deposit, beds, baths and the page URL
  (`:305-336`). Fires `property_contact_clicked`. **This is the only owner-contact
  channel — an owner's phone number is never exposed on a public page** (`:294-298`).
- **F16 Owner profile read is column-restricted** — `select("full_name, avatar_url")`,
  explicitly not `*`, because this is a public page reading a stranger's row (`:81-97`).
- **F17 Hotel booking form** — rendered only when `isHotel && is_available`.

### F18 · `BookingRequestForm.tsx` — public booking
Fields: check-in (defaults today), check-out, adults, children, name, phone, email, notes.
Picking a check-in auto-advances an invalid check-out by one day. Live total =
`nightsBetween(in,out) × nightlyRate`.

Submit calls the **`create_booking_request` RPC** (SECURITY DEFINER, granted to `anon`),
not a table insert. The function validates the room is `type='hotel' AND is_daily_rate`,
computes nights × price **server-side**, derives `org_id` from the property, and forces
`status='requested'`, `source='online'` — an anonymous visitor can never supply an org or
an amount. Double-booking is refused by a Postgres `EXCLUDE USING gist` constraint. No
payment is taken.

---

## 4. Services — `/services` · `src/pages/Services.tsx`

- **F19 Published services catalog** — `usePublishedServices()` reads
  `services WHERE is_published`, ordered by `sort_order` then `title`.
- **F20 Icon resolution** — the `icon` text column maps to one of 12 lucide components
  via `ICON_MAP`, defaulting to `Wrench` (`ServiceCard.tsx:26-45`).
- **F21 Enquiry dialog** (`ServiceInquiryDialog.tsx`) — react-hook-form + zod: name ≥2,
  valid email, optional phone, message ≥5, plus a **free-text** `property_ref` (kept out
  of the UUID FK on purpose — typed text used to break the insert). Inserts into
  `service_inquiries`, swaps to a confirmation panel, fires
  `service_inquiry_submitted` carrying **only** `service_id` + `service_title` — the
  typed name/email/phone/message are deliberately never sent to analytics.

---

## 5. Agency profile — `/agency/:orgId` · `src/pages/AgencyProfile.tsx`

- **F22 Dual-identity route** — both queries use `.or("user_id.eq.X,org_id.eq.X")`, so
  one URL serves an agency **and** a solo owner (`:55-94`).
- **F23 Injection hardening** — `orgId` is validated against `/^[A-Za-z0-9_-]{1,128}$/`
  before interpolation, because commas/dots/parens are grammar inside a PostgREST `.or()`
  string. A non-matching id disables both queries (`:46-52`).
- **F24** Agency header (avatar with initials fallback, listing count, trust chips) +
  available-listings grid with its own favorites wiring.

---

## 6. Hotel public page — `/hotels/:slug` · `src/pages/HotelPage.tsx`

The owner-customisable hotel micro-site. Draft pages are invisible because public RLS only
exposes `is_published` rows.

- **F25 Slug hardening** — `/^[a-z0-9-]{1,80}$/` (`:19`).
- **F26 Themed hero** — custom `hero_image_url` or an accent-colour gradient fallback,
  logo, tagline, and two anchor CTAs tinted with `hotel.accent_color` (default `#0f766e`).
- **F27 Gallery grid** (up to 12 images).
- **F28 About + "At a glance"** — address, phone, email, room count.
- **F29 Rooms & rates** — reads `hotel_rooms` joined to `properties`; each card links to
  `/property/:id` with `formatMoney(price)/night`. Includes a fallback query for room
  links whose embedded property didn't resolve.
- **F30 Contact block** — `tel:`, WhatsApp (`wa.me`, non-digits stripped), `mailto:`,
  address, "Open in maps".
- **F31 Socials** — Facebook, Instagram, TikTok, Twitter/X, all `rel="noopener"` with
  aria-labels.
- **F32 Not-live state** — an "isn't live yet" panel with a Browse-hotels CTA.

---

## 7–11. About · Privacy · 404 · SignIn · SignUp

- **`/about`** — fully static: mission cards, 6-point "why choose us", contact details.
- **`/privacy`** — four disclosure cards documenting exactly what PostHog receives
  (usage analytics, masked session recordings, the never-sent list, what signed-in
  linkage means). The file states it is a **disclosure, not a consent gate**, and that
  every claim must be honoured by `src/lib/analytics.ts`.
- **`*` 404** — logs the bad path, offers a link home. The only public page with no
  Header/BottomNav.
- **`/signin/*`** and **`/signup/*`** — Clerk's drop-in `<SignIn>` / `<SignUp>`.
  Sign-in methods, OAuth/SSO, MFA and password reset are all configured in the Clerk
  dashboard; there is **no app-level code** for any of them. The **splat is mandatory** —
  Clerk renders its own subpaths (`/signin/factor-one`, `/signup/sso-callback`,
  `/signup/verify-email-address`) and an exact match sends the OAuth callback to 404.
  `<SignUp>` sets `fallbackRedirectUrl="/complete-profile"`.
- **`/forgot-password`, `/reset-password`** — redirect stubs to `/signin` using
  `replace: true` so they never land in history. Reset is owned entirely by Clerk.

---

## Shared public chrome

- **F33 `Header.tsx`** — sticky blurred nav; a Categories dropdown; `Manage` appears for
  anyone with an org **or** a listing-capable platform role; `Team` only with an org;
  an avatar dropdown with Dashboard / Saved / Settings and role-gated Admin Panel,
  Manage Services, Overview Panel; logo `onError` fallback; animated mobile sheet.
- **F34 `BottomNav.tsx`** — mobile-only 4-tab bar (Home / Explore / Saved / Account).
- **F35 `PropertyCard.tsx`** — clickable card; favourite heart that toasts
  "Sign in to save properties" and redirects when signed out; agency link that
  `stopPropagation`s to `/agency/:id`; type + Furnished badges; feature row;
  `/night` vs `/month` pricing; lazy images.
- **F36 `useFavorites`** — `favorites` table, insert/delete toggle, returns
  `{propertyId, saved}` so analytics can distinguish save from un-save. No optimistic
  update — the heart flips after the round-trip.
- **F37 `InstallPWAButton.tsx`** — renders nothing when already installed or unavailable.

---

# Part 2 — Account & onboarding (5 pages)

## 12. Complete profile — `/complete-profile`

Post-signup step. A guard reads `profile_contacts.phone`; if one exists, the profile is
already complete and the user is bounced home (`:22-42`).

- **F38 Role self-selection** — Renter / Property Owner / Real Estate Agent / Hotel
  Manager. `admin` and `semi_admin` are deliberately not self-selectable.
- **F39 Phone capture → `profile_contacts`, never `profiles`.** `profiles` is
  world-readable; `profile_contacts` is owner-or-platform-admin only. This split is the
  reason the `phone/phone2/phone3` columns were dropped from `profiles` entirely
  (migration `20260805000001`).
- **F40 Verification policy** — renters and agents are auto-verified; **owners and hotel
  managers land unverified** and need admin verification (`:78-82`).
- Fires `signup_completed` with the role only — never the phone.
- The `profiles` row and default `user_roles` row are created **server-side** by the
  `clerk-webhook` edge function on `user.created`, with the service-role key, so it can't
  be defeated by RLS or a closed tab.

## 13. Profile settings — `/profile`

- **F41 Avatar upload** — `image/*`, <2MB, uploaded to `property-images/{userId}/avatar.ext`
  with `upsert`, public URL cache-busted with `?t=`.
- **F42 Name + phone save** — parallel writes to `profiles.full_name` and
  `profile_contacts` (upsert on `user_id`).
- **F43 Email is read-only** (Clerk owns it).
- **F44 Self-service role upgrade** — shown only to `user`; upgrade to `owner` or
  `hotel_manager`, auto-verified. Critically it **invalidates `["user-role", userId]`**,
  because `useAppAuth` caches the role for 5 minutes and every gate in the app would
  otherwise keep using the old role until a reload.

## 14. Saved — `/saved`

- **F45 Saved listings grid** — `favorites` → `properties.in("id", favoriteIds)`;
  4-skeleton loading, heart-icon empty state with a Browse CTA, staggered motion entry.
  DB nullables are coerced at the mapping boundary.

## 15. Dashboard — `/dashboard` (owner/agent/hotel_manager)

- **F46 Profile header** — avatar, name, email, Edit Profile, Sign Out.
- **F47 Quick stats** — Listings / Active / total Views (client-computed).
- **F48 Listing cards** — cover image, type badge, Active/Inactive, `/night` vs `/mo`,
  view count.
- **F49 Delete listing** — confirmation dialog then a **hard** `DELETE` (contrast with
  Admin's soft-hide).
- **F50 Edit listing dialog** — title, description, district select, price, deposit, and
  switches for CCTV / parking / availability.
- **F51 Photo management** — delete a photo (parses the storage object path out of the
  public URL, deletes the row *then* the object) and **reorder** by swapping `sort_order`
  between two rows. The first photo is the cover.

## 16. Add property — `/add-property` (owner/agent/hotel_manager)

A **five-step wizard**: Type → Details → Amenities → Photos → Review, with a progress bar
and `AnimatePresence` slide transitions.

- **F52 Step 1 · Type** — villa (House, monthly) / apartment (monthly) / hotel (daily
  rate) / commercial (monthly). The choice sets `is_daily_rate`.
- **F53 Anti-circumvention filter** — any run of 7+ consecutive digits in the description
  is rejected keystroke-by-keystroke with "Phone numbers are not allowed in property
  descriptions". The same regex guards Admin's edit form. This is what keeps contact
  routing inside the platform.
- **F54 Occupancy vs listing are two separate decisions** — choosing `occupied` forces
  `is_listed = false` and disables the marketplace switch. An occupied unit stays in the
  owner's ledger but leaves the marketplace. Insert derives
  `is_available = isVacant && is_listed`.
- **F55 Validation** — title required; price required and > 0; deposit **required**
  ("enter 0 if you take none") and non-negative; all four room counts required with
  ranges (bedrooms/toilets 1-20, living rooms/kitchens 0-10).
- **F56 Step 3 · Amenities** — room-count selects, apartment-only floor number, and four
  switches (CCTV, parking, furnished, elevator).
- **F57 Photo uploader** — up to **35** photos, `image/*` filtered, object-URL previews,
  first tagged "Cover", per-photo remove, progress bar. **Minimum 2 photos**, enforced at
  submit.
- **F58 Private notes** — optional, written to the separate `property_private` table
  (which has *no* public SELECT policy at all). A failure here degrades to a warning
  toast rather than failing the listing.
- **F59 Org attribution** — `org_id: orgId ?? null`, so staff acting inside an agency file
  the unit under it while solo landlords file it under themselves.
- **F60 Photo pipeline** — `Promise.all` upload to
  `property-images/{userId}/{propertyId}/{index}.ext`, then a `property_images` insert
  with `sort_order: index`. Array order becomes display order.
- Fires `property_listed` with property id, type, location, price, photo count, the
  lister's role and whether an org was attached.

---

# Part 3 — Property management system (5 pages)

## 17. Portfolio dashboard — `/manage` · `Manage.tsx`

### F61 · Three-source portfolio resolution (`useOrgProperties`, `use-rent.ts:451-499`)
1. `useAssignedPropertyIds()` reads `property_staff` for the current user.
2. The main query uses `.or('org_id.eq.X,owner_id.eq.Y')` with an org, else
   `.eq("owner_id", userId)` — because `org_id.eq.<null>` matches nothing.
3. A second `.in("id", extraIds)` picks up assigned units not already covered.
4. Merge, dedupe, sort by `createdAt` desc (a prior bug sorted by UUID and shuffled the
   portfolio on every load).

The query is gated on the assignment lookup having *settled* (success **or** error), so a
failed lookup can't deadlock the dashboard.

### F62 · Portfolio KPI tiles (`buildPortfolioSummary`, `use-rent.ts:789-828`)

```
occupied             = count(occupancyStatus === "occupied")
expectedThisMonth   += ledgerRow ? amountDue : (occupied ? monthlyRent : 0)
collectedThisMonth  += ledgerRow ? amountPaid : 0
outstandingThisMonth = max(0, expected − collected)
arrears              = Σ max(0, amountDue − amountPaid) over rows where periodMonth < thisMonth
```

Semantics: a vacant unit owes nothing *unless* a ledger row already exists (it was
tenanted earlier in the month). Tile tone escalates — collected → success,
outstanding → warning, arrears → destructive.

- **F63 Occupancy filter** — all / occupied / vacant, with a visible-count header.
- **F64 Portfolio table** — per unit: type, location, occupancy badge, rent (with
  "nightly rate" sublabel for hotels), and this month's rent status. When no ledger row
  exists it substitutes a synthetic `placeholderRentRow` rather than rendering blanks.
- **F65 Conditional hotel entry points** — "Hotel pages" / "Hotel desk" buttons appear
  only when the portfolio contains a `type === "hotel"` unit.
- **F66 Read-only money alert** — shown to org members who lack `RENT_MARK_PAID`.

## 18. Unit workspace — `/manage/property/:id` · `ManageProperty.tsx`

`useManagedProperty(id)` fetches by id then **re-authorizes client-side**: it returns
`null` unless the user owns it, shares its org, or is assigned to it — so a stranger's
UUID resolves to "Property not found" even though `properties` is publicly readable.

Nine self-gating sections:

### F67 · Occupancy toggle
`useSetOccupancy` writes `occupancy_status`, and marking **occupied also sets
`is_listed = false`** — pulling the unit off the marketplace. Marking vacant does *not*
re-advertise it; that stays a deliberate act. Gated on `PROPERTY_OCCUPANCY`.

### F68 · Rent ledger (`rent_ledger`)
One row per property per month; "mark paid" is an `UPDATE`, not an insert.

- 12-month rolling window.
- **Current-month merge**: if the fetched set lacks this month, a placeholder row is
  prepended client-side so the table is never empty.
- **Lazy row creation**: only users with `RENT_MARK_PAID` trigger the upsert
  (`onConflict: property_id,period_month`, `ignoreDuplicates`), guarded by a ref so a
  failed insert can't loop. Failure `console.warn`s rather than toasting — the
  placeholder is already on screen.
- `org_id` is written as `orgId ?? null`, never `""`, so a solo owner's row resolves
  through `owns_property()`.
- Columns: Month / Due / Paid (+ method) / Status / Paid on / Marked by / Action.
  "Marked by" resolves Clerk ids to names via `useStaffNameLookup`, showing "You" for
  self.
- Outstanding subtotal = `Σ max(0, due − paid)`.
- The Action column **and** the dialog are both absent without permission, plus a
  redundant `disabled` — "neither alone should be the only thing standing between an
  agent and the money column".

### F69 · Mark-paid dialog
Amount (pre-filled to outstanding), method (**cash / EVC / Zaad / bank / other** — the
Somali mobile-money rails), date, note. **Payments are incremental**: the entered amount
is *added* to `amountPaid`, and a live preview shows the resulting balance and status.
`paid_at` is stamped at noon local to avoid timezone rollover.
Status derives as `paid<=0 → unpaid`, `paid>=due → paid`, else `partial`.

### F70 · Utility bills (`utility_bills`)
One row per **(property, month, utility type)** — electricity / water / other — modelled
as rows not columns, so a fourth utility costs nothing. Bills are grouped into month
buckets where the **month header row doubles as the subtotal**, then one row per utility
with its own icon, amount, meter reading and paid/unpaid state. Upsert on
`(property_id, period_month, utility_type)`, so saving replaces an existing bill —
and the dialog says so. Gated on `UTILITIES_RECORD`.

### F71 · Expenses (`property_expenses`)
Categories: maintenance / repair / supplies / utility / other. Status: unpaid / paid.
Derived `total` and `outstanding` in the subheading. One payload serves both insert and
update; delete sits behind an `AlertDialog`. Gated on `EXPENSES_VIEW` / `EXPENSES_RECORD`.

### F72 · Maintenance work orders (`maintenance_requests`)
- Status machine: `open → in_progress → resolved | cancelled`. The hook stamps
  `resolved_at = now()` on resolve/cancel and **`null` otherwise — so reopening a ticket
  clears it**.
- Priority `low|medium|high|urgent`; category plumbing / electrical / structural /
  appliance / cleaning / other.
- **Visual escalation**: `urgent` + still-open renders a destructive-tinted card.
- Estimated vs actual cost, both validated ≥ 0.
- `assigned_to` is free text (a handyman's name), not a user id.
- `reported_by` is set **only on insert**, so an edit can't rewrite authorship.
- KPI: open count = `open + in_progress`.

### F73 · Lease documents (`lease_documents` + private `lease-documents` bucket)
- Types: lease agreement / renewal / identification / permit / other.
- **Upload path is `{userId}/{uuid}-{safeName}`** — the first folder must equal `auth.sub`
  to satisfy the storage INSERT policy. It uploads first, then inserts metadata, and
  **removes the orphaned object if the metadata insert fails**.
- **Download uses 1-hour signed URLs**, cached per document and reused on a second click;
  a refused URL surfaces "You don't have access…".
- Delete removes the row then best-effort removes the file.
- Title auto-fills from the filename; `endDate >= startDate` validated.

### F74 · Per-unit staff assignment (`property_staff`)
The mechanism that lets a caretaker **with no Clerk organization** open exactly one unit.
With an org, a select of org members minus those already assigned; without one, a raw
Clerk user-id field. Add/remove invalidate **both** the staff key and
`["manage","properties"]` — the assignee's portfolio must change immediately.

### F75 · Hotel bookings for one room (`bookings`)
Rendered only when `type === "hotel"`. Hotel rooms **are** ordinary `properties` rows —
there is deliberately no parallel rooms schema, so rent, expenses, maintenance, utilities
and leases all keep working per room.

Status enum: `requested | confirmed | checked_in | checked_out | cancelled | no_show`.
The three "active" statuses (`requested`, `confirmed`, `checked_in`) are the ones that
hold a room. Transitions surfaced: Confirm → Check in → Check out, plus Edit and Cancel.

**`useTransitionBooking` side effect:** on `checked_out`, it also writes `amount_paid`
**and auto-inserts a housekeeping task** — `{task_type:"clean", status:"pending",
notes:"Turnaround after {guest}"}` — then invalidates the bookings *and* housekeeping
caches.

### F76 · Booking dialog
- Night math: `staysOnDate(d,b) = d >= checkIn && d < checkOut` — the check-out morning is
  free, which is what makes same-day turnaround bookable.
- Changing check-in auto-pushes an invalid check-out forward a day.
- **Live availability probe** — a debounced `checkAvailability` with an `alive` flag to
  drop stale responses; states `idle | checking | free | clash`. A clash disables submit
  and names the conflicting guest and dates.
- Overlap test is the half-open `check_in < newOut AND check_out > newIn`, filtered to
  active statuses, excluding the row being edited.
- `useSaveBooking` **re-runs the availability check before writing**, and the DB still
  holds an `EXCLUDE USING gist` constraint — the client check is fail-fast, not the
  boundary.
- `amount_paid` is deliberately **not** in the save payload, so editing a booking never
  disturbs payments.

### F77 · Checkout dialog
`balance = max(0, total − paid)`. The payment input is validated finite, ≥ 0 and
**≤ balance**, and disabled entirely at zero balance with a "(settled)" label. The value
is an *increment*, matching the rent convention. Triggers the housekeeping turnaround.

### F78 · Housekeeping (`housekeeping_tasks`)
Types clean / deep clean / inspection / maintenance; statuses pending / in_progress /
done / skipped, freely settable in any order. Inline add form, per-row status select,
remove. All three mutations invalidate both the room key and the `["housekeeping"]`
prefix so the hotel board's aggregate queue refreshes. KPI: open = pending + in_progress.

## 19. Hotel front desk — `/manage/hotel` · `HotelManager.tsx`

Aggregates every `type === "hotel"` unit in the portfolio into one board.

### F79 · Today's board (`useBookingDerived`, `use-bookings.ts:440-451`)
```
active          = bookings where status ∈ {requested, confirmed, checked_in}
arrivingOn      = active where checkIn  === today
departingOn     = active where checkOut === today
inHouseOn       = active where checkIn <= today < checkOut
occupiedRoomIds = set of inHouse room ids
```
Four tiles: Arriving / Departing / In-house / **Occupancy as `occupied / totalRooms`**.

- **F80 Room grid** — per room: In-house/Free badge, nightly rate, and the current
  guest's name + nights, resolved by falling back `inHouse → arriving → departing`.
  Each card links into the unit workspace.
- **F81 Reservations table** — guest (+phone), room, dates, nights, total, status, with a
  six-value status filter. Row action is Cancel while active, else a hard Remove.
- **F82 Walk-in booking** — a room picker drives the same `BookingDialog` in create mode,
  covering walk-in / phone / agent / admin sources.
- **F83 Housekeeping queue** — read-only aggregate of every pending/in-progress task
  across all rooms; renders only when non-empty.

## 20. Hotel pages index — `/manage/hotels` · `ManageHotels.tsx`

- **F84 Ownership filtering happens client-side** — published hotel pages are readable by
  everyone, so `useMyHotels` selects all and then keeps only
  `ownerId === userId || orgId matches`.
- **F85 Create with unique slug** — `slugify(name)` (lowercase, NFKD-normalised,
  non-alphanumerics → `-`, capped at 40 chars) then `pickUniqueSlug`, which polls for
  collisions appending `-2, -3, …` up to 50 attempts. New pages start as drafts and the
  UI navigates straight into the editor.
- **F86 Published/Draft badge**; the public View button appears only when published.
- **F87 Delete** — removes the row then best-effort deletes hero, logo and every gallery
  object from storage. The copy reassures that rooms are untouched — only the
  `hotel_rooms` links go.

## 21. Hotel page editor — `/manage/hotels/:id` · `EditHotel.tsx`

A 15-field page builder in six cards:

- **F88 Identity** — name (min 2), tagline (max 160), description.
- **F89 Branding** — hero image, logo, and an accent colour with 8 presets plus a native
  colour picker, validated `/^#[0-9a-fA-F]{6}$/`.
- **F90 Gallery** — up to 12 images; multi-select is sliced to remaining capacity.
- **F91 Rooms on the page** — checkbox list of the owner's `type === "hotel"` units.
  Saving is a **delete-all-then-insert** replacement of `hotel_rooms` with `sort_order`
  following array order, and it only runs when the selection actually changed.
- **F92 Contact & footer** — phone, WhatsApp, email, maps URL, address, plus Facebook /
  Instagram / TikTok / Twitter. Blank socials are filtered out before saving.
- **F93 Publish switch** — the save button reads "Save & publish" or "Save draft".
- **F94 Asset uploads** — `image/*` only, to the **public** `hotel-assets` bucket at
  `{userId}/hotel-pages/{uuid}-{name}`, returning a public URL so drafts preview without
  auth.
- **F95 Preview** — opens `/hotels/{slug}` in a new tab regardless of publish state.
- The `slug` is never touched by updates — the public URL is stable once chosen.

---

# Part 4 — Team & administration (4 pages)

## 22. Team — `/team` · `Team.tsx` (org + `STAFF_MANAGE`)

**Agencies are Clerk Organizations.** All five mutations are Clerk API calls; Clerk keeps
its own org cache in sync, so there is no manual React Query invalidation.

- **F96 Create agency** — empty state with a name field; `createOrganization()` then
  `setActive()`. Creating an org makes you its `org:admin`.
- **F97 Invite member** — email validated with zod, surfaced only after blur. Role select
  over the four staff roles with label + description, defaulting to `org:viewer`.
  **Live permission preview**: one badge per permission the chosen role would grant, so
  the inviter sees exactly what they're handing over. Gated on `STAFF_INVITE`.
- **F98 Members table** with inline role editing and **two safety guards**: you cannot
  demote an `org:admin` if it's you or if there's only one admin left; you cannot remove
  yourself or the last admin. Individually-disabled options make this visible rather than
  just failing.
- **F99 Remove member** — `AlertDialog` clarifying that the member keeps their individual
  Clerk account.
- **F100 Pending invitations table** with revoke. Roles are fixed at invite time.
- **F101 Permission matrix** — a read-only grid **fully derived** from
  `Object.values(PERMISSIONS) × Object.values(STAFF_ROLES)`. Adding a permission in
  `lib/permissions.ts` is the only change needed for it to appear.

## 23. Admin panel — `/admin-panel` · `Admin.tsx` (admin only)

No React Query on this page — plain `useState` with local list patches applied after each
write succeeds.

- **F102 Batched loading** — properties + images in one query, then distinct `owner_id`s
  in a single `.in()` profile fetch → `Map` → attach. Two queries regardless of count
  (previously N+1). Users load the same way, in parallel with `profile_contacts`.
- **F103 Properties tab** — search across title / location / owner; four stat cards
  (Total / Visible / Hidden / Available).
- **F104 Toggle availability** and **F105 toggle visibility** (`is_hidden`).
- **F106 Soft delete** — despite destructive styling, "delete" sets
  `is_hidden = true, is_available = false`. It never issues a `DELETE`.
- **F107 Admin property edit** — title, type, price, deposit, location, description (with
  the same 7-digit phone filter), all four room counts, and six switches.
- **F108 Users tab** — search across name / role / **phone**. This is the one surface in
  the app where other users' phone numbers legitimately appear, because
  `profile_contacts` RLS grants platform admins access. Filters by role and verification;
  six stat cards; a pending-verification alert with a shortcut, plus a red count badge on
  the tab.
- **F109 Verify / revoke verification** — flips `user_roles.is_verified`.
- **F110 Role assignment** — the select offers **all six** platform roles including
  `admin` and `semi_admin`. This is the only surface that can mint an admin.

## 24. Overview panel — `/semiadmin` · `SemiAdmin.tsx` (semi_admin, admin)

- **F111 Strictly read-only** — Admin.tsx with every mutation removed, badged "Read Only".
  No visibility toggles, no verification, no role select, no actions column.
- **F112 Phones render as "Hidden"** by design: `profile_contacts` RLS is
  owner-or-platform-admin only, so a `semi_admin` would get zero rows. The UI shows the
  hidden state rather than an error, and phone is excluded from search because it would
  always match nothing.

## 25. Services admin — `/admin/services` · `AdminServices.tsx` (admin only)

- **F113 Service CRUD** — title, slug, description, icon identifier, sort order, image
  URL, `price_from`, price note, published switch.
- **F114 Auto-slug** — a toggle between Auto Slug (derived live from the title) and Manual
  Slug.
- **F115 Publish toggle** — every service mutation invalidates **both** `["all-services"]`
  and `["published-services"]`, so the public `/services` catalog updates immediately.
  `updated_at` is deliberately left to a DB trigger.
- **F116 Delete** — `AlertDialog` warning that related inquiries cascade.
- **F117 Inquiries inbox** — sender name/email/phone, service, linked property + free-text
  ref, message, date, and a status select `new → contacted → closed`. The tab label
  carries a red dot while any inquiry is `new`.

---

# Part 5 — Data model

## 22 tables

### Core
| Table | Purpose | RLS pattern |
|---|---|---|
| `profiles` | Public user card: name, avatar, primary org. **Phone columns dropped.** | Public read |
| `user_roles` | One platform role per user + `is_verified` | Self + admin |
| `properties` | The listing *and* the PMS unit *and* the hotel room | Public read (minus hidden) |
| `property_images` | Ordered photos, `sort_order` = display order | Public read |
| `inquiries` | Contact request on a listing | Owner/org or sender |
| `favorites` | Saved listings, `UNIQUE(user_id, property_id)` | Self only |
| `property_view_logs` | 24h per-viewer rate-limit ledger | **RLS on, zero policies** — service role only |

### Org / staff
| Table | Purpose |
|---|---|
| `staff_permissions` | DB mirror of Clerk org memberships, written by the webhook |
| `property_staff` | Per-property caretaker roster; backs `is_assigned_staff()` |

### PMS
| Table | Purpose | Key constraint |
|---|---|---|
| `profile_contacts` | **Every phone number lives here.** No public SELECT policy at all; no org role reaches it | — |
| `property_private` | Internal notes, structurally unable to leak via `select('*')` on properties | — |
| `tenants` | Tenant records maintained by staff (tenants never log in) | `CHECK (org_id IS NOT NULL OR property_id IS NOT NULL)` |
| `rent_ledger` | One row per property per month | `UNIQUE(property_id, period_month)`, month-truncation CHECK |
| `utility_bills` | One row per property/month/utility | `UNIQUE(property_id, period_month, utility_type)` |
| `maintenance_requests` | Work orders | status/priority/category CHECKs |
| `property_expenses` | Expense register | category/status CHECKs |
| `lease_documents` | Files per property; `file_path` joins to `storage.objects.name` | — |

### Hotel
| Table | Purpose | Key constraint |
|---|---|---|
| `bookings` | One reservation per room per stay, night-based | **`EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&) WHERE status IN ('requested','confirmed','checked_in')`** — double-booking is impossible at the DB level; cancelled/no-show/checked-out release the dates |
| `housekeeping_tasks` | Room turnaround log | — |
| `hotels` | The public customisable hotel site | `slug UNIQUE`, `accent_color ~ '^#[0-9a-fA-F]{6}$'` |
| `hotel_rooms` | Which properties appear on which hotel page | `PK(hotel_id, property_id)` |

### Services
| Table | Purpose |
|---|---|
| `services` | Admin-curated catalog |
| `service_inquiries` | Public enquiry — **public INSERT, admin-only SELECT** |

## Enums

- `property_type`: `villa` (renamed from `house`), `apartment`, `hotel`, `commercial`
- `app_role`: `user`, `owner`, `hotel_manager`, `agent`, `admin`, `semi_admin`

Everything else is `TEXT` + `CHECK` rather than a PG enum — deliberate, so adding a status
is not a type migration.

## 11 Postgres functions

| Function | Purpose |
|---|---|
| `current_user_id()` / `current_org_id()` / `current_org_role()` | Read Clerk claims out of the JWT |
| `has_role(text, app_role)` | Platform-role check (backs the UI's role gates too) |
| `owns_property(uuid)` | Solo-landlord branch. **Must never consult org membership** — doing so would hand `org:agent`s the rent-mark-paid privilege the org branch withholds |
| `is_assigned_staff(uuid)` | Per-property caretaker branch |
| `hotel_managed(uuid)` | Owner OR matching-org staff OR platform admin |
| `create_booking_request(...)` | Public booking entry point, `GRANT EXECUTE TO anon` |
| `increment_property_view(uuid)` | View counter |
| `update_updated_at_column()` | Timestamp trigger on 12 tables |

## 2 edge functions

- **`clerk-webhook`** — authoritative for user provisioning. Verifies the Svix signature
  *before* trusting the payload, then uses the service-role key to handle `user.created`
  / `user.updated` (upsert profile + role, with `ignoreDuplicates` so a CompleteProfile
  upgrade isn't clobbered), `user.deleted` (explicit cascade across four tables), and the
  four `organizationMembership.*` events (sync `staff_permissions` and `profiles.org_id`).
  A `BOOTSTRAP_ADMIN_IDS` secret grants `admin` on first signup — the supported path to
  the first admin.
- **`increment-view`** — view counting with owner self-view suppression and a 24h
  per-viewer rate limit keyed on user id or IP.

## 3 storage buckets

| Bucket | Visibility | Contents |
|---|---|---|
| `property-images` | Public | Listing photos `{userId}/{propertyId}/{i}.ext` + avatars `{userId}/avatar.ext` |
| `hotel-assets` | Public | Hero, logo, gallery `{userId}/hotel-pages/{uuid}-{name}` |
| `lease-documents` | **Private** | Lease files; read requires an EXISTS join against a readable `lease_documents` row; access is via 1-hour signed URLs |

---

# Part 6 — Cross-cutting features

- **F118 PWA** — `vite-plugin-pwa` with `registerType: "autoUpdate"`, an inline manifest
  (standalone display, 192/512 icons), and a `navigateFallbackDenylist` for `/~oauth` so
  the service worker can't swallow Clerk OAuth callbacks. Two install surfaces: a home
  banner and a header button.
- **Analytics (PostHog)** — **optional by design**: with no `VITE_POSTHOG_KEY` nothing
  initialises and every export is a silent no-op. Config sets `capture_pageview: false`
  (manual, SPA), `person_profiles: "identified_only"`, and
  `session_recording.maskAllInputs: true`. Every helper swallows its own errors so
  analytics can never break a submit handler.

  **7 tracked events:** `property_viewed`, `property_contact_clicked`,
  `property_search_submitted`, `service_inquiry_submitted`, `property_listed`,
  `signup_completed`, `favorite_toggled` (plus manual `$pageview` and auto `$pageleave`).

  `AnalyticsBridge` fires one pageview per **pathname** change only, deliberately ignoring
  the query string because filter state churns it on every keystroke. It identifies users
  by `{platform_role, org_id, org_role}` only, and uses a `wasSignedIn` ref so `reset()`
  fires on real sign-out but not first paint, preserving the anon → account link.

  **Privacy rule, stated in three places:** phone, email and message bodies are never
  sent.
- **Error boundary** — a class component whose `componentDidCatch` explicitly calls
  `captureException`, because boundaries stop errors before `window.onerror` where
  PostHog's `capture_exceptions` listens. `error.message` renders only in DEV; the stack
  never reaches the UI. It sits *inside* the router (so the fallback can navigate) and
  *outside* `AnalyticsBridge` (so a crashed page still reports its route).
- **Query resilience** — a single `QueryClient` whose retry function **never retries 4xx**:
  a 401 means the JWT was rejected and a 403 means RLS said no; retrying turns one
  rejection into four.
- **Design system** — 48 shadcn/ui primitives; tokens in `src/index.css` (188 lines):
  brand gold `--primary` #D6A23E, near-black teal secondary, warm amber accent, semantic
  success/warning/info, a domain-specific `--hotel` purple, 5 chart colours, 3 gradients,
  3 custom shadows, full dark mode. Fonts: Plus Jakarta Sans (headings), Inter (body),
  Lora, Space Mono.
- **SEO** — full OG + Twitter card meta, JSON-LD `WebApplication` with
  `applicationCategory: RealEstateApplication` and `areaServed: Mogadishu/Somalia`,
  `robots.txt`, `sitemap.xml`, SPA rewrite in `vercel.json`.
- **Testing** — Vitest + jsdom, 7 files / 881 lines: analytics no-op behaviour, error
  boundary, the role→permission matrix, `ProtectedRoute` gating, `useAppAuth` (including
  graceful degradation on duplicate legacy role rows), and **`privacy-guards.test.ts`** —
  a static source-text guard that walks `src/` and fails the build if anyone reintroduces
  a `profiles.phone*` query.

---

# Part 7 — Hotel staff & payroll (2 pages, migration `20260810000001`)

Hotel staff are **`hotel_staff` rows** — the *employees* of a hotel (receptionist,
housekeeping, chef…), not the Clerk organisation members who sign into the marketplace,
so the table is named `hotel_staff` and every hook uses a `Hotel*` prefix. Visibility
mirrors the hotel line through `hotel_staff_managed()`: the owner, any staff of the
matching org, or a platform admin. Payments live in `staff_payroll`, one row per
(staff member, pay period, type).

## 26. Staff — `/manage/staff` · `StaffManager.tsx`

- **F119 Roster with roles** — manager / receptionist / housekeeping / chef / security /
  maintenance / other, plus phone, email, start date and free-text notes. Colored
  initials avatars; three filter pills (all / active / inactive).
- **F120 Pay model** — each member is **monthly-salary** or **daily-wage**, with the rate
  stored on the row and a tile showing the sum of active monthly salaries as a payroll
  preview.
- **F121 Active toggle** — a per-row `Switch` and a form switch; deactivated members are
  excluded from generated payroll but their history is kept.
- **F122 CRUD with validation** — name ≥ 2 required, salary ≥ 0 when set. Delete warns
  that the member's whole payroll history goes with them (`ON DELETE CASCADE`).
  Reachable from the Manage and Hotel-desk headers.

## 27. Payroll — `/manage/payroll` · `PayrollPage.tsx`

- **F123 Month picker** — `input[type=month]` defaults to the current month; every
  payment whose `period_start` falls inside it is listed, pending rows first.
- **F124 Generate month** — calls `generate_monthly_payroll(month_start, month_end)`
  (SECURITY DEFINER, scoped to the caller's own members): inserts one `salary` row per
  **active monthly-rate** member that doesn't already have one, skipping daily-wage
  members. A partial unique index on `(staff_id, period_start) WHERE pay_type = 'salary'`
  guarantees at most one seeded salary per member per month.
- **F125 Payment types & settlement** — salary / advance / bonus / penalty badges;
  summary tiles split the month's payroll total into pending vs paid. A "Mark paid"
  action stamps `status = paid` + `paid_at`; pending rows can be edited or deleted.
- **No-payment-yet chips** — every member without a row that month shows as a chip that
  opens the add-payment dialog pre-selected, so daily-wage workers (who never get a
  generated row) and new hires are always reachable.

---

# Appendix — Known gaps found during this audit

These are real inconsistencies in the current code, not design notes.

**Functional**
1. `requested` bookings are unactionable in the room card — the action strip is gated on
   `status ∈ {confirmed, checked_in}`, so the Confirm button (which only renders for
   `requested`) is unreachable. Online requests can only be handled from `/manage/hotel`.
2. `/manage/hotel` has **zero client-side permission checks** — a Viewer sees Book /
   Cancel / Remove buttons that RLS will reject.
3. `usePropertyAccess` ignores `property_staff`, so an assigned caretaker with no org role
   sees every write control hidden — even though RLS grants them the writes and
   `useAssignedPropertyIds` deliberately lets them reach the page.
4. `HOUSEKEEPING_MANAGE` is defined and granted to three roles but never read;
   housekeeping piggybacks on `BOOKING_MANAGE`.
5. `TenantCard` / `TenantDialog` / `PrivateNotesCard` are fully implemented and wired to
   working hooks but **mounted nowhere** — `ManageProperty.tsx:113-116` still describes
   them as pending. That means tenant records, lease-expiry warnings and private notes are
   currently unreachable in the UI.
6. Expense/maintenance delete buttons are gated more permissively than RLS allows, so
   agents get a delete button that will fail.
7. `EditHotel` deletes storage assets immediately on removal, before Save — cancelling
   afterwards orphans the DB reference.
8. `/team` requires `STAFF_MANAGE` (admin-only) at the route, yet `org:manager` holds
   `STAFF_INVITE` — managers can never reach the page that would let them use it.
9. `AddProperty` keeps `has_balcony` in form state and shows it in the Review summary, but
   step 2 has no control for it — it is always `false` on insert.
10. `PhotoUploader` advertises "up to 5MB each" but no size check exists anywhere on the
    listing-photo path.
11. `Dashboard` uses `.single()` on `user_roles` — the exact pattern `use-auth.ts` and
    `ProfileSettings` were both rewritten to avoid, because a duplicate row throws
    PostgREST 406. The computed `isPendingVerification` is never rendered, so the failure
    is currently silent.

**Consistency / hygiene**
12. `increment-view` still calls `userClient.auth.getUser()` (Supabase Auth) after the
    Clerk migration, so signed-in users are treated as anonymous IPs and the owner
    self-view skip never triggers.
13. `robots.txt` disallows `/x9k2m-panel` and `/v7r3p-overview`, but the real admin routes
    are `/admin-panel` and `/semiadmin`.
14. `theme-color` differs between `index.html` (#D6A23E) and the PWA manifest (#1e3a5f);
    the manifest's 512 icon entry points at the 192 file.
15. Migration `20260609000003_push_reminder.md` records that the `house` → `villa` enum
    rename was never applied to production; `src/lib/types.ts` still declares `"house"`.
16. Near-identical filter/map/sort pipelines are duplicated three times
    (`Properties.tsx`, `FeaturedProperties.tsx`, `AgencyProfile.tsx`), including the same
    `RawPropertyRecord` interface.
17. `FeaturedProperties` paginates server-side but filters client-side, so page sizes and
    the "N properties found" count disagree with the pager.
18. `AgencyHeader` hardcodes `isVerified = true` — every agency shows "Verified Partner"
    regardless of any actual verification state.
19. `SemiAdmin` still prompts "Search users by name or phone" although phone matching was
    intentionally removed.
20. `Index.tsx` uses a raw `<a href="/services">` in the footer, causing a full page reload.
