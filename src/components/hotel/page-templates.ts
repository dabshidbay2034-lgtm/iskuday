import { newSection, type PageSection, type SectionType } from "./page-sections";
import { SECTION_STYLE_KEYS, type SectionStyle } from "./section-styles";

/**
 * Starter looks for a hotel page.
 *
 * A template is a whole finished page — the block ORDER, the copy, and the
 * style variants — so an owner who picks one and stops still has something
 * publishable. The same style rules are reused by `applyLook`, which lets a
 * page swap looks later without losing a word of what was written.
 */

/**
 * The style half of a block, keyed off `PageSection` itself so this fails to
 * compile if the two ever drift apart.
 */
type StyleFields = Pick<PageSection, keyof SectionStyle>;

/**
 * Style rules for a look. Every block type is required so `applyLook` always
 * has an answer, whatever blocks a page happens to contain.
 */
type Look = Record<SectionType, StyleFields>;

export type PageTemplate = {
  id: string;
  label: string;
  /** One line for the picker card. */
  blurb: string;
  /** MUST match /^#[0-9a-fA-F]{6}$/ — a DB CHECK on hotels.accent_color enforces it. */
  accentColor: string;
  /** The look's style rules — shared by `build` and `applyLook`. */
  look: Look;
  build(name: string): PageSection[];
};

/**
 * Assemble a page from block types, applying the look's style rules.
 * Goes through `newSection` so any field added there flows into every
 * template for free.
 */
function compose(
  look: Look,
  parts: Array<{ type: SectionType; content: Partial<PageSection> }>,
): PageSection[] {
  return parts.map(({ type, content }) => ({
    ...newSection(type),
    ...content,
    ...look[type],
  }));
}

// ── Beachfront ───────────────────────────────────────────────────────────────

const BEACHFRONT_LOOK: Look = {
  hero: { heroHeight: "tall", align: "center", overlay: "medium" },
  text: { align: "center", width: "narrow", tone: "plain", pad: "normal" },
  policy: { align: "center", width: "narrow", tone: "plain", pad: "normal" },
  faq: { align: "center", width: "narrow", tone: "plain", pad: "normal" },
  gallery: { layout: "grid", width: "wide", pad: "normal" },
  rooms: { columns: 3, width: "wide", pad: "normal" },
  amenities: { columns: 3, width: "wide", pad: "normal" },
  menu: { columns: 3, width: "wide", pad: "normal" },
  cta: { align: "center", width: "wide", pad: "normal" },
  contact: { align: "left", width: "wide", pad: "normal" },
    row: { gap: "normal", width: "wide", pad: "normal" },
    column: { align: "left", pad: "tight" },
};

// ── Business ─────────────────────────────────────────────────────────────────

const BUSINESS_LOOK: Look = {
  hero: { heroHeight: "short", align: "left", overlay: "light" },
  text: { align: "left", width: "narrow", tone: "card", pad: "normal" },
  policy: { align: "left", width: "narrow", tone: "card", pad: "normal" },
  faq: { align: "left", width: "narrow", tone: "card", pad: "normal" },
  gallery: { layout: "grid", width: "wide", pad: "tight" },
  rooms: { columns: 3, width: "wide", pad: "normal" },
  amenities: { columns: 3, width: "wide", pad: "normal" },
  menu: { columns: 3, width: "wide", pad: "normal" },
  cta: { align: "left", width: "wide", pad: "tight" },
  contact: { align: "left", width: "wide", pad: "normal" },
    row: { gap: "normal", width: "wide", pad: "normal" },
    column: { align: "left", pad: "tight" },
};

// ── Boutique ─────────────────────────────────────────────────────────────────

const BOUTIQUE_LOOK: Look = {
  hero: { heroHeight: "full", align: "center", overlay: "heavy" },
  text: { align: "center", width: "narrow", tone: "tinted", pad: "roomy" },
  policy: { align: "center", width: "narrow", tone: "tinted", pad: "roomy" },
  faq: { align: "center", width: "narrow", tone: "tinted", pad: "roomy" },
  gallery: { layout: "carousel", width: "wide", pad: "normal" },
  rooms: { columns: 2, width: "narrow", pad: "roomy" },
  amenities: { columns: 2, width: "narrow", pad: "roomy" },
  menu: { columns: 2, width: "narrow", pad: "roomy" },
  cta: { align: "center", width: "narrow", pad: "roomy" },
  contact: { align: "center", width: "narrow", pad: "roomy" },
    row: { gap: "normal", width: "wide", pad: "normal" },
    column: { align: "left", pad: "tight" },
};

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: "beachfront",
    label: "Beachfront",
    blurb: "Big sunset hero, photo grid and rooms — for a hotel on the water.",
    accentColor: "#c2703d",
    look: BEACHFRONT_LOOK,
    build: (name) =>
      compose(BEACHFRONT_LOOK, [
        {
          type: "hero",
          content: {
            headline: name,
            subtext: "Sea-facing rooms, ocean breeze and sunsets over the Indian Ocean.",
            ctaLabel: "See rooms & rates",
            ctaHref: "#rooms",
          },
        },
        {
          type: "text",
          content: {
            heading: `Welcome to ${name}`,
            body:
              `${name} sits right on the shoreline — wake up to the water, ` +
              "spend the day between the beach and the terrace, and finish with dinner " +
              "as the sun goes down. Every room is cleaned daily and staffed around the clock.",
          },
        },
        { type: "gallery", content: { title: "Life by the water" } },
        {
          type: "rooms",
          content: {
            title: "Rooms & rates",
            subtitle: "Nightly · book through Mogadishu Rents",
          },
        },
        {
          type: "cta",
          content: {
            heading: `Your room by the sea is waiting at ${name}.`,
            buttonLabel: "Check availability",
            buttonHref: "#rooms",
          },
        },
        { type: "contact", content: { heading: "Plan your stay" } },
      ]),
  },
  {
    id: "business",
    label: "Business",
    blurb: "Compact hero, rooms up front — for city and corporate stays.",
    accentColor: "#1e3a5f",
    look: BUSINESS_LOOK,
    build: (name) =>
      // Rooms BEFORE the gallery: a business traveller is shopping for a
      // rate and a date, not browsing photographs.
      compose(BUSINESS_LOOK, [
        {
          type: "hero",
          content: {
            headline: name,
            subtext: "City-centre rooms, fast Wi-Fi and meeting space — checked in and working in minutes.",
            ctaLabel: "See rooms & rates",
            ctaHref: "#rooms",
          },
        },
        {
          type: "rooms",
          content: {
            title: "Rooms & rates",
            subtitle: "Nightly · invoices and corporate rates available",
          },
        },
        {
          type: "text",
          content: {
            heading: `Why teams stay at ${name}`,
            body:
              "Reliable power and Wi-Fi, a desk in every room, 24-hour reception and " +
              "airport pickup on request. Meeting rooms and long-stay rates can be " +
              "arranged directly with the front desk.",
          },
        },
        { type: "gallery", content: { title: "Inside the hotel" } },
        {
          type: "cta",
          content: {
            heading: `Booking for a team? ${name} handles group stays.`,
            buttonLabel: "Request a quote",
            buttonHref: "#contact",
          },
        },
        { type: "contact", content: { heading: "Reservations & enquiries" } },
      ]),
  },
  {
    id: "boutique",
    label: "Boutique",
    blurb: "Full-screen hero, quiet centred copy — for a small, styled hotel.",
    accentColor: "#6b2d5c",
    look: BOUTIQUE_LOOK,
    build: (name) =>
      compose(BOUTIQUE_LOOK, [
        {
          type: "hero",
          content: {
            headline: name,
            subtext: "A small hotel with a short guest list and a long memory for detail.",
            ctaLabel: "Discover the rooms",
            ctaHref: "#rooms",
          },
        },
        {
          type: "text",
          content: {
            heading: `The idea behind ${name}`,
            body:
              "A handful of rooms, each finished differently, and a team small enough " +
              "to remember how you take your coffee. Breakfast is made to order and the " +
              "courtyard stays quiet well past midnight.",
          },
        },
        { type: "gallery", content: { title: "A closer look" } },
        {
          type: "rooms",
          content: {
            title: "The rooms",
            subtitle: "Nightly · book through Mogadishu Rents",
          },
        },
        {
          type: "cta",
          content: {
            heading: "Only a few rooms — reserve yours before the weekend fills.",
            buttonLabel: "Reserve a room",
            buttonHref: "#rooms",
          },
        },
        { type: "contact", content: { heading: "Speak to us" } },
      ]),
  },
];

/**
 * Restyle WITHOUT touching text or images — for the in-editor "Looks" switcher.
 *
 * Every style key is stripped first so nothing lingers from the previous look
 * (a grid gallery must actually become a carousel, not merely "not set"), then
 * the new look is layered on. Content keys are never read or written here,
 * which is what makes the switcher safe to offer with no confirm and no undo.
 */
export function applyLook(sections: PageSection[], t: PageTemplate): PageSection[] {
  return sections.map((section) => {
    const next: PageSection = { ...section };
    for (const key of SECTION_STYLE_KEYS) delete next[key];
    return { ...next, ...t.look[section.type] };
  });
}
