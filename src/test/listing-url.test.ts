import { describe, expect, it } from "vitest";

import { idFromListingParam, listingPath, listingSlug, slugify } from "@/lib/listing-url";
import type { ListingSeoInput } from "@/lib/listing-seo";

const base: ListingSeoInput = {
  title: "modern 2-bedrooms",
  type: "apartment",
  location: "Wadajir",
  price: 250,
  bedrooms: 2,
  toilets: 1,
  isNightly: false,
};

const ID = "b6b54397-fd91-4726-b93a-1b440c48fe36";

describe("resolving a listing from its URL", () => {
  it("reads the id out of a slug URL", () => {
    expect(idFromListingParam(`2-bedroom-1-bathroom-apartment-in-wadajir-${ID}`)).toBe(ID);
  });

  it("still accepts a bare uuid", () => {
    // Every link shared before slugs existed is this shape. They must keep
    // resolving forever — that is the whole reason the uuid stayed in the URL.
    expect(idFromListingParam(ID)).toBe(ID);
  });

  it("resolves a STALE slug to the same listing", () => {
    // The slug is derived, not stored, so an owner renaming their listing
    // changes it. The old link keeps working because only the tail identifies.
    expect(idFromListingParam(`whatever-the-title-used-to-be-${ID}`)).toBe(ID);
  });

  it("is case-insensitive about the uuid", () => {
    expect(idFromListingParam(ID.toUpperCase())).toBe(ID);
  });

  it("returns null for anything without a uuid", () => {
    expect(idFromListingParam("2-bedroom-apartment-in-wadajir")).toBeNull();
    expect(idFromListingParam("")).toBeNull();
    expect(idFromListingParam(undefined)).toBeNull();
    expect(idFromListingParam(null)).toBeNull();
  });

  it("ignores a uuid that is not at the end", () => {
    // Otherwise a crafted path could resolve to a listing the slug does not
    // describe, and the canonical redirect would bounce between two URLs.
    expect(idFromListingParam(`${ID}-and-then-some-words`)).toBeNull();
  });
});

describe("building a listing URL", () => {
  it("puts the searchable phrase in front of the id", () => {
    expect(listingPath(ID, base)).toBe(
      `/property/2-bedroom-1-bathroom-apartment-in-wadajir-${ID}`,
    );
  });

  it("round-trips: every path it builds, it can read back", () => {
    expect(idFromListingParam(listingPath(ID, base).replace("/property/", ""))).toBe(ID);
  });

  it("falls back to the bare id when there is nothing to say", () => {
    const blank: ListingSeoInput = { title: "", price: 0, isNightly: false };
    expect(listingPath(ID, blank)).toBe(`/property/${ID}`);
  });

  it("drops room counts for nightly stock, matching the title", () => {
    // "1-bedroom-1-bathroom-hotel" is not how anyone searches for a room.
    const room = { ...base, type: "hotel", isNightly: true, bedrooms: 1, toilets: 1 };
    expect(listingSlug(room)).toBe("hotel-room-in-wadajir");
  });
});

describe("slugify", () => {
  it("folds diacritics rather than dropping the letter", () => {
    expect(slugify("Hodän")).toBe("hodan");
  });

  it("collapses runs of separators", () => {
    expect(slugify("3 Bedroom  —  Apartment")).toBe("3-bedroom-apartment");
  });

  it("never leaves a leading or trailing hyphen", () => {
    // A trailing one would double up against the hyphen joining the uuid.
    expect(slugify("  spaced  ")).toBe("spaced");
    expect(slugify("!!!weird!!!")).toBe("weird");
  });

  it("caps length without leaving a dangling hyphen", () => {
    const long = slugify("a".repeat(50) + " " + "b".repeat(50));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });

  it("survives a title with no latin characters at all", () => {
    expect(slugify("محل")).toBe("");
  });
});
