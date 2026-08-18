/**
 * Pure helpers for per-page metadata. The component that actually writes to
 * `document.head` lives in src/components/Seo.tsx.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * This app is a client-rendered Vite SPA and `vercel.json` rewrites every path
 * to `/index.html`. That means EVERY route is served the homepage's <head>,
 * byte for byte — including:
 *
 *     <link rel="canonical" href="https://mogadishurents.com/" />
 *
 * A canonical is not a hint about which page is nicer; it is a declaration that
 * "this URL is a duplicate of that one, index that one instead". Shipping the
 * homepage's canonical on /property/:id told Google that all 15 listings, every
 * /hotels/:slug page and /services were duplicates of the homepage and should
 * be dropped from the index. The same applied to <title> — 29 routes competing
 * in the SERP under one identical title.
 *
 * So the rule this module exists to enforce:
 *
 *   EVERY indexable route must declare its OWN absolute canonical, and any
 *   route that should not be indexed must say so with robots=noindex rather
 *   than by pointing its canonical somewhere else.
 *
 * Never reintroduce a hardcoded site-root canonical anywhere but the homepage.
 *
 * ── KNOWN LIMITATION ────────────────────────────────────────────────────────
 * These tags are written by JavaScript after hydration. Googlebot does render
 * JS and will see them, but on a second, delayed pass — and most other crawlers
 * (Bingbot's budget, Facebook/Twitter/WhatsApp link unfurlers, many LLM
 * fetchers) never run JS at all, so they still see index.html's homepage tags.
 * Correct-but-client-side beats wrong-and-static, but the real fix is
 * server-rendered or prerendered <head> per route.
 */

/** Origin only, no trailing slash — `absoluteUrl` supplies the separator. */
export const SITE_URL = "https://mogadishurents.com";

/** Brand suffix appended by `buildTitle`. Also the og:site_name in index.html. */
export const SITE_NAME = "Mogadishu Rents";

/**
 * Fallback social card image. Matches the og:image already in index.html so a
 * page without its own photo degrades to the same image rather than to none —
 * an absent og:image makes most unfurlers render a bare grey box.
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/icon-512.png`;

/**
 * Turn an app path into an absolute URL.
 *
 * Canonical/og:url MUST be absolute: a relative canonical is resolved against
 * the current document URL, so on a page reached with tracking params or on a
 * hotel subdomain it would resolve to the wrong origin and quietly de-index the
 * page again. Already-absolute input is passed through so callers can hand us a
 * Supabase storage URL for og:image without special-casing it.
 */
export function absoluteUrl(path: string): string {
  if (!path) return `${SITE_URL}/`;
  if (/^https?:\/\//i.test(path)) return path;
  // Protocol-relative ("//cdn.example.com/x.jpg") is absolute too; prefixing it
  // with the site origin would produce a broken https://mogadishurents.com//cdn…
  if (path.startsWith("//")) return `https:${path}`;
  return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Shorten a description to `n` characters at a word boundary.
 *
 * Google truncates meta descriptions around 155-160 chars, and a snippet cut
 * mid-word reads as broken. Whitespace is collapsed first because property
 * descriptions are free-typed into a textarea and routinely carry newlines,
 * which would otherwise land inside the content="" attribute.
 */
export function truncate(s: string, n: number): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  // Reserve one character for the ellipsis so the result never exceeds n.
  const hard = clean.slice(0, Math.max(0, n - 1));
  const lastSpace = hard.lastIndexOf(" ");
  // Only back up to a word boundary if that doesn't gut the string (a single
  // 200-character "word" would otherwise truncate to nothing).
  const body = lastSpace > n * 0.5 ? hard.slice(0, lastSpace) : hard;
  return `${body.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/**
 * Append the brand suffix unless the title already ends with it.
 *
 * Pages such as the hotel builder legitimately want to end with the hotel's own
 * name, and PropertyDetail titles are long enough that a doubled brand would
 * push the useful part past the ~60-char SERP cutoff. Both spellings the site
 * uses in the wild — "Mogadishu Rents" and "MogadishuRents" — count as already
 * branded, since index.html and the UI disagree about the space.
 */
export function buildTitle(pageTitle: string): string {
  const title = (pageTitle ?? "").replace(/\s+/g, " ").trim();
  if (!title) return `${SITE_NAME} — Rent Villas, Apartments & Hotels in Mogadishu`;
  const tail = title.toLowerCase();
  if (tail.endsWith(SITE_NAME.toLowerCase()) || tail.endsWith("mogadishurents")) return title;
  return `${title} | ${SITE_NAME}`;
}

/**
 * Serialise structured data for injection into a <script> element.
 *
 * The `<` escape is the load-bearing part. JSON-LD is written as raw text into
 * the DOM, and property titles / hotel descriptions are USER-CONTROLLED — a
 * listing titled `</script><script>…` would otherwise close our tag and execute
 * whatever followed. `<` is a valid JSON escape that every JSON-LD parser
 * decodes back to "<", so the data survives intact while the browser's HTML
 * tokenizer can never see a closing tag.
 *
 * (We set the script's textContent rather than innerHTML, which already avoids
 * most of this — the escape is belt-and-braces in case that ever regresses to
 * innerHTML or the string gets templated somewhere else.)
 */
export function serializeJsonLd(data: object | object[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
