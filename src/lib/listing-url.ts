import { listingSpecPhrase, type ListingSeoInput } from "@/lib/listing-seo";

/**
 * The URL of one listing.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 * Listings lived at `/property/b6b54397-fd91-4726-b93a-1b440c48fe36`. That URL
 * carries no keyword, no relevance signal, and nothing a person would paste
 * into WhatsApp with any confidence about what it is. The URL is a ranking
 * factor and, more importantly here, it is the preview a recipient sees before
 * they tap.
 *
 * They now look like:
 *   /property/2-bedroom-apartment-in-wadajir-b6b54397-fd91-4726-b93a-1b440c48fe36
 *
 * ── WHY THE WHOLE UUID IS STILL IN THERE ────────────────────────────────────
 * The obvious nicer shape is a short id — the first eight hex characters —
 * which would halve the length. It was tried and rejected on evidence:
 * PostgREST cannot `LIKE` a uuid column without a cast, so a prefix lookup
 * needs either a database function or a generated text column, i.e. a migration
 * that has to be applied before any link works. The full uuid needs neither and
 * cannot collide. A long URL that resolves today beats a pretty one that 404s
 * until someone runs a migration.
 *
 * ── WHY THE SLUG IS NOT STORED ──────────────────────────────────────────────
 * Derived at render time from the title, type and district. Storing it would
 * mean a column, a backfill, a uniqueness constraint and a decision about what
 * happens when an owner renames their listing. Deriving it means a rename
 * changes the slug and the OLD link still works — because the uuid at the end
 * is what resolves, and the slug is decoration the router ignores.
 */

/** The trailing uuid is what actually identifies the listing. */
const UUID_TAIL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id inside a `:id` route param, whatever shape it arrived in.
 *
 * Accepts both the new slug form and a bare uuid, because every link shared
 * before this existed is the bare form and those must keep working forever.
 */
export function idFromListingParam(param: string | undefined | null): string | null {
  if (!param) return null;
  const match = UUID_TAIL.exec(param.trim());
  return match ? match[0].toLowerCase() : null;
}

/**
 * The keyword half: "2-bedroom-apartment-in-wadajir".
 *
 * Built from the same spec phrase the <title> uses, so the URL and the search
 * result agree with each other. Somali titles are transliterated by stripping
 * to ASCII rather than translated — see the note in listing-seo.ts about why
 * this platform does not translate owner content.
 */
export function listingSlug(input: ListingSeoInput): string {
  const where = input.location ? ` in ${input.location}` : "";
  const slug = slugify(`${listingSpecPhrase(input)}${where}`);

  // A listing with no type and no district reduces to the generic label
  // `propertyTypeLabel` falls back to, which would produce the stutter
  // `/property/property-<uuid>`. A slug that says nothing is worse than no
  // slug: it costs URL length and reads like a bug.
  return slug === "property" ? "" : slug;
}

/** The full path for a listing. */
export function listingPath(id: string, input?: ListingSeoInput | null): string {
  const slug = input ? listingSlug(input) : "";
  return slug ? `/property/${slug}-${id}` : `/property/${id}`;
}

/**
 * Lowercase, hyphenated, ASCII.
 *
 * Diacritics are folded rather than dropped so "Hodan" and "Hodän" produce the
 * same segment; anything still non-alphanumeric after that becomes a hyphen.
 * Runs of hyphens collapse because "3 Bedroom  —  Apartment" would otherwise
 * produce a slug full of `---`.
 */
export function slugify(value: string): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    // A trailing hyphen from the length cap would double up against the one
    // joining the uuid.
    .replace(/-+$/g, "");
}
