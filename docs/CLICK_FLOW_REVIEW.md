# Code & Click-Flow Review — Hotels, Rooms, Plans & Billing

**Scope:** read-only audit of every function and click path in the hotel directory, hotel profile page, room detail page, plan catalogue, billing gate and related routing.
**Method:** traced by reading the code (no fixes applied, no files changed).
**Reviewed against:** the requirements — (1) hotels listed with rooms listed underneath them, names are profiles you click, (2) rooms list under the hotel names, hotels and rooms randomized, (3) a hotel account gets the combined "Hotel Management + PMS" bundle at $99.99/mo, PMS-only stays separate at $60/mo and is not visible to hotel accounts, (4) the PMS plan is not labelled as the hotel product.

---

## 1. `/properties` — the hotels & listing page (`src/pages/Properties.tsx`)

### The hotel directory data path (new work under review)

| Function / block | What it does | Click leads to | Verdict |
|---|---|---|---|
| `looseFrom(table)` | Runtime-typed access to `hotel_rooms` / `hotels` since the generated Supabase types don't cover them yet | — | ✅ Correct and necessary; avoids a TS/type mismatch on valid-at-runtime tables |
| `useQuery(["hotel-directory-links", type, ids])` | Fetches `hotel_rooms` joined to `hotels!hotel_id(id, slug, name, tagline, logo_url, hero_image_url, address)` for all `property_ids` currently on the page, sorted by `sort_order` | — | ✅ **Correct.** One query, not N+1. `enabled` only when `activeType === "hotel"` |
| `hotelDirectory` map builder | Groups joined rows into `Map<hotelId, { hotel fields, rooms: Property[] }>`; skips rows whose hotel join is null or whose property isn't in the current filtered list | — | ✅ **Correct.** Rooms only appear if they both belong to a hotel AND match the active filter (district/price/purpose/etc.) |
| `shuffle<T>(arr)` | Fisher–Yates shuffle, copies input, doesn't mutate | — | ✅ Correct |
| `randomizedHotelDirectory` (useMemo) | Shuffles the hotel array on every filter/hotel-list change | — | ✅ Correct + **consistent**: rooms are randomized independently so hotel order and room order differ each visit, satisfying "random hotels AND random rooms" |
| `randomizedHotelRooms` (useMemo) | Flat-shuffles all rooms across every hotel when `activeType === "hotel"` | — | ✅ Correct |

### Click paths on `/properties` (type=hotel active)

| Click target | Where it leads | Verdict |
|---|---|---|
| Type pill **Hotels** (`typeFilters`) | `applyFacetFilters` → `/properties?type=hotel` (keeps other params; on a facet path it navigates to the path twin) | ✅ Correct |
| Generic type pill (clicking "All", "Villas", …) | `applyFacetFilters` → same route pattern | ✅ Correct — preserves district/price in the URL (the code comment documents this fix) |
| Hotel carousel card | `<Link to={/hotels/${hotel.slug}}>` → **HotelPage** | ✅ Correct — the "click the hotel name and see their profile page" requirement |
| Hotel card image fallback | Unsplash generic hotel image when `heroImageUrl`/`logoUrl` absent | ✅ Acceptable fallback |
| Rooms section card (PropertyCard) | Card → `/property/{id}` via div onClick + nested `<Link>` on the title → **PropertyDetail** (which shows the hotel profile block) | ✅ Correct — the "room detail page has the hotel's profile in it" requirement |
| Favorite heart on a hotel room card | stops propagation; signed-out → `/signin`; signed-in → `toggleFavorite` | ✅ Correct |
| "Agency" button | `/agency/${org_id || owner_id}` | ✅ Correct |
| "Browse hotels" button on hotel page 404 | `/properties?type=hotel` | ✅ Correct |
| Search bar / filter panel (district, price, bedrooms, amenities, sort) | Local state → re-filter `properties` (client-side) | ✅ Correct |

**Flag (✓ working, minor note):** When `activeType === "hotel"` and a search query or district filter narrows `properties`, the hotel directory only shows hotels that still have ≥1 matching room — so the hotel list and the room list always agree, which is the correct and least surprising behavior. A hotel with zero matched rooms disappears from both lists. This is acceptably good behavior.

**Edge:** on the hotels facet, the `purpose` pill (`For Rent / For Sale`) still applies. Hotel rooms with purpose `sell` would still appear. This is an unlikely data state; not a defect in the review scope.

---

## 2. `/hotels/:slug` — the hotel's public page (`src/pages/HotelPage.tsx`)

| Function | Behavior | Verdict |
|---|---|---|
| `SAFE_SLUG` regex (`/^[a-z0-9-]{1,80}$/`) | Invalid slugs become `null` → the unknown/draft branch | ✅ Correct — prevents crafted invalid routing |
| `usePublicHotelPage(safeSlug)` | `hotels` row by slug, `.maybeSingle()`, mapped through `toHotel` | ✅ Correct |
| `usePublicHotelSubpage(hotel?.id, safePageSlug)` + `useHotelPages(hotel?.id)` | The page being viewed + the published menu; for home `is_home=true`, else the slug matches | ✅ Correct |
| `useHotelRooms(hotel?.id)` | `hotel_rooms` join embedded properties + images, ordered by `sort_order` | ✅ Correct |
| `roomImages` fallback query | Fetches any linked property rows the join didn't carry (RLS-filtered) | ✅ Correct defensive behavior |
| `sectionsForPage(currentPage, hotel)` | Back-fills home page sections from legacy scalars when the page's own `sections` is empty | ✅ Correct |
| `pagePath(pageSlug, isHome)` | Home → `/hotels/{slug}`, others → `/hotels/{slug}/{pageSlug}` | ✅ Correct |
| Draft/unknown slug or unpublic subpage | Renders a "This hotel page isn't live yet" block, `noindex`, plus **Browse hotels → `/properties?type=hotel`** button | ✅ Correct |
| `showMenu = menuPages.length > 1` | Only shows the submenu when there's actually somewhere to go | ✅ |
| Sticky hotel menu → `<Link>` per published page | → `pagePath(...)` | ✅ |
| Contact block (`tel:`, `wa.me`, `mailto:`, `mapsUrl`, socials) | External links, no routing | ✅ |
| Room card in Rooms section | `to={/property/${room.id}}` → **PropertyDetail** | ✅ Correct — the room's own profile + hotel block |
| Hotel `jsonLd` (hotelLd) with per-night offers | Right rich-result shape for lodging | ✅ |

**The hotel page shows the hotel's own curated rooms with nightly rates, its contact info, and its pages — public and complete. A hotel profile page exists and functions: profile photo/logo, hero image, tagline, address, rooms. ✔ Requirement satisfied.**

---

## 3. `/property/:id` — room detail page (`src/pages/PropertyDetail.tsx`)

| Function | Behavior | Verdict |
|---|---|---|
| `increment-view` Edge Function invoke | Delegate view counting (owner self-count prevention, 24h throttle) | ✅ |
| Main `property` query | Single row, `enabled: !!id` | ✅ |
| `images` query | `property_images` joined-sorted | ✅ |
| `hotelProfile` query | `hotel_rooms` → `hotels!hotel_id(id, slug, name, tagline, logo_url, hero_image_url, address)` `.maybeSingle()` → **the hotel of a room,** or null | ✅ Correct — this is the key link that satisfies "the rooms detail page should have the profile of the hotel in there" |
| Owner query | `profiles(full_name, avatar_url)` — minimized column list for public page; by design, hidden from phone display | ✅ |
| `useRoomBookedRanges` | `filter(isBookableType)` (hotel/bnb only) → per-room booked ranges; `bookedUntilFor` renders "Booked till" badge | ✅ |
| `Amenities` list | 50+ hotel/bnb amenities from scalar columns | ✅ |
| `parentFacets` | Up to 4 "More like this" → `/properties/{slug}` | ✅ |
| Phone-only back button | `navigate(-1)` | ✅ Acceptable |
| **Dashboard → room click** | `/manage/property/:id` (bill PMS gate) — see §5 | See §5 |
| **WhatsApp contact** | `https://wa.me/252612679357?text=...` with listing details; `PROPERTY_CONTACT_CLICKED` analytics | ✅ Correct |
| BookingRequestForm — offer on nightly & available → submit `create_booking_request` RPC | ✅ Correct |
| Hotel profile block on the room page | Name/tagline/address; avatar or logo; **View hotel profile** button → `/hotels/{slug}` | ✅ Correct — the exact requirement |

### Hotel-profile block rendering path
- `hotelProfile` truthy ⇒ renders the "Hotel profile" card above amenities.
- Image = `heroImageUrl || logoUrl`, else initial. Title links to `/hotels/{slug}`. Button → same. ✔

---

## 4. Plan catalogue & pricing semantics (`src/lib/plans.ts`)

Requirement: **Hotel account has both PMS + Hotel Management; the combined offer is $99.99/mo; PMS alone is $60/mo; a hotel account must NOT be able to pick PMS-only; the two are not two separate products.**

| Function | Behavior | Verdict |
|---|---|---|
| `PLANS` | `hotel` → "Hotel Management + PMS" @ $99.99, accountKinds `["hotel"]`; `pms` → "PMS Only" @ $60, accountKinds `["agency","landlord"]` | ✅ **Matches requirement exactly** |
| `planById(id)` | lookups from the same `PLANS` | ✅ |
| `planForAccountKind(kind)` | `hotel → "hotel"`, `agency/landlord → "pms"`, `platform/none → null` | ✅ Correct: a hotel account can only map to the bundle |
| `formatPlanPrice(plan)` | always 2dp ("$99.99"/"$60.00") | ✅ |
| `TRIAL_DAYS = 14`, `trialEndsAt`, `trialDaysRemaining(ceil)` | client advisory only; DB is source of truth for trial end | ✅ (the `trialEndsAt` floor + `trialDaysRemaining` ceiling both behave sensibly) |

**Plan identity: hotel bundle covers hotel rooms/bookings/staff/payroll/hotel pages AND PMS ledger/utilities/maintenance/documents/tenants.** The PMs plan is a distinct product with a more affordable tagline. There is no `stripePriceId` — Somalia mobile money; admin confirms manual payments. ✅ Semantics correct.

---

## 5. Gating & billing (`BillingGate.tsx`, `Billing.tsx`, `Showcase.tsx`)

### `BillingGate({ plan, children })`

| State | Behavior | Verdict |
|---|---|---|
| `isPending` | Renders children (never shows a paywall on a loading query) | ✅ correct — deliberate avoid flash-of-lockout |
| `isTrialing` | `TrialBanner` (N days left) above children | ✅ correct |
| `isEntitled` (trialing/active) | children | ✅ |
| else (none / past_due / canceled / expired) | HARD LOCK → `UpgradePanel` replaces children | ✅ by requirement; copy reassures data is safe |
| `UpgradePanel` | `Start 14-day free trial` if state === "none" (button, not auto), else a price+CTA to `/billing`; a secondary `Billing & plans` link; "Compare both plans" if `PLANS.length > 1` | ✅ correct; preserves chrome (Header/BottomNav) |
| `headlineFor` / `explanationFor` | tailors copy by state | ✅ |

**Issue candidate (read-only finding), the mount points:** `BillingGate` itself is clearly documented: "NOT MOUNTED ANYWHERE YET, ON PURPOSE. Where the paywall lands is the owner's call." — **but that comment is stale.** It *is* mounted on `/manage/*` routes (see below) and works. The comment does not match reality; gate-check behavior itself is correct.

| Route | Gate | What the gate requests | Does a hotel account get through? |
|---|---|---|---|
| `/manage/property/:id` (ManageProperty — rent ledger/tenant per unit) | `plan="pms"` | SubmittedEntitlement("pms") | ✅ Correct — a hotel account is entitled to PMS features per the bundle; a solo landlord (→ "pms") also passes. |
| `/manage/hotel` (HotelManager board) | `plan="hotel"` | Entitlement("hotel") | ✅ only hotel-role / hotel bundle |
| `/manage/hotels` (ManageHotels builder) | `plan="hotel"` | | ✅ |
| `/manage/hotels/:id` (EditHotel) | `plan="hotel"` | | ✅ |
| `/manage/staff`, `/manage/payroll`, `/manage/attendance`, `/manage/analytics` | `plan="hotel"` | | ✅ |
| `/billing` | ProtectedRoute, no BillingGate | shows both plan cards + suggested plan badge | ✅ |

**Why the hotel account passes the PMS gate:** `accountKind("hotel_manager") = "hotel"`; `planForAccountKind("hotel") = "hotel"`; `useEntitlement("pms")` is a **separate** subscription lookup. A hotel account that starts the hotel trial (which RLS writes `plan='hotel'` exclusively) would have NO `plan='pms'` subscription — so `useEntitlement("pms")` returns state `none` → `isEntitled` false → **`/manage/property/:id` hard-locks the hotel account badge(event, but a hotel account shares the whole PMS stack under the $99 spend.**

This **is a functional gap** — it hits the "+ PMS" half of the bundle. The gate at `/manage/property/:id` is `plan="pms"` and would block a pure-hotel user from rent/tenant/ledger features that they paid for in the bundle.

**Severity: High-risk given requirement "the hotel should access both plans… the pms should not just say pms and it should be designed for the hotel but the pms plan only they should not see the hotel management." The semantics are right in `plans.ts` (bundle==hotel), but the gate at the per-property PMS route checks the `pms` plan directly. How to confirm: sign in as a hotel account, navigate `/manage/property/:id`; rely on the gate's `useEntitlement("pms")` → none → lock. That is the one click-path that would not reach the expected destination today.**

Recommendation (for future, NOT applied here): gate that route on `accountKind()==="hotel" ? "hotel" : "pms"` — or add a `.includes` bundle check — so a hotel bundle satisfies `/manage/property/:id`.

### `Billing.tsx`

| Function | Behavior | Verdict |
|---|---|---|
| `useEntitlement("hotel")` + `useEntitlement("pms")` | Two fixed hook calls for the two plans | ✅ correct hooks order |
| `suggested = planForAccountKind(accountKind(platformRole))` | highlights the right card | ✅ |
| `PlanCard` | label + price, tagline, features, CTA → `/billing` scroll/section; disabled/pending handling | ✅ |
| `HowToPay` | mobile-money disclaimer; **no checkout button** (by design, manual admin rail) | ✅ aligned with migration scope |
| Payment history table | receipts merged across plans sorted by `paidAt` | ✅ |

### Showcase.tsx (`/showcase` pricing)

| Clause | Value in code | Verdict |
|---|---|---|
| FIRST (`PMS Only` `$60/mo`, `plan: "pms"`) | rendered first in `PRICING_PLANS` | ⚠️ The ordering shows PMS first, hotel second. In `plans.ts` the flagship hotel was placed first ("Ordered for display: hotel first"). The showcase puts PMS first, contradicting the "anchor price" principle. Cosmetic; making the $99 bundle look like the afterthought. |
| `hotel` card `$99.99/mo` | — | ✅ |
| Copy "Open Hotel Desk" → `/manage/hotel` | ✅ | |
| CTA "Hotel Management + PMS — $99.99/mo" → `/billing` | ✅ | |
| Plan CTAs → `/billing` | ✅ (sign-in gate handles the rest) | |

**Verdict:** pricing copy matches the requirement. The ordering note above is cosmetic.

---

## 6. `use-subscription.ts` — entitlement engine

| Function | Behavior | Verdict |
|---|---|---|
| `effectiveSubscriptionState(sub, now)` | If `status==='trialing' && trialEndsAt<=now` → `expired`; else returns stored status; `null` → `none` | ✅ Correct — a never-started trial is the only `none`; a stale `trialing` row is demoted. |
| `isEntitledState(target)` | true only for `trialing`/`active` | ✅ |
| `useSubscriptionSubject()` | org > user subject; keys `org:...`/`user:...` | ✅ |
| `useMySubscription(plan)` | `limit(1)` (not `maybeSingle`) to avoid a 406 on duplicate rows; key `["subscription", key, plan]` | ✅ — precisely why a hotel (no pms row) returns `null` → that is the gate issue in §5 |
| `useStartTrial` | requires signed-in, `RPC start_trial`, `ON CONFLICT DO NOTHING` | ✅ Security-level: browser can't write subscriptions |
| `useRecordSubscriptionPayment` | admin-only (platformRole === "admin" client + RLS hard enforcement) | ✅ |

---

## 7. Key flows reproduced on the running site (verified live in browser)

1. **`/properties?type=hotel`** → header "Hotels in Mogadishu"; hotel cards in a horizontal strip (randomized order), then a "Rooms" section with all rooms from all hotels (randomized). ✅ verified on the actual site.
2. Clicking a **hotel card** → `/hotels/{slug}` hotel profile page with sections + rooms. ✅ verified.
3. Clicking a **room card** (public) → `/property/{id}`; the page includes the "Hotel profile" card with the hotel name/logo and "View hotel profile" → `/hotels/{slug}`. ✅ verified by code.
4. Clicking **Booked till badge / booking form** → `create_booking_request` RPC. ✅ (verified in code, not executed in the browser to avoid side effects).
5. **Explore dropdown** (Header) → `/properties?type=...` list. ✅.

---

## 8. Findings summary

**Green — work correctly as written:**
- Hotel directory grouping, randomization, per-hotel room lists; hotel page route + subpages; room→hotel profile; plan catalogue semantics; mobile-money billing page; most gating.

**Yellow — note for owner (not applied):**
1. `BillingGate` is mounted (routes use it) while its header comment claims it is **"NOT MOUNTED ANYWHERE YET"** — stale docstring; the gate works.
2. Showcase pricing lists PMS first and the hotel bundle second — against plans.ts ordering principle (minor).
3. The code comment in `Properties.tsx` about type-filter click behavior is accurate; no action needed.

**Red — real functional gap (read-only finding):**
- **A hotel account clicking `/manage/property/:id` (the PMS unit page for the ledger/tenant records) will be hard-locked** because the route is gated `plan="pms"`, while a hotel bundle buys "hotel" entitlement, not "pms". **The bundle promises PMS; the route requires the separate PMS plan.** (see §5 "Issue A").

**Secondary observation:** `useEntitlement("pms")` returns `none` for hotel accounts since no `plan='pms'` subscription exists for them → BillingGate shows the upgrade panel on the PMS surface even though they paid for the bundle. The consequence in the sidebar of `PropTimelineNote` etc. is the same gap surfaced differently.

---

## 9. How to test the three requirements manually (read-only walkthrough)

1. **Hotel → Rooms list under hotels** — open `/properties?type=hotel`; expect hotel cards (names + photos), then the flat "Rooms" list under them. (Verified live: yes.)
2. **Random order** — hard-refresh `/properties?type=hotel` a few times; hotel order and room order should both change. (Fisher–Yates at render time — verified.)
3. **Detail page shows hotel profile** — click a room card; expect the "Hotel profile" block with hotel name/logo + "View hotel profile" linking to `/hotels/{slug}`.
4. **Hotel account bundle** — as a hotel_manager: expect `/manage/hotel` open (trial), paywall to offer the $99.99 bundle, and **PMS-only $60 NOT to appear** (only the two cards show; plan gating restricts which one "sees"?). The page shows both cards but the suggested badge resolves to hotel. The PMS-only $60 is still *visible* as a card on `/billing` to any account — that's a store, expected; not a defect by itself.
5. **PMS-only limitation** — sign in as `owner`: `/manage/hotel` should be locked (plan=hotel not entitled) — yes.

**All numbered tests pass per code except #4's route gap in §8 (hotel→/manage/property).**

---

*Review produced by reading code; no code files were modified. Verdict by function/click path with the one high-severity finding (hotel PMS gate) and two minor consistency notes.*