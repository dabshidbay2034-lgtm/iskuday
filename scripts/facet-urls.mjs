/**
 * Which facet pages have earned a place in the sitemap.
 *
 * Its own module, not part of generate-sitemap.mjs, for one reason: that script
 * runs `main()` at import time, so anything importing it fires a build. This
 * file is pure — no network, no fs, no side effects — so the parity test in
 * src/test/facet-sitemap.test.ts can import it alongside the real catalogue in
 * src/lib/facets.ts and assert the two agree.
 *
 * ── WHY THIS ISN'T JUST `import { ALL_FACETS }` ─────────────────────────────
 * src/lib/facets.ts is TypeScript compiled by Vite; this runs in plain Node
 * after `vite build`, with no loader in between. So the vocabulary below is
 * duplicated, and that duplication is a real risk — a slug that disagrees with
 * the app puts a URL in the sitemap that renders a 404, which is strictly worse
 * than omitting it because Google learns the sitemap lies.
 *
 * The parity test is what makes the duplication safe: it asserts that EVERY
 * slug this file can emit resolves through `findFacet` in the app. If you edit
 * the vocabulary in one place and not the other, that test fails.
 *
 * ── WHY IT GROUPS THE DATA INSTEAD OF ENUMERATING ───────────────────────────
 * The app enumerates all ~120 candidate facets because it must answer "is this
 * URL one of ours?" for arbitrary input. The sitemap has the opposite job — it
 * starts from the rows and asks which groups are big enough to publish — so
 * grouping is both less code and structurally incapable of emitting a facet
 * with no inventory behind it.
 */

/** Must match TYPE_VOCAB in src/lib/facets.ts. Asserted by the parity test. */
const TYPE_SLUG = {
  villa: "villas",
  apartment: "apartments",
  hotel: "hotel-rooms",
  bnb: "bnb-stays",
  commercial: "commercial-property",
};

/** Must match BEDROOM_TYPES / BEDROOM_COUNTS in src/lib/facets.ts. */
const BEDROOM_TYPES = new Set(["villa", "apartment"]);
const BEDROOM_MIN = 1;
const BEDROOM_MAX = 5;

/** Must match DISTRICT_TYPES in src/lib/facets.ts. */
const DISTRICT_TYPES = new Set(["villa", "apartment", "hotel"]);

/** Must match districtSlug() in src/lib/facets.ts. */
function districtSlug(district) {
  return String(district).toLowerCase().replace(/\s+/g, "-");
}

/**
 * Facet slugs backed by at least `minListings` of the supplied rows.
 *
 * `rows` must already be filtered to what the public can see — pass the same
 * array the listing entries were built from, never a fresh unfiltered query.
 * Counting a set the pages do not render is how a sitemap ends up advertising
 * a page that says "0 properties found".
 */
export function facetSlugsWithInventory(rows, minListings) {
  const counts = new Map();
  const bump = (slug) => counts.set(slug, (counts.get(slug) ?? 0) + 1);

  for (const row of rows) {
    const type = row?.type;
    const typeSlug = TYPE_SLUG[type];
    // A type the app does not know about (added by a migration ahead of this
    // file) contributes to nothing rather than inventing a slug for it.
    if (!typeSlug) continue;

    bump(`${typeSlug}-in-mogadishu`);

    const beds = Number(row?.bedrooms);
    if (
      BEDROOM_TYPES.has(type) &&
      Number.isInteger(beds) &&
      beds >= BEDROOM_MIN &&
      beds <= BEDROOM_MAX
    ) {
      bump(`${beds}-bedroom-${typeSlug}-in-mogadishu`);
    }

    const district = row?.location;
    if (DISTRICT_TYPES.has(type) && district) {
      bump(`${typeSlug}-in-${districtSlug(district)}`);
    }
  }

  return [...counts.entries()]
    .filter(([, n]) => n >= minListings)
    .map(([slug]) => slug)
    .sort();
}
