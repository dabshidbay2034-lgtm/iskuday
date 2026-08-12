import type { PropertyType } from "@/lib/types";

/**
 * ONE source of truth for how a property type is shown to a renter.
 *
 * Two vocabularies reach these helpers. The database enum says `villa`, while
 * `PropertyType` says `house` — and the list surfaces (Properties,
 * FeaturedProperties, AgencyProfile) remap `villa` -> `house` on the way into
 * PropertyCard, whereas Saved and Dashboard hand the raw enum straight to the
 * badge. PropertyCard, Dashboard and PropertyDetail each used to keep a private
 * copy of these maps keyed on ONE of the two, so a remapped `"house"` missed
 * the lookup entirely: `typeColors[type]` came back undefined and the template
 * literal shipped `class="... undefined ..."` with a bare lowercase label,
 * intermittently, depending on which page you arrived from. Normalising both
 * spellings in one place is what stops that from coming back.
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
  house: "house",
  villa: "house", // the database enum's name for the same thing
  apartment: "apartment",
  hotel: "hotel",
  commercial: "commercial",
};

const TYPE_COLORS: Record<PropertyDisplayType, string> = {
  house: "bg-success text-success-foreground",
  apartment: "bg-info text-info-foreground",
  hotel: "bg-hotel text-hotel-foreground",
  commercial: "bg-warning text-warning-foreground",
};

const TYPE_LABELS: Record<PropertyDisplayType, string> = {
  house: "House",
  apartment: "Apartment",
  hotel: "Hotel",
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
