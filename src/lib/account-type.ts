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
 *   hotel_manager  → a HOTEL. Rooms, bookings, housekeeping, hotel pages.
 *   owner          → a solo landlord. Rentals, same as an agency.
 *   admin          → unrestricted.
 *
 * ── THE CONSTRAINT THAT SHAPES ALL OF THIS ─────────────────────────────────
 * These rules gate CREATION ONLY. Accounts that predate the split already own
 * a mix, and stranding a hotelier from the rooms they are actively letting
 * would be a far worse bug than the one being fixed. So nothing here is used
 * to hide, filter or lock EXISTING records — `/manage` still lists whatever
 * the database returns. An account on the wrong side of the line changes its
 * own role in Settings (ProfileSettings self-upgrade), and its existing data
 * keeps working the whole time.
 *
 * The DB enum is `villa` where the UI says `house`; both spellings appear
 * below because `properties.type` stores the former and `PropertyType` in
 * src/lib/types.ts declares the latter.
 */

export type AccountKind = "agency" | "hotel" | "landlord" | "platform" | "none";

/** The `properties.type` values as stored in Postgres (note `villa`, not `house`). */
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

/** Which `properties.type` values this account may CREATE. */
export function allowedPropertyTypes(role: UserRole | null | undefined): DbPropertyType[] {
  switch (accountKind(role)) {
    case "hotel": return HOTEL_TYPES;
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
  // Accept the UI's "house" alias for the stored "villa".
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

/** One line explaining a refusal, for the UI to show instead of a dead end. */
export function wrongAccountTypeMessage(role: UserRole | null | undefined): string {
  switch (accountKind(role)) {
    case "hotel":
      return "Hotel accounts list hotel rooms. To rent out houses or apartments, switch your account type in Settings.";
    case "agency":
    case "landlord":
      return "Rental accounts list houses, apartments, BnB and commercial space. To list hotel rooms, switch to a Hotel account in Settings.";
    default:
      return "Your account can't list properties yet. Choose an account type in Settings.";
  }
}
