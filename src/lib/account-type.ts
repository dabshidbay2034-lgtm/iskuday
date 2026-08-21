import type { UserRole } from "@/lib/types";

/**
 * What KIND of business an account is, derived from the platform role.
 *
 * The platform used to let every account do everything: one login could list
 * apartments, run a hotel front desk and publish a hotel website. Those are
 * different businesses with different staff and different money, so the roles
 * now mean something:
 *
 *   agent          → a letting AGENCY. Rentals only, never hotels.
 *   hotel_manager  → a HOTEL, and a landlord too: rooms, bookings,
 *                    housekeeping and hotel pages, PLUS everything an owner
 *                    gets, because the hotel plan bundles the PMS.
 *   owner          → a solo landlord. Rentals, same as an agency.
 *   admin          → unrestricted.
 *
 * ── THE CONSTRAINT THAT SHAPES ALL OF THIS ─────────────────────────────────
 * These rules gate CREATION ONLY. Accounts that predate the split already own
 * a mix, and stranding a hotelier from the rooms they are actively letting
 * would be a far worse bug than the one being fixed. So nothing here is used
 * to hide, filter or lock EXISTING records — `/manage` still lists whatever
 * the database returns.
 *
 * ── THE ESCAPE HATCH IS GONE — DO NOT WRITE MESSAGES THAT ASSUME IT ────────
 * This header used to end "an account on the wrong side of the line changes
 * its own role in Settings". That is no longer true: 20260908000001 freezes
 * the account type once it is chosen, and again once a plan starts. Anything
 * telling a user to switch their account type is now telling them to look for
 * a control that is deliberately absent — say "contact support" instead.
 *
 * `properties.type` and `PropertyType` in src/lib/types.ts now agree on
 * `villa`. `house` is accepted on the way in only — see property-display.ts.
 */

export type AccountKind = "agency" | "hotel" | "landlord" | "platform" | "none";

/** The `properties.type` values as stored in Postgres. Matches `PropertyType`. */
export type DbPropertyType = "villa" | "apartment" | "hotel" | "bnb" | "commercial";

/**
 * A BnB is a RENTAL type, not a hotel type.
 *
 * It is billed nightly and takes bookings like a hotel room, but it belongs to
 * a landlord's portfolio rather than to a hotel business — so an agency or a
 * solo owner lists one, and a hotel account does not. That also means it needs
 * no change to the account-type trigger in 20260812000002, whose rule is
 * "hotel ⇔ hotel_manager": `bnb` falls on the non-hotel side by construction.
 *
 * What makes it nightly and bookable lives in ./property-kind.ts; this list is
 * only about who may CREATE one.
 */
const RENTAL_TYPES: DbPropertyType[] = ["villa", "apartment", "bnb", "commercial"];
const HOTEL_TYPES: DbPropertyType[] = ["hotel"];
const ALL_TYPES: DbPropertyType[] = ["villa", "apartment", "hotel", "bnb", "commercial"];

export function accountKind(role: UserRole | null | undefined): AccountKind {
  switch (role) {
    case "agent": return "agency";
    case "hotel_manager": return "hotel";
    case "owner": return "landlord";
    case "admin":
    case "semi_admin": return "platform";
    default: return "none";
  }
}

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  agency: "Agency",
  hotel: "Hotel",
  landlord: "Property owner",
  platform: "Platform",
  none: "Renter",
};

/**
 * Which `properties.type` values this account may CREATE.
 *
 * ── WHY A HOTEL ACCOUNT GETS EVERYTHING ─────────────────────────────────────
 * It used to get HOTEL_TYPES only, matching the trigger in 20260812000002. The
 * pricing has since reversed that: the `hotel` plan is sold as "Hotel
 * Management + PMS" for one price, and PLAN_COVERAGE lets it satisfy every PMS
 * gate. A hotelier who also owns apartments was reaching the rent ledger and
 * the tenant records they had paid for, with no way to put a building behind
 * them. 20260910000002 removes the matching database rule; this is the half
 * the user can see.
 *
 * The other direction is unchanged and deliberate — an agency or landlord
 * still cannot create `hotel`. That rule is "hotel rooms require a hotel
 * account", which is about bookings, housekeeping and a front desk, and it was
 * never meant to be symmetric.
 */
export function allowedPropertyTypes(role: UserRole | null | undefined): DbPropertyType[] {
  switch (accountKind(role)) {
    case "hotel": return ALL_TYPES;
    case "agency":
    case "landlord": return RENTAL_TYPES;
    case "platform": return ALL_TYPES;
    default: return [];
  }
}

export function canCreatePropertyType(
  role: UserRole | null | undefined,
  type: string | null | undefined,
): boolean {
  if (!type) return false;
  // Accept the pre-migration "house" spelling from old links and stale clients.
  const normalised = type === "house" ? "villa" : type;
  return allowedPropertyTypes(role).includes(normalised as DbPropertyType);
}

/** Hotel rooms, the front desk, bookings and housekeeping. */
export function canCreateHotelListings(role: UserRole | null | undefined): boolean {
  return canCreatePropertyType(role, "hotel");
}

/** The hotel website builder (`/manage/hotels`). */
export function canManageHotelPages(role: UserRole | null | undefined): boolean {
  const kind = accountKind(role);
  return kind === "hotel" || kind === "platform";
}

/** Villas / apartments / commercial. */
export function canListRentals(role: UserRole | null | undefined): boolean {
  return allowedPropertyTypes(role).some((t) => t !== "hotel");
}

/**
 * One line explaining a refusal, for the UI to show instead of a dead end.
 *
 * None of these may say "switch your account type" any more — see the note in
 * this file's header. A renter has genuinely not chosen yet, so Settings is
 * the right destination for them and only them; everyone else is frozen and
 * has to be sent to a human.
 */
export function wrongAccountTypeMessage(role: UserRole | null | undefined): string {
  switch (accountKind(role)) {
    case "hotel":
      // Reachable only for a type a hotel account genuinely cannot create,
      // which after 20260910000002 is none of them. Kept honest rather than
      // deleted, in case a future type is added with narrower rules.
      return "Your hotel account can't list this kind of property. Contact support if you think it should.";
    case "agency":
    case "landlord":
      return "Hotel rooms need a Hotel account — they come with bookings, housekeeping and a front desk. Contact support to change your account type.";
    default:
      return "Choose an account type in Settings before listing a property.";
  }
}
