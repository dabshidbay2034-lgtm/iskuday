import { describe, expect, it } from "vitest";

import {
  accountKind,
  allowedPropertyTypes,
  canCreatePropertyType,
  canListRentals,
  wrongAccountTypeMessage,
} from "@/lib/account-type";
import { PLAN_COVERAGE } from "@/lib/plans";
import type { UserRole } from "@/lib/types";

/**
 * The hotel plan is sold as "Hotel Management + PMS" for one price, and
 * PLAN_COVERAGE lets it satisfy every PMS gate. For a while the database
 * disagreed: properties_enforce_account_type() refused every non-hotel property
 * from a hotel_manager, so the customer reached the rent ledger and the tenant
 * records they had paid for and could not put a single building behind them.
 *
 * 20260910000002 removed that rule. These pin both halves so the billing
 * promise and the creation rule cannot drift apart again.
 */
describe("a hotel account is a landlord too", () => {
  it("may create ordinary rental types", () => {
    for (const type of ["villa", "apartment", "bnb", "commercial"] as const) {
      expect(canCreatePropertyType("hotel_manager", type)).toBe(true);
    }
  });

  it("may still create hotel rooms", () => {
    expect(canCreatePropertyType("hotel_manager", "hotel")).toBe(true);
  });

  it("counts as able to list rentals at all", () => {
    // canListRentals gates whole screens; a false here is the paid-for-but-
    // locked-out state the migration exists to end.
    expect(canListRentals("hotel_manager")).toBe(true);
  });

  it("is consistent with the plan that bundles the PMS", () => {
    // If hotel ever stops covering pms, this rule loses its justification and
    // somebody should reconsider it rather than find this test mysterious.
    expect(PLAN_COVERAGE.hotel).toContain("hotel");
    expect(PLAN_COVERAGE.pms).toContain("hotel");
  });
});

describe("the rule that is deliberately NOT symmetric", () => {
  it("still refuses hotel rooms to agencies and landlords", () => {
    // Hotel rooms carry bookings, housekeeping and a front desk. That is what
    // the hotel plan buys, and it stays gated.
    for (const role of ["agent", "owner"] as UserRole[]) {
      expect(canCreatePropertyType(role, "hotel")).toBe(false);
    }
  });

  it("still lets agencies and landlords list every rental type", () => {
    for (const role of ["agent", "owner"] as UserRole[]) {
      for (const type of ["villa", "apartment", "bnb", "commercial"] as const) {
        expect(canCreatePropertyType(role, type)).toBe(true);
      }
    }
  });

  it("lets a renter create nothing until they choose", () => {
    expect(allowedPropertyTypes("user")).toHaveLength(0);
    expect(allowedPropertyTypes(null)).toHaveLength(0);
  });

  it("leaves admin unrestricted", () => {
    expect(accountKind("admin")).toBe("platform");
    expect(canCreatePropertyType("admin", "hotel")).toBe(true);
    expect(canCreatePropertyType("admin", "villa")).toBe(true);
  });
});

describe("refusal messages after the account type was frozen", () => {
  /**
   * 20260908000001 makes the account type a one-time choice, so telling anyone
   * except a renter to "switch your account type in Settings" sends them to
   * look for a control that is deliberately absent.
   */
  const roles: UserRole[] = ["hotel_manager", "agent", "owner"];

  it("never tells a frozen account to switch its type", () => {
    for (const role of roles) {
      expect(wrongAccountTypeMessage(role)).not.toMatch(/switch/i);
    }
  });

  it("sends frozen accounts to a human instead", () => {
    for (const role of roles) {
      expect(wrongAccountTypeMessage(role)).toMatch(/support/i);
    }
  });

  it("still sends a renter to Settings, where the choice really is", () => {
    // The one role that CAN act on its own — set_my_role() accepts a change
    // from 'user'.
    expect(wrongAccountTypeMessage("user")).toMatch(/settings/i);
  });
});
