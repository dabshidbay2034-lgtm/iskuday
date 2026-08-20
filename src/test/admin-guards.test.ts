import { describe, expect, it } from "vitest";

import { roleChangeBlockedReason } from "@/lib/admin-guards";
import type { UserRole } from "@/lib/types";

/**
 * The platform admin panel renders every user as a card with a role dropdown,
 * and the signed-in admin's own card sits in that list looking like the rest.
 * Choosing "Renter" on it used to run an update that RLS allowed — the caller
 * is an admin at the moment of the call — and the platform was left with no
 * administrator, with no way back in through the product.
 *
 * These pin the rules that stop it. The database enforces the last-admin case
 * independently (20260909000001); this is the half the operator can see.
 */

const ME = "user_me";
const OTHER = "user_other";
const ctx = (adminCount: number, currentUserId: string | null = ME) => ({
  adminCount,
  currentUserId,
});

describe("removing the last platform admin", () => {
  it("refuses to demote the only admin", () => {
    expect(
      roleChangeBlockedReason({ userId: ME, role: "admin" }, "user", ctx(1)),
    ).toMatch(/last admin/i);
  });

  it("refuses even when the only admin is somebody else", () => {
    // Being signed in as a different admin does not help: if the count is 1,
    // the row being edited IS the last one.
    expect(
      roleChangeBlockedReason({ userId: OTHER, role: "admin" }, "owner", ctx(1)),
    ).toMatch(/last admin/i);
  });

  it("names the way out rather than just refusing", () => {
    const reason = roleChangeBlockedReason(
      { userId: ME, role: "admin" }, "user", ctx(1),
    );
    expect(reason).toMatch(/promote/i);
  });
});

describe("an admin demoting themselves", () => {
  it("is refused even when other admins exist", () => {
    expect(
      roleChangeBlockedReason({ userId: ME, role: "admin" }, "user", ctx(3)),
    ).toMatch(/your own/i);
  });

  it("does not block demoting a DIFFERENT admin", () => {
    // Ordinary staff management. Must stay one click.
    expect(
      roleChangeBlockedReason({ userId: OTHER, role: "admin" }, "user", ctx(3)),
    ).toBeNull();
  });

  it("is not confused by a signed-out or unresolved viewer", () => {
    // currentUserId is null while Clerk is still loading. That must not
    // accidentally match a row whose userId is also missing.
    expect(
      roleChangeBlockedReason({ userId: OTHER, role: "admin" }, "user", ctx(3, null)),
    ).toBeNull();
  });
});

describe("what stays permitted", () => {
  it("always allows promoting TO admin", () => {
    // This is the documented escape from both refusals, so it can never be
    // blocked — including promoting the last admin to admin (a no-op).
    for (const count of [0, 1, 5]) {
      for (const role of ["user", "owner", "hotel_manager", "agent", "semi_admin", "admin"] as UserRole[]) {
        expect(
          roleChangeBlockedReason({ userId: ME, role }, "admin", ctx(count)),
        ).toBeNull();
      }
    }
  });

  it("never restricts a non-admin row", () => {
    const roles: UserRole[] = ["user", "owner", "hotel_manager", "agent", "semi_admin"];
    for (const from of roles) {
      for (const to of roles) {
        expect(
          roleChangeBlockedReason({ userId: ME, role: from }, to, ctx(1)),
        ).toBeNull();
      }
    }
  });

  it("lets a semi_admin be changed freely even as the last one", () => {
    // semi_admin is read-only and carries no lockout risk — losing every
    // semi_admin costs nothing that an admin cannot restore.
    expect(
      roleChangeBlockedReason({ userId: ME, role: "semi_admin" }, "user", ctx(0)),
    ).toBeNull();
  });
});
