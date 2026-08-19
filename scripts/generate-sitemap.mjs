#!/usr/bin/env node
/**
 * Build-time sitemap generator — writes dist/sitemap.xml.
 *
 * WHY a build step and not an edge function:
 * the listings live in Postgres, so a checked-in static sitemap is wrong the
 * moment anybody lists a property. The obvious alternative — a Supabase edge
 * function behind a Vercel rewrite — would always be fresh, but this project's
 * existing edge functions (increment-view, send-notification, clerk-webhook)
 * are not deployed and 404 in production. Putting /sitemap.xml behind that same
 * unfired deploy pipeline means Google gets a 404 for the one file that tells
 * it what to crawl. A build step has no runtime dependency, no invocation cost,
 * and re-runs on every deploy — see docs/SEO.md for the trade-off in full.
 *
 * WHY it never fails the build:
 * a deploy that ships no site at all is strictly worse than a deploy whose
 * sitemap is missing a few listings. Every network call is wrapped, and any
 * failure downgrades to "emit the static pages only, log loudly, exit 0".
 * Read that as a contract: this script must never be the reason a deploy dies.
 *
 * WHY raw fetch instead of @supabase/supabase-js:
 * no new dependency, and no ESM/browser-client friction in a plain Node script.
 * PostgREST is just HTTP, and Node 22 has global fetch. The anon key is used —
 * it is the same key that already ships inside the browser bundle, and RLS
 * limits it to exactly the rows the public can already see.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { facetSlugsWithInventory } from "./facet-urls.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "dist");
const OUT_FILE = path.join(OUT_DIR, "sitemap.xml");

/** Canonical origin. The www host 308s here (vercel.json), so never emit www. */
const SITE = "https://mogadishurents.com";

/**
 * Sitemaps cap at 50,000 URLs / 50MB per file. We are at ~15 listings, so the
 * ceiling is three orders of magnitude away and a sitemap index would be pure
 * ceremony today. The guard below exists so that if this platform ever does
 * grow past it, the build says so out loud instead of silently shipping a file
 * Google rejects wholesale.
 */
const MAX_URLS = 50000;

const log = (msg) => console.log(`[sitemap] ${msg}`);
const warn = (msg) => console.warn(`[sitemap] WARNING: ${msg}`);

// ── Env ──────────────────────────────────────────────────────────────────────

/**
 * Vercel injects env vars into process.env; locally they only live in .env,
 * which Vite reads but a plain Node script does not. Fifteen lines of parsing
 * beats adding dotenv for one build step.
 */
async function loadEnv() {
  const env = { ...process.env };
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) return env;
  try {
    const text = await readFile(envFile, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      // Real process.env wins over the file, matching Vite's precedence.
      if (env[key] !== undefined) continue;
      env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch (err) {
    warn(`could not read .env (${err.message}) — relying on process.env only`);
  }
  return env;
}

// ── XML ──────────────────────────────────────────────────────────────────────

/**
 * District names and property titles reach these URLs through query strings and
 * slugs, and a bare `&` makes the whole document unparseable — one unescaped
 * ampersand and Google rejects the file, not the URL. Escape unconditionally.
 */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Absolute URL from path segments, percent-encoding each dynamic segment. */
function urlFor(...segments) {
  const encoded = segments
    .filter((s) => s !== undefined && s !== null && s !== "")
    .map((s) => encodeURIComponent(String(s)));
  return encoded.length ? `${SITE}/${encoded.join("/")}` : `${SITE}/`;
}

/** `<lastmod>` wants a date; anything unparseable is simply omitted. */
function lastmodOf(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function renderUrl({ loc, lastmod, changefreq, priority }) {
  const parts = [`    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

function renderSitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated at build time by scripts/generate-sitemap.mjs. Do not edit by
     hand: every deploy overwrites it. See docs/SEO.md. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(renderUrl).join("\n")}
</urlset>
`;
}

// ── Supabase (PostgREST over plain HTTP) ─────────────────────────────────────

/**
 * One paged SELECT. Returns [] on any failure — callers treat an empty result
 * and a failed result identically, which is what keeps the build fail-soft.
 * PostgREST caps a page at 1000 rows by default, so page until short.
 */
async function selectAll(env, table, { columns, filters = "", pageSize = 1000 }) {
  const base = env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const rows = [];
  let offset = 0;

  while (true) {
    const url =
      `${base}/rest/v1/${table}?select=${encodeURIComponent(columns)}` +
      `${filters}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // A hung Supabase must not hang the deploy.
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`${table}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += pageSize;
    if (rows.length >= MAX_URLS) return rows; // guard against a runaway loop
  }
}

// ── Entry builders ───────────────────────────────────────────────────────────

/**
 * The public, crawlable surface. Everything behind ProtectedRoute is absent on
 * purpose: /signin, /signup, /dashboard, /profile, /saved, /add-property,
 * /manage/*, /admin-panel, /semiadmin, /admin/*, /complete-profile,
 * /forgot-password, /reset-password. Listing a login page burns crawl budget on
 * a page that can never rank, and /join/:token carries a live invite credential
 * that must never appear in a public file.
 *
 * /services carries no lastmod here — it gets one below from the newest
 * published service row, so an updated catalog actually signals a change.
 */
const STATIC_PAGES = [
  { loc: urlFor(), changefreq: "daily", priority: "1.0" },
  { loc: urlFor("properties"), changefreq: "daily", priority: "0.9" },
  { loc: urlFor("services"), changefreq: "weekly", priority: "0.7" },
  { loc: urlFor("about"), changefreq: "monthly", priority: "0.5" },
  { loc: urlFor("privacy"), changefreq: "yearly", priority: "0.3" },
];

/**
 * Publicly visible listings, mirroring src/pages/Properties.tsx exactly:
 *
 *   .or("is_listed.eq.true,is_listed.is.null")
 *   .or("occupancy_status.eq.vacant,occupancy_status.is.null")
 *   .eq("is_available", true)
 *
 * plus NOT is_hidden (the admin kill switch, enforced in RLS since
 * 20260308235729 but filtered here too so the intent is readable).
 *
 * The two OR groups are applied in JS rather than as PostgREST `or=` params:
 * this is the same predicate the page runs at line 131-133, character for
 * character, and keeping it here as JS means the next person can diff the two
 * by eye. Get this wrong and the sitemap advertises URLs that render
 * "Property not found" — worse than omitting them, because Google learns the
 * sitemap lies.
 */
/** id -> path, written by scripts/prerender.mjs. Absent on a partial build. */
async function readListingPaths() {
  try {
    const raw = await readFile(path.join(ROOT, ".prerender-manifest.json"), "utf8");
    return JSON.parse(raw)?.listingPaths ?? {};
  } catch {
    warn("no prerender manifest — listing URLs fall back to bare ids");
    return {};
  }
}

async function propertyEntries(env) {
  const rows = await selectAll(env, "properties", {
    // type/location/bedrooms are here for the facet counts below, not for the
    // listing URLs. One query rather than two, and — the reason that matters —
    // the facet counts are then taken from the SAME filtered array the listing
    // entries come from. Counting a differently-filtered set is how a sitemap
    // ends up advertising a category page that renders "0 properties found".
    columns:
      "id,updated_at,created_at,is_listed,occupancy_status,is_available,is_hidden,type,location,bedrooms",
    filters: "&is_available=eq.true&is_hidden=eq.false",
  });

  const visible = rows.filter((p) => {
    const isListed = p.is_listed !== false;
    const isVacant = p.occupancy_status
      ? p.occupancy_status === "vacant"
      : p.is_available !== false;
    return isListed && isVacant;
  });

  // The canonical path carries a keyword slug now (src/lib/listing-url.ts).
  // That lives in TypeScript and this script is plain Node, so rather than
  // reimplement slugify here and let the two drift, prerender writes what it
  // already computed. Missing manifest = fall back to the bare uuid, which
  // still resolves — a sitemap listing the pre-slug URL is worse than one
  // listing the slug, but far better than no sitemap.
  const listingPaths = await readListingPaths();

  const entries = visible.map((p) => ({
    loc: listingPaths[p.id] ? `${SITE}${listingPaths[p.id]}` : urlFor("property", p.id),
    lastmod: lastmodOf(p.updated_at, p.created_at),
    // Price and availability move; the listing itself does not churn hourly.
    changefreq: "weekly",
    priority: "0.8",
  }));

  return { entries, visible };
}

/**
 * Category pages carrying enough inventory to be worth indexing.
 *
 * The threshold MUST match FACET_MIN_LISTINGS in src/lib/facets.ts. The page
 * itself ships `noindex` below it, so a mismatch means either advertising a
 * page that refuses to be indexed, or withholding one that would accept it.
 */
const FACET_MIN_LISTINGS = 3;

function facetEntries(visibleRows) {
  return facetSlugsWithInventory(visibleRows, FACET_MIN_LISTINGS).map((slug) => ({
    loc: `${SITE}/properties/${slug}`,
    // Higher than an individual listing: these are the pages built to rank for
    // category queries, and the listings exist to be found through them.
    changefreq: "daily",
    priority: "0.85",
  }));
}

/**
 * Published hotel pages — /hotels/:slug (20260808000001). Drafts are invisible
 * to anon under RLS anyway; the explicit filter documents the rule.
 */
async function hotelEntries(env) {
  const rows = await selectAll(env, "hotels", {
    columns: "id,slug,updated_at,created_at,is_published",
    filters: "&is_published=eq.true",
  });

  const live = rows.filter((h) => Boolean(h.slug));
  const bySlug = new Map(live.map((h) => [h.id, h.slug]));

  const entries = live.map((h) => ({
    loc: urlFor("hotels", h.slug),
    lastmod: lastmodOf(h.updated_at, h.created_at),
    changefreq: "weekly",
    priority: "0.8",
  }));

  // A hotel's OTHER published pages — /hotels/:slug/:pageSlug (20260810000002).
  //
  // The home page is deliberately skipped: it is served at /hotels/:slug, which
  // is already in the list above. Emitting it a second time under its own slug
  // would advertise two URLs for identical content and split whatever ranking
  // the hotel earns between them.
  let pages = [];
  try {
    pages = await selectAll(env, "hotel_pages", {
      columns: "hotel_id,slug,is_home,is_published,updated_at,created_at",
      filters: "&is_published=eq.true&is_home=eq.false",
    });
  } catch (err) {
    // Same contract as everything else here: a missing table or a schema drift
    // costs us the sub-pages, never the sitemap.
    warn(`hotel sub-pages unavailable (${err.message}) — listing home pages only`);
    return entries;
  }

  for (const page of pages) {
    const hotelSlug = bySlug.get(page.hotel_id);
    // A page whose hotel is unpublished (or absent) has no reachable URL.
    if (!hotelSlug || !page.slug) continue;
    entries.push({
      loc: `${SITE}/hotels/${hotelSlug}/${page.slug}`,
      lastmod: lastmodOf(page.updated_at, page.created_at),
      changefreq: "weekly",
      priority: "0.7",
    });
  }

  return entries;
}

/**
 * Services have a `slug` column but NO per-service route — App.tsx routes only
 * /services, and the catalog renders every card on that one page. Emitting
 * /services/:slug would advertise URLs that all resolve to NotFound. So the
 * published services contribute a <lastmod> to the /services entry instead of
 * URLs of their own. If a service detail route ever ships, this is the function
 * that changes.
 */
async function servicesLastmod(env) {
  const rows = await selectAll(env, "services", {
    columns: "updated_at,created_at,is_published",
    filters: "&is_published=eq.true",
  });
  const stamps = rows
    .map((s) => lastmodOf(s.updated_at, s.created_at))
    .filter(Boolean)
    .sort();
  return { lastmod: stamps.at(-1) ?? null, count: rows.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const env = await loadEnv();
  const entries = [...STATIC_PAGES];

  const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!configured) {
    warn(
      "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are unset — " +
        "emitting static pages only. Set them in the Vercel project env to get listings."
    );
  } else {
    // Each source is settled independently: a failure in one must not cost us
    // the other two.
    const [properties, hotels, services] = await Promise.allSettled([
      propertyEntries(env),
      hotelEntries(env),
      servicesLastmod(env),
    ]);

    if (properties.status === "fulfilled") {
      entries.push(...properties.value.entries);
      log(`${properties.value.entries.length} public properties`);

      const facets = facetEntries(properties.value.visible);
      entries.push(...facets);
      log(
        `${facets.length} category pages at or above ${FACET_MIN_LISTINGS} listings` +
          " (the rest render but stay noindex until inventory catches up)"
      );
    } else {
      warn(`properties unavailable (${properties.reason?.message}) — skipping listings`);
    }

    if (hotels.status === "fulfilled") {
      entries.push(...hotels.value);
      log(`${hotels.value.length} published hotel pages`);
    } else {
      warn(`hotels unavailable (${hotels.reason?.message}) — skipping hotel pages`);
    }

    if (services.status === "fulfilled") {
      const servicesEntry = entries.find((e) => e.loc === urlFor("services"));
      if (servicesEntry && services.value.lastmod) servicesEntry.lastmod = services.value.lastmod;
      log(`${services.value.count} published services (folded into /services)`);
    } else {
      warn(`services unavailable (${services.reason?.message}) — /services keeps no lastmod`);
    }
  }

  let final = entries;
  if (entries.length > MAX_URLS) {
    warn(
      `${entries.length} URLs exceeds the ${MAX_URLS}-per-file sitemap limit. ` +
        "Truncating. Split this into a sitemap index before it matters."
    );
    final = entries.slice(0, MAX_URLS);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, renderSitemap(final), "utf8");
  log(`wrote ${path.relative(ROOT, OUT_FILE)} with ${final.length} URLs`);
}

// Top-level catch-all. Anything that escapes main() — a DNS failure, a bad
// JSON body, a typo in this file — still leaves a valid static sitemap behind
// and exits 0, because breaking `npm run build` over a sitemap is not a trade
// worth making.
try {
  await main();
} catch (err) {
  warn(`generation failed (${err?.message ?? err}) — falling back to static pages only`);
  try {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(OUT_FILE, renderSitemap(STATIC_PAGES), "utf8");
    log(`wrote fallback sitemap with ${STATIC_PAGES.length} URLs`);
  } catch (writeErr) {
    warn(`could not write any sitemap (${writeErr?.message ?? writeErr})`);
  }
}
process.exitCode = 0;
