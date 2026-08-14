import type { SectionType } from "./page-sections";

/**
 * The FIXED style vocabulary for hotel page blocks.
 *
 * Owners pick from a short menu (not freeform colours/fonts) so every page
 * stays on-brand and every combination is one we've actually looked at. The
 * editor's Inspector renders the `*_OPTIONS` lists and the public renderer
 * calls the matching `*Class()` resolver — both read the SAME maps, so the
 * two can never drift apart.
 *
 * ── THE RULE THAT MATTERS ──────────────────────────────────────────────────
 * Every Tailwind class below is a COMPLETE LITERAL STRING inside a lookup map.
 * Tailwind's JIT scans source text, so a built-up name (`min-h-[${n}px]`,
 * "py-" + n) is never seen by the scanner: it works in dev (where the class
 * may exist for other reasons) and silently renders UNSTYLED in the
 * production build. Never concatenate or interpolate a class name here.
 *
 * Defaults reproduce the page's look BEFORE these fields existed, so a saved
 * page with none of them set renders exactly as it always did.
 */

// ── The axes ─────────────────────────────────────────────────────────────────

export type HeroHeight = "short" | "tall" | "full";
export type TextAlign = "left" | "center";
export type Overlay = "none" | "light" | "medium" | "heavy";
export type BlockWidth = "narrow" | "wide";
export type Tone = "plain" | "card" | "tinted";
export type GalleryLayout = "carousel" | "grid";
export type RoomColumns = 2 | 3;
export type Pad = "tight" | "normal" | "roomy";
export type Gap = "tight" | "normal" | "roomy";

/** The style half of a `PageSection` — mirrored by the fields on that interface. */
export type SectionStyle = {
  heroHeight?: HeroHeight;
  align?: TextAlign;
  overlay?: Overlay;
  width?: BlockWidth;
  tone?: Tone;
  layout?: GalleryLayout;
  columns?: RoomColumns;
  pad?: Pad;
  gap?: Gap;
};

/** Every style key, for wholesale restyling (see `applyLook`). Content keys are NOT here. */
export const SECTION_STYLE_KEYS = [
  "heroHeight", "align", "overlay", "width", "tone", "layout", "columns", "pad",
  "gap",
] as const satisfies readonly (keyof SectionStyle)[];

/** One entry in an Inspector's segmented control / select. */
export type StyleOption<T> = { value: T; label: string };

// ── Hero height ──────────────────────────────────────────────────────────────

const HERO_HEIGHT: Record<HeroHeight, string> = {
  short: "min-h-[280px] md:min-h-[340px]",
  tall: "min-h-[380px] md:min-h-[480px]", // today's hero — the fallback
  full: "min-h-[85vh]",
};

export const heroHeightClass = (v?: HeroHeight): string => HERO_HEIGHT[v ?? "tall"];

export const HERO_HEIGHT_OPTIONS: StyleOption<HeroHeight>[] = [
  { value: "short", label: "Short" },
  { value: "tall", label: "Tall" },
  { value: "full", label: "Full screen" },
];

// ── Alignment ────────────────────────────────────────────────────────────────
// Three resolvers because aligning a block means three different things:
// the text itself, how stacked flex children sit, and how a max-width child
// (a constrained paragraph) centres inside its parent.

const ALIGN_TEXT: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
};

const ALIGN_ITEMS: Record<TextAlign, string> = {
  left: "items-start",
  center: "items-center",
};

const ALIGN_MX: Record<TextAlign, string> = {
  left: "mx-0",
  center: "mx-auto",
};

/**
 * Text alignment. `fallback` exists because blocks don't share one default:
 * the hero is left-aligned today, the text block is centred.
 */
export const alignClass = (v?: TextAlign, fallback: TextAlign = "left"): string =>
  ALIGN_TEXT[v ?? fallback];

export const alignItemsClass = (v?: TextAlign, fallback: TextAlign = "left"): string =>
  ALIGN_ITEMS[v ?? fallback];

export const alignMxClass = (v?: TextAlign, fallback: TextAlign = "left"): string =>
  ALIGN_MX[v ?? fallback];

export const ALIGN_OPTIONS: StyleOption<TextAlign>[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centred" },
];

// ── Hero image overlay ───────────────────────────────────────────────────────

const OVERLAY: Record<Overlay, string> = {
  none: "bg-transparent",
  light: "bg-gradient-to-t from-black/50 via-black/15 to-transparent",
  medium: "bg-gradient-to-t from-black/80 via-black/30 to-black/10", // today's hero scrim
  heavy: "bg-gradient-to-t from-black/90 via-black/65 to-black/40",
};

export const overlayClass = (v?: Overlay): string => OVERLAY[v ?? "medium"];

export const OVERLAY_OPTIONS: StyleOption<Overlay>[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
];

// ── Content width ────────────────────────────────────────────────────────────

const BLOCK_WIDTH: Record<BlockWidth, string> = {
  narrow: "max-w-3xl",
  wide: "max-w-5xl",
};

/**
 * Container width. `fallback` again: the text block is `max-w-3xl` today
 * while gallery / rooms / cta / contact are `max-w-5xl`.
 */
export const blockWidthClass = (v?: BlockWidth, fallback: BlockWidth = "wide"): string =>
  BLOCK_WIDTH[v ?? fallback];

export const WIDTH_OPTIONS: StyleOption<BlockWidth>[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wide", label: "Wide" },
];

// ── Surface tone ─────────────────────────────────────────────────────────────

const TONE: Record<Tone, string> = {
  plain: "bg-transparent", // today — blocks sit straight on the page background
  card: "bg-card border border-border rounded-3xl shadow-card px-5 md:px-8",
  tinted: "bg-muted/40 rounded-3xl px-5 md:px-8",
};

export const toneClass = (v?: Tone): string => TONE[v ?? "plain"];

export const TONE_OPTIONS: StyleOption<Tone>[] = [
  { value: "plain", label: "Plain" },
  { value: "card", label: "Card" },
  { value: "tinted", label: "Tinted" },
];

// ── Gallery layout ───────────────────────────────────────────────────────────

/** Resolved layout — the renderer branches on this, there's no class for "carousel". */
export const galleryLayoutOf = (v?: GalleryLayout): GalleryLayout => v ?? "carousel";

/** Grid classes for the "grid" layout (the carousel brings its own). */
export const GALLERY_GRID_CLASS = "grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4";

export const GALLERY_LAYOUT_OPTIONS: StyleOption<GalleryLayout>[] = [
  { value: "carousel", label: "Carousel" },
  { value: "grid", label: "Grid" },
];

// ── Room grid columns ────────────────────────────────────────────────────────

const ROOM_COLUMNS: Record<RoomColumns, string> = {
  2: "grid grid-cols-1 sm:grid-cols-2 gap-4",
  3: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", // today's room grid
};

export const roomColumnsClass = (v?: RoomColumns): string => ROOM_COLUMNS[v ?? 3];

export const ROOM_COLUMN_OPTIONS: StyleOption<RoomColumns>[] = [
  { value: 2, label: "2 across" },
  { value: 3, label: "3 across" },
];

// ── Vertical padding ─────────────────────────────────────────────────────────

const PAD: Record<Pad, string> = {
  tight: "py-6 md:py-8",
  normal: "py-10 md:py-14", // today's text block
  roomy: "py-16 md:py-24",
};

/** `fallback` because the gallery is `py-8` and rooms are `py-10` today. */
export const padClass = (v?: Pad, fallback: Pad = "normal"): string => PAD[v ?? fallback];

export const PAD_OPTIONS: StyleOption<Pad>[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "roomy", label: "Roomy" },
];

// ── Row gap ──────────────────────────────────────────────────────────────────

const GAP: Record<Gap, string> = {
  tight: "gap-2 md:gap-3",
  normal: "gap-4 md:gap-6",
  roomy: "gap-8 md:gap-12",
};

export const gapClass = (v?: Gap): string => GAP[v ?? "normal"];

export const GAP_OPTIONS: StyleOption<Gap>[] = [
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "roomy", label: "Roomy" },
];

// ── Which axes the Inspector should offer, per block type ────────────────────

export type StyleAxis = keyof SectionStyle;

/**
 * Showing every axis on every block would be noise — a gallery has no overlay
 * and a hero has no column count. The editor reads this to decide what to draw.
 */
export const STYLE_AXES_FOR: Record<SectionType, StyleAxis[]> = {
  hero: ["heroHeight", "align", "overlay"],
  text: ["align", "width", "tone", "pad"],
  gallery: ["layout", "width", "pad"],
  rooms: ["columns", "width", "pad"],
  menu: ["columns", "width", "pad"],
  cta: ["align", "width", "pad"],
  contact: ["align", "width", "pad"],
  // Containers carry layout, never content.
  row: ["columns", "gap", "width", "pad"],
  column: ["align", "pad"],
};
