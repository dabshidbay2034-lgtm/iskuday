/**
 * The look a hotel can choose for its own site.
 *
 * ── WHY THREE PRESETS AND NOT A THEME EDITOR ────────────────────────────────
 * This is the line between "enough to be a website" and "WordPress". A hotel
 * manager in Mogadishu with a phone does not want a typography panel; they want
 * their hotel online tonight and looking deliberate. Three pairings that were
 * each chosen to work means every hotel lands somewhere good. A font picker
 * with 900 Google fonts means most of them land somewhere bad, and the ones
 * that land worst are the ones who tried hardest.
 *
 * Same reasoning for radius: three steps, not a pixel field.
 *
 * ── WHY NO NEW WEBFONTS ─────────────────────────────────────────────────────
 * index.html already loads Plus Jakarta Sans and Inter, and this market is on
 * mobile data where every extra font file is a real cost to a real person.
 * Every pairing below is built from those two plus system faces that ship with
 * the device — Georgia is on effectively every phone and desktop, and a Somali
 * guest on a cheap Android gets the serif without downloading anything.
 *
 * The keys are stored in the database and are FROZEN once a hotel has used one.
 */

export type FontPairingKey = "modern" | "editorial" | "grotesk";

export const FONT_PAIRINGS: {
  key: FontPairingKey;
  label: string;
  /** One line describing the feel, for the owner choosing. */
  hint: string;
  /** CSS font stacks. Applied as variables, not classes — see hotelThemeStyle. */
  heading: string;
  body: string;
}[] = [
  {
    key: "modern",
    label: "Modern",
    hint: "Clean and current. The platform default.",
    heading: "'Plus Jakarta Sans', sans-serif",
    body: "Inter, sans-serif",
  },
  {
    key: "editorial",
    label: "Editorial",
    hint: "Serif headings. Reads established, older, more formal.",
    // Georgia rather than a webfont: it is on essentially every device, and a
    // serif that arrives instantly beats a nicer one that arrives late.
    heading: "Georgia, 'Times New Roman', serif",
    body: "Inter, sans-serif",
  },
  {
    key: "grotesk",
    label: "Compact",
    hint: "Tighter and more neutral. Good for a lot of rooms.",
    heading: "Inter, sans-serif",
    body: "Inter, sans-serif",
  },
];

export type CornerStyleKey = "sharp" | "soft" | "round";

export const CORNER_STYLES: { key: CornerStyleKey; label: string; radius: string }[] = [
  { key: "sharp", label: "Sharp", radius: "0.25rem" },
  { key: "soft", label: "Soft", radius: "0.75rem" },
  { key: "round", label: "Round", radius: "1.5rem" },
];

/**
 * Which colour scheme the hotel's PUBLIC page renders in.
 *
 * `auto` follows the visitor's device, which is the right default and what
 * every page did before this existed. The other two are a deliberate choice by
 * the hotel — a beachfront place wants light, a business hotel often wants
 * dark — and they override the visitor, which is the point.
 */
export type ThemeModeKey = "auto" | "light" | "dark";

export const THEME_MODES: { key: ThemeModeKey; label: string; hint: string }[] = [
  { key: "auto", label: "Match device", hint: "Light or dark, whichever the visitor uses." },
  { key: "light", label: "Always light", hint: "" },
  { key: "dark", label: "Always dark", hint: "" },
];

export type HotelTheme = {
  fontPairing: FontPairingKey;
  cornerStyle: CornerStyleKey;
  themeMode: ThemeModeKey;
};

export const DEFAULT_HOTEL_THEME: HotelTheme = {
  fontPairing: "modern",
  cornerStyle: "soft",
  themeMode: "auto",
};

/**
 * Coerce whatever is in the database into a theme that renders.
 *
 * A key this build does not know about — a page saved by a newer deploy
 * reaching an older client mid-rollout — falls back to the default rather than
 * rendering a page with no font.
 */
export function hotelTheme(raw: Partial<Record<keyof HotelTheme, string | null>>): HotelTheme {
  const font = FONT_PAIRINGS.find((f) => f.key === raw.fontPairing);
  const corner = CORNER_STYLES.find((c) => c.key === raw.cornerStyle);
  const mode = THEME_MODES.find((m) => m.key === raw.themeMode);
  return {
    fontPairing: font?.key ?? DEFAULT_HOTEL_THEME.fontPairing,
    cornerStyle: corner?.key ?? DEFAULT_HOTEL_THEME.cornerStyle,
    themeMode: mode?.key ?? DEFAULT_HOTEL_THEME.themeMode,
  };
}

/**
 * The inline style that applies a theme to a subtree.
 *
 * CSS custom properties rather than Tailwind classes, for one reason: the
 * values are OWNER DATA read from the database at runtime, and Tailwind's JIT
 * only emits classes it can see as complete literals in the source. A built-up
 * class name is never scanned and renders unstyled in the production build —
 * the same trap documented in components/hotel/section-styles.ts.
 */
export function hotelThemeStyle(theme: HotelTheme): React.CSSProperties {
  const font = FONT_PAIRINGS.find((f) => f.key === theme.fontPairing) ?? FONT_PAIRINGS[0];
  const corner = CORNER_STYLES.find((c) => c.key === theme.cornerStyle) ?? CORNER_STYLES[1];
  return {
    // Consumed by the `font-heading` / `font-body` utilities, which resolve
    // through these variables in tailwind.config.ts.
    ["--hotel-font-heading" as string]: font.heading,
    ["--hotel-font-body" as string]: font.body,
    ["--hotel-radius" as string]: corner.radius,
  };
}

/*
 * Colour scheme is applied to the ROOT element, not to a subtree — see
 * src/hooks/use-hotel-theme.ts.
 *
 * Tailwind's `darkMode: "class"` makes every `dark:` variant fire when ANY
 * ancestor carries `.dark`. A subtree therefore cannot opt back OUT of dark:
 * "always light" on a wrapper div would do precisely nothing for a visitor
 * whose device is dark, which is the one case that setting exists for. Since a
 * hotel page IS the whole page, owning <html> for the duration is both correct
 * and the only thing that works.
 */
