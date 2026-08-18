import type { PropertyType } from "@/lib/types";

/**
 * ONE source of truth for how a property type is shown to a renter.
 *
 * `villa` is now the ONE spelling, matching the database enum since migration
 * 20260323070000. It used to disagree with `PropertyType`, which said `house`,
 * so the list surfaces remapped `villa` -> `house` on the way into PropertyCard
 * while Saved and Dashboard passed the raw enum through. Each page kept its own
 * copy of these maps keyed on ONE of the two, so a remapped `"house"` missed
 * the lookup entirely: `typeColors[type]` came back undefined and the template
 * literal shipped `class="... undefined ..."` with a bare lowercase label,
 * intermittently, depending on which page you arrived from.
 *
 * `house` survives below as an INBOUND ALIAS ONLY — rows written before the
 * migration, bookmarked `?type=house` URLs, and anything a cached client sends.
 * Nothing in the app should emit it. Never add it back as a display label.
 *
 * Every class here is a COMPLETE LITERAL STRING inside a lookup map. Tailwind's
 * JIT scans source text, so a built-up name is never seen by the scanner and
 * renders unstyled in the production build — the rule is spelled out in
 * components/hotel/section-styles.ts. The fallbacks are literal for the same
 * reason, and exist so an unknown type from a future migration degrades to a
 * muted badge instead of interpolating `undefined` into the class attribute.
 */

/** The display vocabulary these maps are keyed on. */
export type PropertyDisplayType = PropertyType;

/** Both spellings of every type, folded onto the display vocabulary. */
const TYPE_ALIASES: Record<string, PropertyDisplayType> = {
  villa: "villa",
  house: "villa", // pre-20260323070000 spelling, still accepted on the way in
  apartment: "apartment",
  hotel: "hotel",
  bnb: "bnb",
  commercial: "commercial",
};

const TYPE_COLORS: Record<PropertyDisplayType, string> = {
  villa: "bg-success text-success-foreground",
  apartment: "bg-info text-info-foreground",
  hotel: "bg-hotel text-hotel-foreground",
  // Distinct from `hotel` on purpose: both are nightly, but a renter scanning a
  // list needs to tell "a room in a hotel" from "someone's short-let flat".
  bnb: "bg-accent text-accent-foreground",
  commercial: "bg-warning text-warning-foreground",
};

const TYPE_LABELS: Record<PropertyDisplayType, string> = {
  villa: "Villa",
  apartment: "Apartment",
  hotel: "Hotel",
  bnb: "BnB",
  commercial: "Commercial",
};

const normalizeType = (type: string | null | undefined): PropertyDisplayType | undefined =>
  type ? TYPE_ALIASES[type] : undefined;

/** Badge colour classes for a property type, in either vocabulary. */
export const propertyTypeClass = (type: string | null | undefined): string => {
  const key = normalizeType(type);
  return (key ? TYPE_COLORS[key] : undefined) ?? "bg-muted text-muted-foreground";
};

/** Human label for a property type, in either vocabulary. */
export const propertyTypeLabel = (type: string | null | undefined): string => {
  const key = normalizeType(type);
  if (key) return TYPE_LABELS[key];
  // An unrecognised type still gets title-cased: the old `|| property.type`
  // fallback dropped the raw lowercase enum next to properly-cased siblings.
  if (!type) return "Property";
  return type.charAt(0).toUpperCase() + type.slice(1);
};

/** Human label for listing purpose: "For Rent" or "For Sale". */
export const purposeLabel = (purpose: string | null | undefined): string => {
  if (purpose === "sell") return "For Sale";
  return "For Rent";
};

/** Badge colour for the listing purpose. */
export const purposeClass = (purpose: string | null | undefined): string => {
  if (purpose === "sell") return "bg-warning/15 text-warning border-warning/20";
  return "bg-primary/10 text-primary border-primary/20";
};
