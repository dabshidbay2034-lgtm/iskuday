import { propertyTypeLabel } from "@/lib/property-display";
import { truncate } from "@/lib/seo";

/**
 * Titles and descriptions for a single listing, built from the STRUCTURED
 * columns rather than the owner's free-typed title.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * PropertyDetail used to build its title as `${property.title} — $X/month in
 * Hodan`. `property.title` is whatever the owner typed into a text box, and on
 * this platform that is things like "modern 2-bedrooms", "Appartment qaboob
 * badan" and "3 bed room Appartment aad u qabow". So the single heaviest
 * ranking signal on the page was carrying misspellings, Somali, or neither the
 * word "bedroom" nor the word "Mogadishu" — while `bedrooms: 2`, `toilets: 1`
 * and `location: "Hodan"` sat right there in the same row, unused.
 *
 * Everything generated here is a restatement of stored facts. A row with
 * `bedrooms: 3` gets the words "3 Bedroom". That is a description of the
 * property, not a translation of the owner's prose and not a keyword injected
 * for crawlers — the same spec already renders visibly in the amenities row on
 * the page itself.
 *
 * ── WHAT GOES WHERE ─────────────────────────────────────────────────────────
 * <title>: keyword phrase first, price second, owner's own words last.
 *   Google truncates the DISPLAY around 60 characters but indexes the whole
 *   string, so the tail still earns rankings the searcher never sees. Leading
 *   with the spec means the visible half is the half that matches the query;
 *   trailing with the owner's title is what keeps two 2-bed flats in the same
 *   district at the same price from shipping byte-identical titles.
 *
 * <meta description>: owner's words first, spec sentence appended.
 *   Their description holds the specifics that earn the click ("near Bakaara",
 *   "generator included"). Appending the spec guarantees the English
 *   bedroom/bathroom/district phrasing is present even when the owner wrote in
 *   Somali or wrote nothing at all.
 *
 * Kitchens and living rooms appear in the description and never the title.
 * "1 kitchen" is not a query anybody types, and the title has roughly 60 useful
 * characters that beds, baths, district and price already spend better.
 */

export type ListingSeoInput = {
  title: string;
  description?: string | null;
  type?: string | null;
  location?: string | null;
  price: number;
  bedrooms?: number | null;
  toilets?: number | null;
  kitchens?: number | null;
  livingRooms?: number | null;
  /** Nightly stock (hotel room, BnB) prices per night, not per month. */
  isNightly: boolean;
  /** For-sale listings say "for sale" and carry no rate unit. */
  isForSale?: boolean;
};

/** "$450" — no cents, because every listing on this platform is whole dollars. */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function rate(input: ListingSeoInput): string {
  if (input.isForSale) return money(input.price);
  return `${money(input.price)}/${input.isNightly ? "night" : "month"}`;
}

/**
 * The keyword phrase: "3 Bedroom 2 Bathroom Apartment".
 *
 * Attributive singular ("3 Bedroom", not "3 Bedrooms") because that is how the
 * phrase is typed into a search box. The visible amenities row on the page uses
 * the natural plural — they are different registers for different readers and
 * are meant to differ.
 *
 * Bathrooms are dropped when absent rather than rendered as "0 Bathroom", and
 * the whole phrase degrades to just the type label when a listing carries no
 * room counts at all.
 */
export function listingSpecPhrase(input: ListingSeoInput): string {
  // Nightly stock never carries room counts in the phrase. "1 Bedroom 1
  // Bathroom Hotel" is not a search anybody performs — a guest looking for a
  // room searches "hotel room in Hodan", and the bedroom count on a hotel row
  // is an artefact of the owner filling in the same form a villa uses. The
  // counts still appear in the description, where an en-suite is worth stating.
  if (input.isNightly) return nightlyLabel(input.type);

  const label = propertyTypeLabel(input.type);
  const parts = [
    input.bedrooms != null && input.bedrooms > 0 ? `${input.bedrooms} Bedroom` : null,
    input.toilets != null && input.toilets > 0 ? `${input.toilets} Bathroom` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" ")} ${label}` : label;
}

/**
 * "Hotel Room", not "Hotel" — the listing is one room, and claiming to be a
 * hotel is both wrong and a worse match for what a guest types. Mirrors the
 * plural vocabulary the facet pages use in src/lib/facets.ts.
 */
function nightlyLabel(type?: string | null): string {
  const key = (type ?? "").toLowerCase();
  if (key === "hotel") return "Hotel Room";
  if (key === "bnb") return "BnB";
  return propertyTypeLabel(type);
}

/** "3 Bedroom 2 Bathroom Apartment in Waberi, Mogadishu". */
export function listingSpecHeadline(input: ListingSeoInput): string {
  const where = input.location ? `${input.location}, Mogadishu` : "Mogadishu";
  return `${listingSpecPhrase(input)} in ${where}`;
}

/**
 * The <title>, before `buildTitle` appends the brand.
 *
 * The owner's title is appended only when it says something the generated half
 * does not. "modern 3-bedroom house" against "3 Bedroom Apartment in Waberi"
 * contributes "modern"; "3 bedroom" contributes nothing and would just read as
 * a stutter. The comparison is on distinctive words, so the check survives
 * their spelling ("appartment", "bed room").
 */
export function listingSeoTitle(input: ListingSeoInput): string {
  const head = listingSpecHeadline(input);
  const suffix = input.isForSale ? " for sale" : "";
  const base = `${head}${suffix} — ${rate(input)}`;

  const extra = distinctiveRemainder(input.title, head);
  return extra ? `${base} · ${extra}` : base;
}

/** Words carrying no distinguishing information in this context. */
const NOISE = new Set([
  "a", "an", "the", "in", "at", "for", "with", "and", "of", "to",
  "bed", "beds", "bedroom", "bedrooms", "bedrooms.", "room", "rooms",
  "bath", "bathroom", "bathrooms", "toilet", "toilets",
  "house", "houses", "villa", "villas", "apartment", "apartments",
  "appartment", "appartments", "apartement", "flat", "hotel", "hotels",
  "bnb", "commercial", "property", "mogadishu", "muqdisho", "rent", "sale",
]);

/**
 * Whatever the owner's title adds beyond the generated headline, or "" if it
 * adds nothing.
 *
 * Numbers are dropped wholesale: "3" in "modern 3-bedroom" is already stated by
 * the spec, and a bare digit is never the thing that distinguishes two
 * listings. What survives is adjectives and place references — "modern",
 * "furnished", "sanbuul" — which is exactly the distinguishing material wanted.
 */
function distinctiveRemainder(ownerTitle: string, headline: string): string {
  const clean = (ownerTitle ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w)),
    );

  const inHeadline = words(headline);
  const novel = [...words(clean)].filter((w) => !inHeadline.has(w));
  if (novel.length === 0) return "";

  // Return the owner's ACTUAL title, capitalised — not the extracted word list.
  // The words above only decide whether to append; what gets appended stays
  // their phrasing, because that is what makes the title genuinely theirs.
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * The meta description: the owner's words, then the full spec sentence.
 *
 * The spec is measured first and the owner's description is given whatever
 * budget remains, so the English spec phrasing can never be the part that gets
 * truncated away — it is the part that has to survive.
 */
export function listingSeoDescription(input: ListingSeoInput): string {
  const where = input.location ? `${input.location}, Mogadishu` : "Mogadishu";
  const rooms = [
    input.bedrooms != null && input.bedrooms > 0
      ? `${input.bedrooms} bedroom${input.bedrooms === 1 ? "" : "s"}`
      : null,
    input.toilets != null && input.toilets > 0
      ? `${input.toilets} bathroom${input.toilets === 1 ? "" : "s"}`
      : null,
    input.kitchens != null && input.kitchens > 0
      ? `${input.kitchens} kitchen${input.kitchens === 1 ? "" : "s"}`
      : null,
    input.livingRooms != null && input.livingRooms > 0
      ? `${input.livingRooms} living room${input.livingRooms === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  const verb = input.isForSale
    ? "for sale"
    : input.isNightly
      // Same call Properties.tsx and facets.ts make: "hotel room for rent"
      // reads as a mistake, because a room is booked by the night.
      ? "available to book"
      : "for rent";
  const spec =
    `${input.isNightly ? nightlyLabel(input.type) : propertyTypeLabel(input.type)} ${verb} in ${where}` +
    (rooms.length ? ` — ${rooms.join(", ")}` : "") +
    `. ${rate(input)}.`;

  const owner = (input.description ?? "").replace(/\s+/g, " ").trim();
  if (!owner) return truncate(spec, 158);

  // 158 total, minus the spec, minus the joining space. Below ~40 characters an
  // owner fragment is a broken half-sentence rather than a hook, so it is
  // dropped entirely rather than shipped as debris.
  const budget = 158 - spec.length - 1;
  if (budget < 40) return truncate(spec, 158);
  return `${truncate(owner, budget)} ${spec}`;
}
