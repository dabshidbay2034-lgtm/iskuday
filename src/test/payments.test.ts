import { describe, expect, it } from "vitest";

import {
  GATEWAYS,
  PAYMENT_OPTIONS,
  amountDueLater,
  amountDueNow,
  clampPercent,
  gatewayMeta,
  looksLikeAccount,
  normaliseAccount,
  offeredOptions,
} from "@/lib/payments";

/**
 * The amount rules are DUPLICATED in supabase/functions/sifalo-payment/index.ts,
 * because an edge function cannot import from the app bundle. These tests are
 * what keeps the two honest: if someone changes the rounding here without
 * changing it there, a guest is quoted one figure and charged another.
 *
 * If you edit anything in this block, open that file and make the same edit.
 */
describe("what the guest pays now", () => {
  it("charges the whole total on pay_now", () => {
    expect(amountDueNow(450, "pay_now", 25)).toBe(450);
  });

  it("charges nothing when they pay at the hotel", () => {
    expect(amountDueNow(450, "at_hotel", 25)).toBe(0);
    expect(amountDueLater(450, "at_hotel", 25)).toBe(450);
  });

  it("takes the hotel's deposit share, not a hardcoded quarter", () => {
    expect(amountDueNow(400, "deposit", 25)).toBe(100);
    expect(amountDueNow(400, "deposit", 50)).toBe(200);
    expect(amountDueNow(400, "deposit", 10)).toBe(40);
  });

  it("rounds a deposit UP, never down", () => {
    // 25% of 75.55 is 18.8875. Rounding down leaves a fraction uncollected on
    // every booking, and a hotel reconciling against the provider's statement
    // finds every line a cent short — which reads as a platform bug long
    // before anyone suspects rounding.
    expect(amountDueNow(75.55, "deposit", 25)).toBe(18.89);
    expect(amountDueNow(10, "deposit", 33)).toBe(3.3);
  });

  it("splits the total exactly, with nothing lost between the halves", () => {
    const total = 333.33;
    const now = amountDueNow(total, "deposit", 25);
    const later = amountDueLater(total, "deposit", 25);
    expect(Number((now + later).toFixed(2))).toBe(total);
  });

  it("never asks for a negative balance on arrival", () => {
    // A hotel that somehow stores 100% takes everything; the guest must not be
    // shown a refund they are not getting.
    expect(amountDueLater(200, "deposit", 100)).toBe(0);
  });
});

describe("deposit percentage", () => {
  it("falls back to the product default when it is nonsense", () => {
    // A 0% deposit is a free stay and a 150% deposit is a fraud report. Both
    // are configuration accidents, and the default is safer than either.
    expect(clampPercent(0)).toBe(25);
    expect(clampPercent(150)).toBe(25);
    expect(clampPercent(null)).toBe(25);
    expect(clampPercent(undefined)).toBe(25);
    expect(clampPercent(Number.NaN)).toBe(25);
  });

  it("keeps a sane value", () => {
    expect(clampPercent(1)).toBe(1);
    expect(clampPercent(40)).toBe(40);
    expect(clampPercent(100)).toBe(100);
  });
});

describe("what a hotel offers", () => {
  it("keeps the canonical order regardless of how the row was written", () => {
    expect(offeredOptions(["at_hotel", "pay_now"])).toEqual(["pay_now", "at_hotel"]);
  });

  it("drops values it does not recognise", () => {
    expect(offeredOptions(["pay_now", "bitcoin"])).toEqual(["pay_now"]);
  });

  it("falls back to paying at the hotel rather than to nothing", () => {
    // A booking form with no way to proceed is worse than one that takes the
    // booking and asks for money at the desk — which is how every hotel here
    // operated before online payment existed.
    expect(offeredOptions([])).toEqual(["at_hotel"]);
    expect(offeredOptions(null)).toEqual(["at_hotel"]);
    expect(offeredOptions(["nonsense"])).toEqual(["at_hotel"]);
  });

  it("covers every option the type allows", () => {
    expect(offeredOptions([...PAYMENT_OPTIONS])).toEqual(PAYMENT_OPTIONS);
  });
});

describe("mobile money accounts", () => {
  it("strips the ways people actually type a number", () => {
    expect(normaliseAccount("+252 61 555 0142")).toBe("252615550142");
    expect(normaliseAccount("061-5550142")).toBe("0615550142");
  });

  it("catches typing accidents without out-guessing the provider", () => {
    // Deliberately loose: a validator stricter than the provider rejects paying
    // customers, which costs far more than passing a bad number through and
    // surfacing the provider's own error.
    expect(looksLikeAccount("615550142")).toBe(true);
    expect(looksLikeAccount("+252 61 555 0142")).toBe(true);
    expect(looksLikeAccount("123")).toBe(false);
    expect(looksLikeAccount("guest@email.com")).toBe(false);
    expect(looksLikeAccount("")).toBe(false);
  });
});

describe("gateways", () => {
  it("leads with the largest network in Mogadishu", () => {
    // A guest scanning the list should find theirs without reading it.
    expect(GATEWAYS[0].key).toBe("evcplus");
  });

  it("has unique keys, since they are stored on every payment row", () => {
    const keys = GATEWAYS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks cards as not taking a phone number", () => {
    expect(gatewayMeta("card")?.usesPhone).toBe(false);
    expect(gatewayMeta("evcplus")?.usesPhone).toBe(true);
  });

  it("returns nothing for a gateway it does not know", () => {
    expect(gatewayMeta("paypal")).toBeUndefined();
  });
});
