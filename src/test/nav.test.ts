import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isNavItemActive, visibleNavItems } from "@/lib/nav";

const RENTER = { canManageProperties: false, hasOrg: false };
const LANDLORD = { canManageProperties: true, hasOrg: false };
const AGENCY = { canManageProperties: true, hasOrg: true };

/**
 * The header used to hand-write its list twice — once for the desktop bar and
 * once for the mobile sheet — and the two had drifted: the same route was
 * "Explore" on one and "All Properties" on the other, and "About" sat in a
 * different position in each. Both layouts now render from NAV_ITEMS, so these
 * tests cover both at once.
 */
describe("what a visitor sees", () => {
  it("shows a renter four entries and no business tools", () => {
    const ids = visibleNavItems(RENTER).map((i) => i.id);
    expect(ids).toEqual(["explore", "services", "owners", "about"]);
  });

  it("stops pitching to somebody who already manages listings", () => {
    // "For owners" is the sales page. Aimed at an existing customer it is just
    // an entry they never press, and it is what kept the bar at eight items.
    expect(visibleNavItems(LANDLORD).map((i) => i.id)).not.toContain("owners");
    expect(visibleNavItems(RENTER).map((i) => i.id)).toContain("owners");
  });

  it("gives a solo landlord Manage but not Team", () => {
    const ids = visibleNavItems(LANDLORD).map((i) => i.id);
    expect(ids).toContain("manage");
    // Team is Clerk-organization staff. A landlord with no agency has no team.
    expect(ids).not.toContain("team");
  });

  it("gives an agency both Manage and Team", () => {
    const ids = visibleNavItems(AGENCY).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["manage", "team"]));
  });

  it("never shows more than five entries to anyone", () => {
    // The whole point of the rewrite. It was eight.
    for (const ctx of [RENTER, LANDLORD, AGENCY]) {
      expect(visibleNavItems(ctx).length).toBeLessThanOrEqual(5);
    }
  });

  it("keeps a stable order for everyone", () => {
    // Order comes from the array, never from the branch that rendered it, so a
    // visitor moving between phone and laptop reads the same map.
    for (const ctx of [RENTER, LANDLORD, AGENCY]) {
      const ids = visibleNavItems(ctx).map((i) => i.id);
      const canonical = NAV_ITEMS.map((i) => i.id).filter((id) => ids.includes(id));
      expect(ids).toEqual(canonical);
    }
  });

  it("has no duplicate destinations", () => {
    // "Explore" and "Categories" both pointed at /properties before this.
    const paths = NAV_ITEMS.map((i) => i.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("does not repeat the logo's job", () => {
    // "Home" sat immediately right of a logo that already links to "/".
    expect(NAV_ITEMS.map((i) => i.to)).not.toContain("/");
  });
});

describe("telling the visitor where they are", () => {
  /**
   * Nothing computed this before: "Home" was hard-coded to the active colour,
   * so the bar claimed you were on the home page from every page on the site.
   */
  it("lights the entry for the current page", () => {
    expect(isNavItemActive("/services", "/services")).toBe(true);
  });

  it("does not light the others", () => {
    expect(isNavItemActive("/services", "/properties")).toBe(false);
    expect(isNavItemActive("/services", "/about")).toBe(false);
  });

  it("keeps the parent lit on a child route", () => {
    // A property detail page is still "Explore".
    expect(isNavItemActive("/properties/villa-in-hodan-abc", "/properties")).toBe(true);
  });

  it("is not fooled by a prefix that is a different word", () => {
    // /servicesomething must not light /services.
    expect(isNavItemActive("/servicesomething", "/services")).toBe(false);
  });

  it("treats the home path as exact", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/properties", "/")).toBe(false);
  });

  it("ignores the query string, so a filtered view is still Explore", () => {
    // The category links are /properties?type=villa and live inside Explore.
    // useLocation().pathname excludes the query, which is what makes that work.
    expect(isNavItemActive("/properties", "/properties")).toBe(true);
  });
});
