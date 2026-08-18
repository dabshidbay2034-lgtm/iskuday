import {
  AirVent, BedDouble, Car, Coffee, ConciergeBell, Dumbbell, Droplets, Landmark,
  Plane, ShieldCheck, Shirt, Sparkles, Tv, UtensilsCrossed, Waves, Wifi, Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The fixed vocabulary of hotel amenities an owner can pick from.
 *
 * ── WHY A CLOSED LIST AND NOT A FREE ICON PICKER ────────────────────────────
 * An owner choosing from ~17 named facilities cannot produce a broken or ugly
 * grid. A free icon picker (the WordPress answer) means every hotel invents its
 * own vocabulary — "Wi-Fi", "wifi", "Internet", "WIFI 24/7" — which reads as
 * amateur on the page and is useless for filtering or comparison later. The
 * list below is the product; adding to it is a deliberate act, not a setting.
 *
 * ── WHY THESE SPECIFIC ONES ─────────────────────────────────────────────────
 * This is not a generic hotel-amenity list copied from a booking site. It is
 * what actually decides a booking in Mogadishu:
 *
 *   - `generator` and `water` are near the top because mains power and piped
 *     water are unreliable. A hotel with 24-hour backup power says so first,
 *     and guests genuinely choose on it.
 *   - `security` matters more here than a star rating.
 *   - `airport` covers the Aden Adde run, which most guests need arranged.
 *   - `prayer` is a normal facility to advertise in Somalia and absent from
 *     every Western hotel template.
 *
 * `key` is stored in the database and is FROZEN once any hotel has used it —
 * renaming one silently blanks that amenity on every page using it. Add new
 * keys; never repurpose an old one.
 */
export type AmenityKey =
  | "wifi" | "generator" | "water" | "ac" | "parking" | "security"
  | "airport" | "restaurant" | "breakfast" | "laundry" | "roomservice"
  | "prayer" | "pool" | "gym" | "tv" | "conference" | "housekeeping";

export const AMENITY_OPTIONS: {
  key: AmenityKey;
  /** Default label. The owner may override it per block. */
  label: string;
  Icon: LucideIcon;
}[] = [
  { key: "wifi",         label: "Free Wi-Fi",            Icon: Wifi },
  { key: "generator",    label: "24h backup generator",  Icon: Zap },
  { key: "water",        label: "24h water supply",      Icon: Droplets },
  { key: "security",     label: "24h security",          Icon: ShieldCheck },
  { key: "ac",           label: "Air conditioning",      Icon: AirVent },
  { key: "parking",      label: "Secure parking",        Icon: Car },
  { key: "airport",      label: "Airport transfer",      Icon: Plane },
  { key: "restaurant",   label: "Restaurant",            Icon: UtensilsCrossed },
  { key: "breakfast",    label: "Breakfast included",    Icon: Coffee },
  { key: "laundry",      label: "Laundry service",       Icon: Shirt },
  { key: "roomservice",  label: "Room service",          Icon: ConciergeBell },
  { key: "housekeeping", label: "Daily housekeeping",    Icon: Sparkles },
  { key: "prayer",       label: "Prayer room",           Icon: Landmark },
  { key: "conference",   label: "Conference room",       Icon: BedDouble },
  { key: "pool",         label: "Swimming pool",         Icon: Waves },
  { key: "gym",          label: "Gym",                   Icon: Dumbbell },
  { key: "tv",           label: "Satellite TV",          Icon: Tv },
];

const BY_KEY = new Map(AMENITY_OPTIONS.map((a) => [a.key, a]));

/**
 * Look up an amenity, tolerating a key this build does not know about.
 *
 * A page saved by a newer deploy can reach an older client during a rollout.
 * Returning `undefined` lets the renderer skip that one item rather than crash
 * the whole page over an unknown string.
 */
export function amenityOption(key: string) {
  return BY_KEY.get(key as AmenityKey);
}
