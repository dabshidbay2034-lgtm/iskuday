import { describe, expect, it } from "vitest";

import { PLANS, PLAN_COVERAGE, planById, plansCovering } from "@/lib/plans";

/**
 * The hotel plan is sold as "Hotel Management + PMS" and its feature list
 * promises the PMS product. That promise lived only in marketing copy —
 * `useMySubscription` matched the plan exactly, so a hotel manager paying
 * $99.99 was refused at every `BillingGate plan="pms"`, which is the whole of
 * `/manage/property/:id`.
 *
 * These pin the relationship so the copy and the gate cannot drift apart again.
 */
describe("what one plan covers", () => {
  it("lets the hotel plan satisfy a PMS gate", () => {
    expect(plansCovering("pms")).toContain("hotel");
  });

  it("does NOT let the PMS plan satisfy a hotel gate", () => {
    // Not symmetric on purpose: hotel operations are the difference the higher
    // price buys. If this ever passes, the cheaper plan is getting the dearer
    // product.
    expect(plansCovering("hotel")).not.toContain("pms");
  });

  it("always covers itself", () => {
    for (const plan of PLANS) {
      expect(plansCovering(plan.id)).toContain(plan.id);
    }
  });

  it("names only real plans", () => {
    const known = PLANS.map((p) => p.id);
    for (const covers of Object.values(PLAN_COVERAGE)) {
      for (const id of covers) expect(known).toContain(id);
    }
  });

  it("covers every plan in the catalogue, so a new one cannot be forgotten", () => {
    expect(Object.keys(PLAN_COVERAGE).sort()).toEqual(PLANS.map((p) => p.id).sort());
  });
});

describe("the promise the coverage exists to keep", () => {
  it("the hotel plan advertises the PMS tools it now actually grants", () => {
    // If somebody rewrites the feature list and drops this, the coverage rule
    // above becomes a rule with no stated reason — and the next person deletes
    // it. This test is the link between the two.
    const hotel = planById("hotel");
    const mentionsPms = hotel.features.some((f) => /pms|rent ledger|lease|tenant/i.test(f));
    expect(mentionsPms).toBe(true);
  });

  it("prices the bundle above the PMS plan", () => {
    expect(planById("hotel").priceUsd).toBeGreaterThan(planById("pms").priceUsd);
  });
});
