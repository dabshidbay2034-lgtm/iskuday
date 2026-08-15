# Mogadishu Rents — UX Walkthrough

How the product actually works, read from the code (not the marketing docs). Every
claim below maps to a file/line you can open:

| Surface | Source |
|---|---|
| Auth (sign in / sign up) | Clerk drop-in — `src/pages/SignUp.tsx`, `src/pages/SignIn.tsx` |
| Account provisioning | `supabase/functions/clerk-webhook/index.ts` |
| Role self-selection | `src/pages/CompleteProfile.tsx`, `src/pages/ProfileSettings.tsx` |
| Role → account kind → plans | `src/lib/account-type.ts`, `src/lib/plans.ts` |
| Subscription/trial data | `src/hooks/use-subscription.ts`, `supabase/migrations/20260816000001_subscriptions.sql` |
| The paywall | `src/components/BillingGate.tsx`, routes in `src/App.tsx` |
| Billing page & admin rail | `src/pages/Billing.tsx`, `src/pages/Admin.tsx` |

---

## 1. Two audiences, two plans

The platform runs two separate businesses on one login (`account-type.ts`, `plans.ts`):

- **Hotel** — rooms, front desk, bookings, housekeeping, the hotel's own web page,
  staff roster & payroll. Plan: **Hotel $99.99/mo**.
- **Property management (PMS)** — rent ledger, utilities, expenses, maintenance,
  leases, tenants. Plan: **PMS $60.00/mo**. Bought by agencies **and** solo landlords
  (same job, different scale).

Both plans open with a **14-day free trial** (`TRIAL_DAYS = 14`).

```
role             → account kind   → plan        → can create
--------------------------------------------------------------
user (renter)    → none           → (none)      → nothing
agent            → agency         → pms         → rentals only
owner            → landlord       → pms         → rentals only
hotel_manager    → hotel          → hotel       → hotel rooms only
admin / semi     → platform       → (none)      → anything
```

The split gates **creation only**. Existing data from before the split keeps working
for anyone (`account-type.ts` — the constraint deliberately never hides/locks old rows,
and a user can switch their own role in Settings).

---

## 2. How a normal user creates an account

1. **Sign up** — Clerk's own screen (`/signup`). No app-level account logic; after signup
   Clerk redirects to **`/complete-profile`**.
2. **Accelerate behind the scenes** — the `clerk-webhook` edge function (verified Svix
   signature, then service-role key) creates the `profiles` row and a default `user_roles`
   row (`'user'`) on `user.created`. The browser can't be relied on to do this, so it's
   done server-side. A `BOOTSTRAP_ADMIN_IDS` secret mints the first platform admin.
3. **CompleteProfile** — the user picks **"I want to use Mogadishu Rents as a:"**
   (`Renter / Property Owner / Real Estate Agent / Hotel Manager`) and enters a **phone
   number**.
   - Renter & Agent → **auto-verified**.
   - Property Owner & Hotel Manager → land **unverified** and need admin verification
     (`CompleteProfile.tsx:78-82`) before they can fully act.
   - Phone goes to `profile_contacts` (private), **never** `profiles` (world-readable).
4. **Done** → role is written via `setPlatformRole()`, analytics fires `signup_completed`,
   user lands home.

A renter just browses: home → explore (`/properties`) → property detail (`/property/:id`)
→ WhatsApp contact / booking for hotels. They never touch a paid surface.

---

## 3. How a hotel manager creates an account

Exactly the same onboarding, with one difference at step 3: they pick **Hotel Manager**.
That makes them:
- **AccountKind `hotel`** → they buy the **Hotel plan** (`planForAccountKind`), and
- **`canCreateHotelListings` = true** → Add Property only offers `hotel` (they cannot list
  houses/apartments — `wrongAccountTypeMessage()` tells them to switch in Settings).

The hotel's **rooms** are ordinary `properties` rows (`type='hotel'`) created in the
Add-Property wizard. The hotel's **website** is built in `/manage/hotels/:id`
(`EditHotel.tsx`). Team staff are Clerk org members (`/team`, `Team.tsx`); hourly staff /
payroll are `hotel_staff` + `staff_payroll` (`/manage/staff`, `/manage/payroll`).

(There's also a **team invitation** flow — `/join/:token` redeems a single-use token via
`accept_hotel_invite_by_token`, `JoinHotel.tsx` — separate from platform signup.)

---

## 4. How they get the free trial

The trial is **not** automatic — it's started by an explicit click (a deliberate design:

> "a side effect that fires on render would mean one misplaced gate burns the trial clock
> for everyone who loads that route." — `BillingGate.tsx`)

Where the button appears:
- The **paywall lock panel**: on a paid route with `state === "none"` → **"Start 14-day
  free trial"**.
- The **Billing page** (`/billing`, `Billing.tsx`): a status card + "No card, no payment
  details up front."

Clicking calls `useStartTrial(plan)` → the **`start_trial` RPC** (SECURITY DEFINER). This
is the *only* self-serve write in the money layer:
- It writes `status = 'trialing'`, `trial_ends_at = now() + 14 days` — **fixed in SQL,
  never named by the browser**, so a user can't mint a longer trial.
- It's **idempotent** (`ON CONFLICT DO NOTHING` on the unique subject+plan row), so
  double-clicks can't open two trials **and a used trial can never be restarted** —
  calling it after expiry returns `'expired'`, not 14 fresh days.
- You can only start a trial for **your own** user id or your own org id.

Free trial = `trialing` **or** `active` is the entitlement test (`isEntitledState`).

---

## 5. How they get charged (there is no card)

> "Stripe does not support Somalia as a business location and this market pays by mobile
> money." — `plans.ts` / migration header

**There is no payment processor and no checkout redirect.** Charge is by **mobile money**,
and it is a **human, admin-confirmed exchange**:

1. The operator sends `$99.99` (Hotel) or `$60.00` (PMS) over **EVC Plus, Zaad, Sifalo
   Pay**, bank transfer, or cash — see `SUBSCRIPTION_PAYMENT_METHODS`.
2. A **platform admin** confirms the transfer actually landed and, in the Admin panel →
   **Billing** tab:
   - records a `subscription_payments` row (the immutable receipt, with `recorded_by`), and
   - **activates** the subscription in one step: `status = 'active'`,
     `current_period_end = ...` (`useRecordSubscriptionPayment`). Consecutive payments
     extend from `max(today, current_period_end)`, so they **add up** rather than overlap.

**Security model (SQL — this is money):**
- `subscriptions` and `subscription_payments`: **subscribers can only SELECT their own**.
  Every INSERT/UPDATE/DELETE is **platform-admin only**. There is no
  "users can update their own subscription" policy, so nobody can `UPDATE` themselves to
  `active` from the console.
- A future automated rail uses `settle_subscription_payment()` (service-role only,
  idempotent per `external_ref`) to record-and-activate in one transaction.

The **Billing page** (`/billing`) shows: current status, trial days left, both plans, and
every receipt they've paid (tagged by plan, newest first).

---

## 6. What happens if they don't pay — and what changes

Nothing runs a cron against the database, so the `status` column can go **stale** ("a row
written `trialing` on day 1 is still literally `trialing` on day 400"). Entitlement is
therefore computed **against the clock** each time it's asked — `effectiveSubscriptionState`
(client) mirrors `subscription_state()` (SQL) exactly:

- **Trial runs out** → `trialing` + `trial_ends_at <= now()` resolves to **`expired`**
  (the stored column still says `trialing`; the state function tells the truth).
- `expired` / `past_due` / `canceled` / `none` → **not entitled**.

### The behavior change (hard lock)

`BillingGate` behaves per state:

```
pending      → show the page  (render children)   ← never paywall on a loading query
trialing     → show page + a quiet "N days left" banner (goes red in the last 3 days)
active       → show page
everything else → HARD LOCK: the upgrade panel REPLACES the page
```

The lock is **hard, not read-only** — the gated page's children are **not rendered at
all**. It shows a lock screen saying the trial/payment ended and — prominently — **"Your
data is safe and untouched. Nothing has been deleted — every property, tenant, rent
record and document is exactly where you left it, and all of it comes back the moment
your subscription is active."** There's a button to pay/restart.

### Which routes are actually gated (`src/App.tsx`)

| Route | Plan gate |
|---|---|
| `/manage/property/:id` (unit workspace incl. rent ledger) | `pms` |
| `/manage/hotel` (front desk) | `hotel` |
| `/manage/hotels` (hotel pages index) | `hotel` |
| `/manage/hotels/:id` (hotel page editor) | `hotel` |
| `/manage/staff`, `/manage/payroll` | `hotel` |

Notes on what is **not** gated: `/manage` (the portfolio dashboard) and `/add-property`
are left open, and so are all *public* marketplace pages (a renter never pays).

### The one deliberate hole worth knowing

- **`active` is NOT auto-demoted** when `current_period_end` passes. With a manual rail,
  "paid by EVC on Sunday, admin confirms Tuesday" is routine, and locking a paying
  customer out because an admin was slow is worse than a few unbilled days. So a lapsed
  `active` stays `active` **until an admin deliberately sets `past_due` or `expired`**.
  Revenue can leak if nobody watches the admin Billing list (`subscriptionUrgency`
  sorts `past_due` → `expired` → trial-ending-≤3-days first so admins can chase).

---

## 7. Does the code do what it's supposed to? — findings

Verified behaviour, with the caveats an operator should know:

1. **The paywall is a client-side commercial control, not a security boundary.** The
   underlying business tables' RLS **never consults subscription status** — a determined
   API user could still reach data by hitting Supabase directly. The code says this is
   intentional ("this gate is a commercial control, not a security boundary"), and that
   it was chosen to *fail open* (never lock out paying customers on a network blip). The
   cost is a few minutes of unbilled access; the alternative was locking out the whole base.
2. **The trial is manual-start** (button), so an account that never clicks "Start trial"
   shows a lock if they reach a paid route — they must click once to begin.
3. **A trial can't accidentally run forever**: the `trialing_needs_end` CHECK constraint
   makes a `trialing` row without `trial_ends_at` un-creatable (that combo would have been
   a permanently-free account).
4. **The BillingGate was explicitly written to render children while `isPending`**, so a
   slow query never flashes "your access ended" at a paying customer — it locks only when
   the answer is known.
5. **Integration check**: the staff/payroll pages I added are wrapped in `BillingGate
   plan="hotel"`, consistent with the Hotel plan's feature list ("staff roster, payroll").

### One honest gap
- A non-admin cannot `UPDATE` their own subscription (correct), and the whole lock is
  UI-level. Because `/manage` itself is un-gated, an expired landlord can still see their
  **portfolio dashboard** (unit names/rent tiles) but is locked from the **unit workspace**
  where the ledger lives. If "don't pay" should hide the dashboard too, the gate needs
  mounting there as well — that's a product decision, not a bug.
