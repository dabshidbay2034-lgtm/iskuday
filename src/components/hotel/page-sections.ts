import {
  AlignLeft, Image as ImageIcon, BedDouble, Columns3, Megaphone, RectangleVertical,
  Sparkles, Phone,
} from "lucide-react";

import type {
  BlockWidth, Gap, GalleryLayout, HeroHeight, Overlay, Pad, RoomColumns, TextAlign, Tone,
} from "./section-styles";

/**
 * The block model behind a hotel page (20260809000001).
 *
 * A page is an ORDERED TREE of sections. Each section has a `type` and a small
 * set of editable fields. The public page renders them top-to-bottom; the
 * editor builds them by dragging blocks around and adding new ones inline.
 *
 * Content blocks are leaves. Two block types exist only to hold other blocks:
 * a `row` lays its `column` children out side by side, and a `column` stacks
 * whatever is put inside it. That pair is deliberately the ONLY nesting
 * mechanism — owners asked to put things inside things, not to drag blocks to
 * arbitrary coordinates, and a grid of columns is the one layout primitive that
 * still reads correctly when it collapses onto a phone.
 *
 * Some content is intentionally GLOBAL (not per-block): the hotel name, slug,
 * accent colour, logo, and the contact details/socials used by the contact
 * block. Those are the page's "settings"; the blocks are the page's layout.
 *
 * ── EVERY SAVED PAGE IS A FLAT ARRAY ───────────────────────────────────────
 * Nothing published before this existed has a `children` key. A flat array is
 * simply a tree of depth 0, so every helper below treats "no children" as the
 * normal case and never invents one: load → render → save of a legacy page is
 * a byte-for-byte round trip. No migration, no backfill.
 */

/** Blocks that render content. A leaf can never contain anything. */
export type LeafSectionType =
  | "hero" | "text" | "gallery" | "rooms" | "menu" | "cta" | "contact" | "policy"
  | "amenities" | "faq";

/** Blocks that exist only to hold other blocks. */
export type ContainerSectionType = "row" | "column";

export type SectionType = LeafSectionType | ContainerSectionType;

export const LEAF_SECTION_TYPES: LeafSectionType[] = [
  "hero", "text", "gallery", "rooms", "menu", "cta", "contact", "policy",
  "amenities", "faq",
];

/** One facility on an `amenities` block. */
export interface AmenityItem {
  id: string;
  /** A key from AMENITY_OPTIONS in ./amenity-icons. Frozen once saved. */
  key: string;
  /** Overrides the option's default label when the owner edits it. */
  label?: string;
}

/** One question/answer pair on a `faq` block. */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string | null;
  category?: string;
}

/** A single editable block. Flat + optional fields so editors are uniform. */
export interface PageSection {
  id: string;
  type: SectionType;
  /** hero */
  headline?: string;
  subtext?: string;
  imageUrl?: string | null;
  ctaLabel?: string;
  ctaHref?: string;
  /** text */
  heading?: string;
  body?: string;
  /** gallery */
  title?: string;
  images?: string[];
  /** rooms & menu */
  subtitle?: string;
  /** menu */
  items?: MenuItem[];
  /** amenities */
  amenities?: AmenityItem[];
  /** faq */
  faqs?: FaqItem[];
  /** cta */
  buttonLabel?: string;
  buttonHref?: string;

  /**
   * Nested blocks — `row` and `column` only.
   *
   * Optional, and ABSENT (not `[]`) on every leaf, because that absence is what
   * makes an already-saved flat page identical to the tree it parses into.
   */
  children?: PageSection[];

  /**
   * Presentation, from the fixed menu in `./section-styles`. All optional and
   * all defaulted by the resolvers there, so a page saved before these existed
   * renders exactly as it did. Which axes apply to which block type is
   * described by `STYLE_AXES_FOR`.
   */
  heroHeight?: HeroHeight;
  align?: TextAlign;
  overlay?: Overlay;
  width?: BlockWidth;
  tone?: Tone;
  layout?: GalleryLayout;
  /**
   * How many across. Shared by `rooms` (the room grid) and `row` (the column
   * grid) rather than given a separate `colSpan`, because the two mean the
   * literal same thing to an owner — "how many sit side by side" — and the
   * Inspector already renders this axis. A per-column `colSpan` was rejected
   * on purpose: uneven spans need a 12-column grid and a second control, which
   * is the pixel-fiddling this feature was chosen INSTEAD of.
   */
  columns?: RoomColumns;
  pad?: Pad;
  /** Space between a row's columns. */
  gap?: Gap;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const SECTION_META: Record<
  SectionType,
  { label: string; Icon: React.ComponentType<{ className?: string }>; hint: string }
> = {
  hero: { label: "Hero", Icon: Sparkles, hint: "Big headline, subtext and a call-to-action." },
  text: { label: "Text", Icon: AlignLeft, hint: "A heading and a paragraph." },
  gallery: { label: "Gallery", Icon: ImageIcon, hint: "A sliding photo carousel." },
  rooms: { label: "Rooms", Icon: BedDouble, hint: "Your featured rooms with nightly rates." },
  menu: { label: "Menu", Icon: ImageIcon, hint: "Food & drinks with prices and photos." },
  cta: { label: "Button", Icon: Megaphone, hint: "A highlight band with a button." },
  contact: { label: "Contact", Icon: Phone, hint: "Phone, WhatsApp, map and socials." },
  policy: { label: "Policy", Icon: AlignLeft, hint: "House rules, payment & cancellation terms — an editable policy section." },
  row: { label: "Columns", Icon: Columns3, hint: "Blocks side by side — stacked on phones." },
  column: { label: "Column", Icon: RectangleVertical, hint: "One column of a row. Put blocks in it." },
};

/**
 * The "add a block" menu.
 *
 * `column` is deliberately absent: a column only means something inside a row,
 * so owners get columns by adding a row, never by placing a stray one.
 */
export const SECTION_ORDER: SectionType[] = [
  "hero", "text", "gallery", "rooms", "amenities", "menu", "faq", "cta",
  "policy", "contact", "row",
];

/* ── Tree shape rules ──────────────────────────────────────────────────────── */

/**
 * How deep a CONTAINER may sit (0 = top level).
 *
 * Leaves are exempt — a leaf can't recurse, so refusing one only creates a
 * container nobody can fill. The deepest legal shape is therefore
 * `row(0) > column(1) > row(2) > column(3) > leaves`: one nested row, which is
 * as far as a design that has to collapse to a single phone column can go
 * before it stops being predictable. Unbounded nesting was never asked for and
 * would let one owner build a page that is slow to render and impossible to
 * edit on the device most of them use.
 */
export const MAX_DEPTH = 3;

export function isContainer(type: SectionType): type is ContainerSectionType {
  return type === "row" || type === "column";
}

/** Can `child` be placed directly inside `parent` (null = the page itself)? */
export function canContain(parent: SectionType | null, child: SectionType): boolean {
  if (child === "column") return parent === "row"; // a stray column has no meaning
  if (parent === null) return true;
  if (parent === "row") return false; // a row holds columns and nothing else
  if (parent === "column") return true; // leaves, plus a nested row
  return false; // leaves hold nothing
}

/**
 * Would this block AND everything already inside it fit at `depth`?
 *
 * Checked against the whole subtree rather than the block alone because the
 * things being inserted are rarely empty: `newSection("row")` arrives with two
 * columns and a duplicated row arrives with its entire contents. Testing only
 * the top of the subtree would let a paste smuggle in blocks past the cap.
 */
export function sectionFits(block: PageSection, depth: number): boolean {
  if (!isContainer(block.type)) return true;
  if (depth > MAX_DEPTH) return false;
  return (block.children ?? []).every((child) => sectionFits(child, depth + 1));
}

/* ── Tree helpers ──────────────────────────────────────────────────────────── */

/** One node, with everything the editor needs to address it. */
export type FlatSection = {
  section: PageSection;
  /** null for a top-level block. */
  parentId: string | null;
  /** 0 for a top-level block. */
  depth: number;
  /** Position among its SIBLINGS, not in the flattened list. */
  index: number;
};

/**
 * The whole tree in document (visual) order, parents before their children.
 *
 * Reading order is what the editor's lists, keyboard navigation and
 * "first block of type X" lookups all actually mean, so it is the order this
 * returns — never a per-level grouping.
 */
export function flattenSections(
  sections: PageSection[],
  parentId: string | null = null,
  depth = 0,
): FlatSection[] {
  const out: FlatSection[] = [];
  sections.forEach((section, index) => {
    out.push({ section, parentId, depth, index });
    if (section.children?.length) {
      out.push(...flattenSections(section.children, section.id, depth + 1));
    }
  });
  return out;
}

export function findSection(sections: PageSection[], id: string): PageSection | undefined {
  for (const s of sections) {
    if (s.id === id) return s;
    if (s.children?.length) {
      const hit = findSection(s.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Where a block sits, or `null` if this tree doesn't contain it. */
export function locateSection(sections: PageSection[], id: string): FlatSection | null {
  return flattenSections(sections).find((f) => f.section.id === id) ?? null;
}

/**
 * Merge `patch` into one block, wherever it is.
 *
 * Branches that don't contain the target are returned BY REFERENCE — including
 * the top-level array when nothing matched. Rebuilding every level on every
 * keystroke would make React's identity checks meaningless and re-render the
 * whole canvas while someone is typing into one paragraph.
 */
export function updateSection(
  sections: PageSection[],
  id: string,
  patch: Partial<PageSection>,
): PageSection[] {
  let changed = false;
  const next = sections.map((s) => {
    if (s.id === id) {
      changed = true;
      return { ...s, ...patch };
    }
    if (s.children?.length) {
      const kids = updateSection(s.children, id, patch);
      if (kids !== s.children) {
        changed = true;
        return { ...s, children: kids };
      }
    }
    return s;
  });
  return changed ? next : sections;
}

/** Drop a block and everything inside it, wherever it is. */
export function removeSection(sections: PageSection[], id: string): PageSection[] {
  let changed = false;
  const next: PageSection[] = [];
  for (const s of sections) {
    if (s.id === id) {
      changed = true;
      continue;
    }
    if (s.children?.length) {
      const kids = removeSection(s.children, id);
      if (kids !== s.children) {
        changed = true;
        next.push({ ...s, children: kids });
        continue;
      }
    }
    next.push(s);
  }
  return changed ? next : sections;
}

/** Insert at a clamped position — an out-of-range index appends, never throws. */
function spliceAt<T>(list: T[], index: number, item: T): T[] {
  const i = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, i), item, ...list.slice(i)];
}

/**
 * Put `block` inside `parentId` (null = the page itself) at `index`.
 *
 * Returns the tree UNCHANGED when the placement is illegal — wrong parent for
 * the type, or past `MAX_DEPTH`. Refusing silently rather than throwing keeps
 * the caller a one-liner: a drop that isn't allowed simply doesn't happen, and
 * the editor can gate the same rules up front with `canContain`/`sectionFits`.
 */
export function insertSection(
  sections: PageSection[],
  parentId: string | null,
  index: number,
  block: PageSection,
): PageSection[] {
  if (parentId === null) {
    if (!canContain(null, block.type) || !sectionFits(block, 0)) return sections;
    return spliceAt(sections, index, block);
  }
  const at = locateSection(sections, parentId);
  if (!at) return sections;
  if (!canContain(at.section.type, block.type)) return sections;
  if (!sectionFits(block, at.depth + 1)) return sections;
  return updateSection(sections, parentId, {
    children: spliceAt(at.section.children ?? [], index, block),
  });
}

/**
 * Nudge a block one slot up or down AMONG ITS SIBLINGS.
 *
 * At either end it stops instead of escaping into the parent: "up" quietly
 * teleporting a block out of the column it was in is the kind of thing that
 * makes an owner think the builder ate their work.
 */
export function moveSection(sections: PageSection[], id: string, dir: -1 | 1): PageSection[] {
  const at = locateSection(sections, id);
  if (!at) return sections;
  const siblings = at.parentId === null
    ? sections
    : findSection(sections, at.parentId)?.children ?? [];
  const to = at.index + dir;
  if (to < 0 || to >= siblings.length) return sections;

  const next = [...siblings];
  next[at.index] = siblings[to];
  next[to] = siblings[at.index];
  return at.parentId === null ? next : updateSection(sections, at.parentId, { children: next });
}

/**
 * Copy a block for the editor's "Duplicate" action.
 *
 * Everything mutable is cloned rather than shared, and EVERY node in the copied
 * subtree gets a fresh id. Two blocks pointing at one `images` array means
 * editing photos in the copy silently rewrites the original; two blocks
 * carrying one id means selection, patching and deletion can't tell them apart
 * and would hit both.
 */
export function duplicateSection(s: PageSection): PageSection {
  const copy: PageSection = { ...s, id: uid() };
  if (s.images) copy.images = [...s.images];
  if (s.children) copy.children = s.children.map((child) => duplicateSection(child));
  return copy;
}

/** Duplicate a block in place — the copy lands directly after the original. */
export function duplicateSectionById(sections: PageSection[], id: string): PageSection[] {
  const at = locateSection(sections, id);
  if (!at) return sections;
  return insertSection(sections, at.parentId, at.index + 1, duplicateSection(at.section));
}

/** The first block of a type anywhere in the tree, in reading order. */
export function findFirstOfType(
  sections: PageSection[],
  type: SectionType,
): PageSection | undefined {
  return flattenSections(sections).find((f) => f.section.type === type)?.section;
}

/* ── Pages ─────────────────────────────────────────────────────────────────── */

/** A fresh, sensible block for a given type. */
export function newSection(type: SectionType): PageSection {
  const base: PageSection = { id: uid(), type };
  switch (type) {
    case "hero":
      return { ...base, headline: "", subtext: "", imageUrl: null, ctaLabel: "Explore rooms", ctaHref: "#rooms" };
    case "text":
      return { ...base, heading: "", body: "" };
    case "gallery":
      return { ...base, title: "Gallery", images: [] };
    case "rooms":
      return { ...base, title: "Rooms & rates", subtitle: "Nightly · book through Mogadishu Rents" };
    case "menu":
      return { ...base, title: "Menu", subtitle: "Food & Drinks", items: [] };
    case "cta":
      return { ...base, heading: "", buttonLabel: "Book now", buttonHref: "#contact" };
    case "contact":
      return { ...base, heading: "Get in touch" };
    case "policy":
      return { ...base, heading: "Hotel policy", body: "" };
    // Seeded with the four facilities that decide a booking in Mogadishu, so a
    // freshly added block is already useful instead of an empty grid the owner
    // has to figure out. They can remove any of them.
    case "amenities":
      return {
        ...base,
        title: "Facilities",
        amenities: [
          { id: uid(), key: "wifi" },
          { id: uid(), key: "generator" },
          { id: uid(), key: "water" },
          { id: uid(), key: "security" },
        ],
      };
    case "faq":
      return { ...base, title: "Frequently asked questions", faqs: [] };
    // Seeded with its columns already in place. A row with no columns is a
    // dead end — nothing can be dropped into a row except a column, so an
    // empty one would need a second, non-obvious step before it did anything.
    case "row":
      return { ...base, children: [newSection("column"), newSection("column")] };
    case "column":
      return { ...base, children: [] };
  }
}

/** The default block layout for a brand-new page. */
export function defaultPageSections(input: {
  name: string;
  tagline?: string | null;
  heroImageUrl?: string | null;
  description?: string | null;
  gallery?: string[];
}): PageSection[] {
  const hero = newSection("hero");
  hero.headline = input.name;
  hero.subtext = input.tagline ?? "";
  hero.imageUrl = input.heroImageUrl ?? null;

  const text = newSection("text");
  text.heading = `About ${input.name}`;
  text.body = input.description ?? "";

  const gallery = newSection("gallery");
  gallery.images = input.gallery ?? [];

  return [hero, text, gallery, newSection("rooms"), newSection("contact")];
}

/**
 * The prebuilt POLICY page blocks — bilingual defaults an owner customizes
 * before publishing, exactly like every other builder page.
 *
 * A policy page is plain `text` sections plus a closing `cta`, so it inherits
 * the whole existing editor (heading + body per block, move/duplicate/delete)
 * with zero new field machinery. The starter copy covers the sections hotels
 * actually get asked for in Mogadishu: check-in/out, payment, cancellation,
 * house rules, children/pets, liability and privacy.
 *
 * Every string is a SEPARATE text block (not one giant block) so the owner can
 * delete, reorder or duplicate individual clauses instead of editing one blob.
 * `accentName` lets the copy address the hotel by name wherever we know it.
 */
export function policyPageSections(hotelName: string): PageSection[] {
  const clause = (heading: string, body: string): PageSection => {
    const s = newSection("policy");
    s.heading = heading;
    s.body = body;
    return s;
  };

  const intro = newSection("text");
  intro.heading = "Hotel policies";
  intro.body = `Thank you for choosing ${hotelName}. Please read these policies before you book — they keep things clear for both you and our team.`;

  return [
    intro,
    clause(
      "Check-in & check-out",
      "Check-in is from 14:00 and check-out is by 12:00. Early check-in and late check-out depend on availability — ask the front desk and we'll do our best. Please present a valid ID at check-in.",
    ),
    clause(
      "Payment",
      "Payment is on arrival unless agreed otherwise. We accept EVC, Zaad, Sifalo Pay, cash and card where available. A security deposit may be requested on check-in and is returned at check-out, minus any damage or extras.",
    ),
    clause(
      "Cancellation",
      "Free cancellation until 24 hours before arrival. After that, the first night may be charged. During busy periods, prepaid reservations may be non-refundable — please check your booking confirmation for details.",
    ),
    clause(
      "House rules",
      "Quiet hours run from 22:00 to 08:00. Smoking is not allowed in the rooms or common areas. Drugs are not permitted at any time. Please dispose of waste responsibly and treat the property with care.",
    ),
    clause(
      "Children & pets",
      "Children are welcome. Pets are allowed only by prior arrangement — please let the front desk know when you book. A small cleaning fee or deposit may apply.",
    ),
    clause(
      "Liability",
      `${hotelName} is not liable for loss or damage to guests' personal belongings. Please use the safe provided in your room and lock your door at all times.`,
    ),
    clause(
      "Privacy",
      "We process your stay data to deliver your reservation and to contact you about your booking. We never share your details with third parties for marketing.",
    ),
    newSection("cta"),
  ];
}

/**
 * Parse the stored JSONB into a typed section list (empty when unset).
 *
 * Unknown keys are carried through untouched by the `{ ...s }` spread. That is
 * load-bearing, not incidental: it is what let the whole style vocabulary ship
 * with no migration, and it is what lets a page saved by a NEWER build survive
 * being opened by an older one. Never narrow this to a field allow-list.
 *
 * `children` recurses through the same function. A legacy flat page has no
 * `children` key on any block, so none is added and the parsed result is
 * identical to what it has always been.
 *
 * Depth is NOT clamped here. The cap belongs at insert time (`insertSection`);
 * enforcing it on load would silently delete blocks an owner can see, which is
 * a far worse failure than rendering one level deeper than intended.
 */
export function sectionsFromJson(raw: unknown): PageSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is PageSection => Boolean(s) && typeof s === "object" && typeof (s as PageSection).type === "string")
    .map((s) => {
      const next: PageSection = { ...s, id: s.id || uid(), images: Array.isArray(s.images) ? s.images : [] };
      if (Array.isArray(s.children)) next.children = sectionsFromJson(s.children);
      return next;
    });
}

/** The page's sections, back-filled from the legacy scalar fields when needed. */
export function sectionsFor(hotel: {
  name: string;
  tagline?: string | null;
  heroImageUrl?: string | null;
  description?: string | null;
  gallery?: string[];
  sections?: unknown;
}): PageSection[] {
  const stored = sectionsFromJson(hotel.sections);
  if (stored.length > 0) return stored;
  return defaultPageSections(hotel);
}

export function heroOf(sections: PageSection[]): PageSection | undefined {
  return findFirstOfType(sections, "hero");
}

/**
 * Mirror the block content back into the legacy scalar columns so other
 * surfaces (list thumbnails, the old fields) keep working.
 *
 * Searches the whole TREE, not just the top level: once heroes and galleries
 * can live inside a column, a flat `.find()` would quietly start returning
 * nothing and blank the thumbnail of a page that clearly has a hero on it.
 */
export function deriveScalars(sections: PageSection[], fallback: { name: string }) {
  const hero = findFirstOfType(sections, "hero");
  const text = findFirstOfType(sections, "text");
  const gallery = findFirstOfType(sections, "gallery");
  return {
    heroImageUrl: hero?.imageUrl ?? null,
    tagline: hero?.subtext ?? null,
    description: text?.body ?? null,
    gallery: gallery?.images ?? [],
  };
}
