import { describe, expect, it } from "vitest";

import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import {
  ALL_FACETS,
  FACET_MIN_LISTINGS,
  facetMatches,
  facetSlugFor,
  findFacet,
  relatedFacets,
} from "@/lib/facets";
import {
  listingSeoDescription,
  listingSeoTitle,
  listingSpecPhrase,
  type ListingSeoInput,
} from "@/lib/listing-seo";
import { facetSlugsWithInventory } from "../../scripts/facet-urls.mjs";

describe("facet catalogue", () => {
  it("has no duplicate slugs", () => {
    const slugs = ALL_FACETS.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("emits URL-safe slugs", () => {
    for (const facet of ALL_FACETS) {
      expect(facet.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("resolves a slug back to the facet that produced it", () => {
    for (const facet of ALL_FACETS) {
      expect(findFacet(facet.slug)).toBe(facet);
    }
  });

  it("rejects slugs it does not own", () => {
    // The 404 path. An unrecognised slug must not resolve to a nearby facet —
    // rendering "9 bedroom mansions" as the apartments page would publish a
    // page whose heading and content disagree.
    expect(findFacet("9-bedroom-mansions-in-atlantis")).toBeNull();
    expect(findFacet("")).toBeNull();
    expect(findFacet(undefined)).toBeNull();
  });

  it("covers the districts that actually hold inventory", () => {
    for (const district of ["Hodan", "Wadajir", "Hamar Jajab"]) {
      expect(MOGADISHU_DISTRICTS).toContain(district);
      expect(findFacet(`apartments-in-${district.toLowerCase().replace(/\s+/g, "-")}`)).not.toBeNull();
    }
  });

  it("says hotel rooms are available, not for rent", () => {
    // "Hotel Rooms for Rent" reads as a mistake — a room is booked by the night.
    expect(findFacet("hotel-rooms-in-mogadishu")?.heading).toBe("Hotel Rooms in Mogadishu");
    expect(findFacet("apartments-in-mogadishu")?.heading).toBe(
      "Apartments for Rent in Mogadishu",
    );
  });

  it("gives no bedroom pages to hotels", () => {
    // A hotel row's bedroom count is an artefact of the shared listing form.
    expect(findFacet("1-bedroom-hotel-rooms-in-mogadishu")).toBeNull();
  });
});

describe("facetMatches", () => {
  const facet = findFacet("3-bedroom-apartments-in-mogadishu")!;

  it("requires an EXACT bedroom count, not a minimum", () => {
    // The bedrooms control on /properties is a minimum ("3+"), which is right
    // for a shopper and wrong for a page titled "3 Bedroom Apartments".
    expect(facetMatches(facet, { type: "apartment", bedrooms: 3 })).toBe(true);
    expect(facetMatches(facet, { type: "apartment", bedrooms: 4 })).toBe(false);
    expect(facetMatches(facet, { type: "apartment", bedrooms: 2 })).toBe(false);
  });

  it("requires the type to match", () => {
    expect(facetMatches(facet, { type: "villa", bedrooms: 3 })).toBe(false);
  });

  it("checks district only when the facet has one", () => {
    const cityWide = findFacet("apartments-in-mogadishu")!;
    const inHodan = findFacet("apartments-in-hodan")!;
    expect(facetMatches(cityWide, { type: "apartment", location: "Yaqshid" })).toBe(true);
    expect(facetMatches(inHodan, { type: "apartment", location: "Yaqshid" })).toBe(false);
    expect(facetMatches(inHodan, { type: "apartment", location: "Hodan" })).toBe(true);
  });
});

describe("facetSlugFor", () => {
  it("maps a query-param combination onto its path twin", () => {
    // This is what lets /properties?type=apartment&district=Hodan canonicalise
    // to the path page instead of competing with it.
    expect(facetSlugFor({ type: "apartment", district: "Hodan" })).toBe("apartments-in-hodan");
    expect(facetSlugFor({ type: "apartment" })).toBe("apartments-in-mogadishu");
  });

  it("carries a bedroom count onto a type that supports one", () => {
    // The lookup behind the filter pills. Standing on 2-bedroom apartments and
    // clicking "Villas" should land on 2-bedroom villas, not throw the count
    // away — the user narrowed by bedrooms and did not un-narrow it.
    expect(facetSlugFor({ type: "villa", bedrooms: 2 })).toBe("2-bedroom-villas-in-mogadishu");
  });

  it("has no bedroom twin for nightly types, so the caller must fall back", () => {
    // Clicking "Hotels" from 2-bedroom apartments: there is no
    // 2-bedroom-hotel-rooms facet, so the pill handler retries without the
    // count and lands on hotel-rooms-in-mogadishu. Emitting a slug that does
    // not exist would navigate the user straight into a 404.
    expect(facetSlugFor({ type: "hotel", bedrooms: 2 })).toBeNull();
    expect(facetSlugFor({ type: "hotel" })).toBe("hotel-rooms-in-mogadishu");
  });

  it("returns null for combinations no facet covers", () => {
    expect(facetSlugFor({ type: "apartment", district: "Nairobi" })).toBeNull();
    expect(facetSlugFor({ type: null })).toBeNull();
  });
});

describe("relatedFacets", () => {
  const facet = findFacet("3-bedroom-apartments-in-mogadishu")!;

  it("never links a page to itself", () => {
    expect(relatedFacets(facet).map((f) => f.slug)).not.toContain(facet.slug);
  });

  it("prefers siblings of the same type", () => {
    expect(relatedFacets(facet, 4).every((f) => f.type === "apartment")).toBe(true);
  });
});

describe("sitemap parity", () => {
  // The load-bearing test. scripts/facet-urls.mjs duplicates the slug
  // vocabulary because it runs in plain Node after the Vite build, with no TS
  // loader. If the two ever disagree, the sitemap advertises URLs that 404 —
  // worse than omitting them, because Google learns the sitemap lies.
  it("only emits slugs the app can resolve", () => {
    const rows = ALL_FACETS.flatMap((facet) =>
      // Enough copies of each to clear the threshold, so every facet the app
      // knows about gets a chance to appear in the sitemap's output.
      Array.from({ length: FACET_MIN_LISTINGS }, () => ({
        type: facet.type,
        bedrooms: facet.bedrooms ?? 3,
        location: facet.district ?? "Hodan",
      })),
    );

    const emitted = facetSlugsWithInventory(rows, FACET_MIN_LISTINGS);
    expect(emitted.length).toBeGreaterThan(0);
    for (const slug of emitted) {
      expect(findFacet(slug), `sitemap emitted "${slug}" which the app 404s`).not.toBeNull();
    }
  });

  it("withholds a facet until it clears the threshold", () => {
    const twoApartments = [
      { type: "apartment", bedrooms: 3, location: "Hodan" },
      { type: "apartment", bedrooms: 3, location: "Hodan" },
    ];
    expect(facetSlugsWithInventory(twoApartments, FACET_MIN_LISTINGS)).toEqual([]);

    const three = [...twoApartments, { type: "apartment", bedrooms: 3, location: "Hodan" }];
    expect(facetSlugsWithInventory(three, FACET_MIN_LISTINGS)).toContain(
      "3-bedroom-apartments-in-mogadishu",
    );
  });

  it("ignores types it does not recognise rather than inventing a slug", () => {
    const rows = Array.from({ length: 5 }, () => ({
      type: "houseboat",
      bedrooms: 2,
      location: "Hodan",
    }));
    expect(facetSlugsWithInventory(rows, FACET_MIN_LISTINGS)).toEqual([]);
  });
});

describe("listing titles", () => {
  const base: ListingSeoInput = {
    title: "modern 3-bedroom house",
    description: null,
    type: "apartment",
    location: "Waberi",
    price: 450,
    bedrooms: 3,
    toilets: 2,
    kitchens: 1,
    livingRooms: 1,
    isNightly: false,
  };

  it("leads with the searchable spec, not the owner's typing", () => {
    expect(listingSeoTitle(base)).toMatch(/^3 Bedroom 2 Bathroom Apartment in Waberi, Mogadishu/);
  });

  it("uses the attributive singular people actually search", () => {
    expect(listingSpecPhrase(base)).toBe("3 Bedroom 2 Bathroom Apartment");
  });

  it("appends the owner's title when it adds something", () => {
    // "modern" is not in the generated headline, so it earns its place.
    expect(listingSeoTitle(base)).toContain("Modern 3-bedroom house");
  });

  it("drops the owner's title when it only repeats the spec", () => {
    // Nothing here survives the noise filter, so appending it would be a
    // stutter: "3 Bedroom Apartment ... · 3 bed room apartment".
    const echo = { ...base, title: "3 bed room apartment" };
    expect(listingSeoTitle(echo)).toBe(
      "3 Bedroom Apartment in Waberi, Mogadishu — $450/month".replace(
        "3 Bedroom Apartment",
        "3 Bedroom 2 Bathroom Apartment",
      ),
    );
  });

  it("never calls a hotel room a bedroom count", () => {
    // "1 Bedroom 1 Bathroom Hotel" is not a query anybody makes.
    const room = { ...base, type: "hotel", isNightly: true, bedrooms: 1, toilets: 1, price: 75 };
    expect(listingSpecPhrase(room)).toBe("Hotel Room");
    expect(listingSeoTitle(room)).toMatch(/^Hotel Room in Waberi, Mogadishu — \$75\/night/);
  });

  it("prices nightly stock per night and monthly stock per month", () => {
    expect(listingSeoTitle(base)).toContain("$450/month");
    expect(listingSeoTitle({ ...base, isNightly: true })).toContain("/night");
  });

  it("degrades to the type label when room counts are missing", () => {
    expect(listingSpecPhrase({ ...base, bedrooms: null, toilets: null })).toBe("Apartment");
  });

  it("does not render a zero count", () => {
    expect(listingSpecPhrase({ ...base, toilets: 0 })).toBe("3 Bedroom Apartment");
  });
});

describe("listing descriptions", () => {
  const base: ListingSeoInput = {
    title: "Appartment qaboob badan",
    description: null,
    type: "apartment",
    location: "Wadajir",
    price: 400,
    bedrooms: 4,
    toilets: 2,
    kitchens: 1,
    livingRooms: 2,
    isNightly: false,
  };

  it("always carries the English spec, even with a Somali description", () => {
    const somali = { ...base, description: "Guri qurux badan oo ku yaal Wadajir." };
    const out = listingSeoDescription(somali);
    expect(out).toContain("4 bedrooms");
    expect(out).toContain("Wadajir, Mogadishu");
    expect(out).toContain("Guri qurux badan");
  });

  it("states kitchens and living rooms, which the title omits", () => {
    const out = listingSeoDescription(base);
    expect(out).toContain("1 kitchen");
    expect(out).toContain("2 living rooms");
  });

  it("stays within the SERP snippet budget", () => {
    const long = { ...base, description: "x".repeat(400) };
    expect(listingSeoDescription(long).length).toBeLessThanOrEqual(158);
  });

  it("drops an owner fragment too short to be a hook rather than shipping debris", () => {
    // A 300-char spec would leave the owner's words a handful of characters;
    // half a word mid-sentence reads as broken, so the spec goes out alone.
    const out = listingSeoDescription({ ...base, description: "Nice." });
    expect(out).not.toContain("…");
  });

  it("says a hotel room is bookable, not for rent", () => {
    const room = { ...base, type: "hotel", isNightly: true, price: 75 };
    expect(listingSeoDescription(room)).toContain("Hotel Room available to book");
  });
});
