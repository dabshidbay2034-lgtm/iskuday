/**
 * What a property type MEANS — how it earns, and whether it takes bookings.
 *
 * Before BnBs existed, "hotel" was a proxy for three unrelated things scattered
 * across the codebase as `type === "hotel"`:
 *
 *   1. it earns by the night, not the month   (price labels, structured data)
 *   2. it can be booked                       (booking form, bookings card)
 *   3. it belongs to a hotel business         (page builder, account split)
 *
 * A BnB is (1) and (2) but emphatically not (3): it is a unit in a landlord's
 * portfolio, not a building with a front desk and a public website. Adding it
 * by widening every `=== "hotel"` in place would have silently dragged the
 * hotel page builder along with it, so the three meanings are separated here
 * and each call site says which one it wants.
 *
 * `accountKind` in ./account-type.ts answers a different question — what KIND
 * OF BUSINESS an account is. This module is about the unit, not the owner.
 */

/** Types billed per night rather than per month. */
const NIGHTLY_TYPES: readonly string[] = ["hotel", "bnb"];

/** Types a member of the public can reserve online. */
const BOOKABLE_TYPES: readonly string[] = ["hotel", "bnb"];

/**
 * Does this type earn by the night?
 *
 * Drives the "/night" vs "/month" label and `is_daily_rate` on creation. Kept
 * separate from `isBookableType` even though the two lists match today: a
 * nightly type that isn't self-service bookable is a plausible next step, and
 * one shared constant would make that a silent behaviour change.
 */
export function isNightlyRateType(type: string | null | undefined): boolean {
  return !!type && NIGHTLY_TYPES.includes(type);
}

/**
 * Can this type take reservations?
 *
 * Mirrors the SQL guard in 20260819000002 — `type IN ('hotel','bnb')`. This is
 * presentation only: the database refuses a booking for anything else whatever
 * the client believes, because PostgREST is reachable with the anon key that
 * ships in the bundle.
 */
export function isBookableType(type: string | null | undefined): boolean {
  return !!type && BOOKABLE_TYPES.includes(type);
}

/**
 * Belongs to a HOTEL business — the page builder, the front desk, the account
 * split. Deliberately narrow: a BnB must never match this.
 */
export function isHotelBusinessType(type: string | null | undefined): boolean {
  return type === "hotel";
}

/*
 * Labels and badge colours deliberately DO NOT live here — ./property-display.ts
 * is the single source of truth for how a type is shown, and it already folds
 * the `villa`/`house` split that a second map here would get wrong. This module
 * answers only "how does it earn, and can it be booked".
 */
