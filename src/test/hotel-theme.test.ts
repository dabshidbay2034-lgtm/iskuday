import { describe, expect, it } from "vitest";

import {
  CORNER_STYLES,
  DEFAULT_HOTEL_THEME,
  FONT_PAIRINGS,
  THEME_MODES,
  hotelTheme,
  hotelThemeStyle,
} from "@/lib/hotel-theme";

describe("hotel theme presets", () => {
  it("has unique keys — they are stored on every hotel row", () => {
    for (const list of [
      FONT_PAIRINGS.map((f) => f.key),
      CORNER_STYLES.map((c) => c.key),
      THEME_MODES.map((m) => m.key),
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("defaults to what every hotel already renders", () => {
    // A hotel that never opens the Style panel must look exactly as it did
    // before this feature existed.
    expect(DEFAULT_HOTEL_THEME).toEqual({
      fontPairing: "modern",
      cornerStyle: "soft",
      themeMode: "auto",
    });
  });

  it("adds no webfont beyond the two index.html already loads", () => {
    // This market is on mobile data. A third font file is a real cost to a real
    // person, so every pairing is built from Plus Jakarta Sans, Inter, or a
    // face that ships with the device.
    const allowed = /Plus Jakarta Sans|Inter|Georgia|Times New Roman|sans-serif|serif/;
    for (const pairing of FONT_PAIRINGS) {
      expect(pairing.heading).toMatch(allowed);
      expect(pairing.body).toMatch(allowed);
    }
  });
});

describe("coercing what is in the database", () => {
  it("keeps values it recognises", () => {
    expect(hotelTheme({ fontPairing: "editorial", cornerStyle: "sharp", themeMode: "dark" })).toEqual(
      { fontPairing: "editorial", cornerStyle: "sharp", themeMode: "dark" },
    );
  });

  it("falls back rather than rendering a page with no font", () => {
    // A row written by a newer deploy reaching an older client mid-rollout.
    expect(hotelTheme({ fontPairing: "brutalist" })).toEqual(DEFAULT_HOTEL_THEME);
    expect(hotelTheme({})).toEqual(DEFAULT_HOTEL_THEME);
    expect(hotelTheme({ cornerStyle: null, themeMode: null })).toEqual(DEFAULT_HOTEL_THEME);
  });
});

describe("the style it applies", () => {
  it("emits variables, not class names", () => {
    // Tailwind's JIT only emits classes it can see as complete literals, so a
    // built-up class name renders unstyled in the production build. These are
    // owner data read at runtime, hence custom properties.
    const style = hotelThemeStyle({ fontPairing: "editorial", cornerStyle: "round", themeMode: "auto" });
    expect(style).toHaveProperty("--hotel-font-heading");
    expect(style).toHaveProperty("--hotel-font-body");
    expect(style).toHaveProperty("--hotel-radius");
    expect(String(style["--hotel-font-heading" as keyof typeof style])).toContain("Georgia");
    expect(style["--hotel-radius" as keyof typeof style]).toBe("1.5rem");
  });

  it("still produces a full style for an unknown preset", () => {
    const style = hotelThemeStyle({
      fontPairing: "nonsense" as never,
      cornerStyle: "nonsense" as never,
      themeMode: "auto",
    });
    expect(style["--hotel-font-heading" as keyof typeof style]).toBeTruthy();
    expect(style["--hotel-radius" as keyof typeof style]).toBeTruthy();
  });
});
