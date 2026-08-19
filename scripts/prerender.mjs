#!/usr/bin/env node
/**
 * Build-time prerender — writes one real HTML file per public route.
 *
 * ── WHAT PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * `vercel.json` rewrites every path to `/index.html`, so every route serves the
 * HOMEPAGE's head: its title, its description, and a canonical pointing at `/`.
 * `src/components/Seo.tsx` fixes that in the browser, but only for clients that
 * run JavaScript. Bingbot, the WhatsApp and Facebook unfurlers that are how
 * listings actually get shared in this market, and most LLM fetchers read the
 * HTML as served and stop. To all of them every page of this site is the same
 * page, with the same title, all claiming to be a duplicate of the home page.
 *
 * This rewrites the <head> of a copy of the shell for each route and writes it
 * to its own path, so `dist/property/<id>/index.html` is a real file with a real
 * title. Vercel serves a matching static file in preference to the rewrite, so
 * no configuration change is needed.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * NOT server-side rendering. The <body> is untouched — still the same empty
 * shell that boots the same SPA, and the client still renders and re-writes the
 * head exactly as before. That is deliberate: it means this step cannot change
 * what a visitor sees, and it cannot be the cause of a hydration mismatch. Full
 * body SSR is the next step and is now unblocked (App.tsx no longer reads
 * `window` at import time), but it is a much larger change with real regression
 * risk across auth, and it is not this.
 *
 * ── WHY IT NEVER FAILS THE BUILD ────────────────────────────────────────────
 * Same contract as scripts/generate-sitemap.mjs: a deploy that ships no site is
 * strictly worse than one whose per-route heads are missing. Every step is
 * guarded and any failure degrades to "leave dist/index.html alone, log loudly,
 * exit 0". The app still works; it just serves the old shared head until
 * somebody fixes the cause.
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SHELL = path.join(DIST, "index.html");
/** Where the compiled metadata module lands. Deleted afterwards. */
const META_OUT = path.join(ROOT, ".prerender");
/**
 * id -> canonical path, for generate-sitemap.mjs.
 *
 * The slug lives in TypeScript (src/lib/listing-url.ts) and the sitemap script
 * is plain Node, so rather than reimplement slugify there — the exact drift
 * this project keeps paying for — prerender writes what it already computed and
 * the sitemap reads it. Outside dist/ on purpose: it is a build artefact, not
 * something to serve.
 */
const MANIFEST = path.join(ROOT, ".prerender-manifest.json");

const log = (m) => console.log(`[prerender] ${m}`);
const warn = (m) => console.warn(`[prerender] WARNING: ${m}`);

// ── Env, matching generate-sitemap.mjs ───────────────────────────────────────

async function loadEnv() {
  const env = { ...process.env };
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) return env;
  try {
    for (const rawLine of (await readFile(envFile, "utf8")).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (env[key] !== undefined) continue;
      env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch (err) {
    warn(`could not read .env (${err.message})`);
  }
  return env;
}

async function selectAll(env, table, columns, filters = "") {
  const base = env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return [];
  const res = await fetch(
    `${base}/rest/v1/${table}?select=${encodeURIComponent(columns)}${filters}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`${table} → ${res.status} ${await res.text()}`);
  return await res.json();
}

// ── Head rewriting ───────────────────────────────────────────────────────────

const escapeAttr = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Replace one meta/link in the shell, or append it when the shell has none.
 *
 * Replacing rather than appending is the load-bearing half: index.html already
 * ships a description, a canonical and the full og:/twitter: set, and appending
 * would leave TWO canonicals on the page — which Google treats as none at all,
 * putting us back exactly where we started.
 */
function upsertTag(html, matcher, replacement) {
  return matcher.test(html)
    ? html.replace(matcher, replacement)
    : html.replace("</head>", `    ${replacement}\n  </head>`);
}

function applyHead(shell, tags) {
  let html = shell;

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(tags.title)}</title>`);

  const set = (attr, key, value) =>
    (html = upsertTag(
      html,
      new RegExp(`<meta\\s+${attr}=["']${key}["'][^>]*>`, "i"),
      `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`,
    ));

  set("name", "description", tags.description);
  set("property", "og:title", tags.title);
  set("property", "og:description", tags.description);
  set("property", "og:url", tags.canonical);
  set("property", "og:image", tags.image);
  set("name", "twitter:title", tags.title);
  set("name", "twitter:description", tags.description);
  set("name", "twitter:image", tags.image);

  html = upsertTag(
    html,
    /<link\s+rel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${escapeAttr(tags.canonical)}" />`,
  );

  if (tags.noindex) {
    set("name", "robots", "noindex, follow");
  }

  if (tags.jsonLd) {
    // Marked so it is distinguishable from the sitewide node index.html ships,
    // and so a re-run cannot stack two of them.
    html = html.replace(
      "</head>",
      `    <script type="application/ld+json" data-prerender>${tags.jsonLd}</script>\n  </head>`,
    );
  }

  return html;
}

async function writeRoute(routePath, html) {
  // "/" is dist/index.html; everything else is dist/<path>/index.html, which is
  // what a static host serves for an extensionless URL.
  const dir = routePath === "/" ? DIST : path.join(DIST, routePath);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), html, "utf8");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SHELL)) {
    warn("dist/index.html not found — run `vite build` first. Skipping.");
    return;
  }
  const shell = await readFile(SHELL, "utf8");

  // The metadata lives in TypeScript beside the code it reuses (see the header
  // of src/prerender-meta.ts), so it is compiled here rather than duplicated.
  log("compiling route metadata…");
  await build({
    logLevel: "error",
    build: {
      ssr: path.join(ROOT, "src/prerender-meta.ts"),
      outDir: META_OUT,
      emptyOutDir: true,
      copyPublicDir: false,
    },
  });
  const meta = await import(
    `file://${path.join(META_OUT, "prerender-meta.js").replace(/\\/g, "/")}`
  );

  const env = await loadEnv();
  const routes = [];
  /** id -> path, handed to the sitemap. */
  const listingPaths = {};

  routes.push(["/", meta.homeHead()]);
  routes.push(["/properties", meta.propertiesHead()]);
  routes.push([
    "/about",
    meta.staticHead(
      "/about",
      "About",
      "Who runs Mogadishu Rents, and how listing or renting through the platform works.",
    ),
  ]);
  routes.push([
    "/services",
    meta.staticHead(
      "/services",
      "Services in Mogadishu",
      "Moving, cleaning, maintenance and other services from providers working across Mogadishu.",
    ),
  ]);

  const configured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
  if (!configured) {
    warn(
      "VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY unset — prerendering static pages only. " +
        "Listings, category pages and hotels keep the shared head.",
    );
  } else {
    // Each source settled independently: losing hotels must not cost us listings.
    const [propertiesResult, hotelsResult, hotelPagesResult] = await Promise.allSettled([
      selectAll(
        env,
        "properties",
        "id,title,description,type,location,price,bedrooms,toilets,kitchens,living_rooms,purpose,is_available,is_daily_rate,is_hidden,is_listed,occupancy_status",
        "&is_available=eq.true&is_hidden=eq.false",
      ),
      selectAll(env, "hotels", "id,slug,name,tagline,description,hero_image_url,logo_url,is_published", "&is_published=eq.true"),
      selectAll(env, "hotel_pages", "hotel_id,slug,title,is_home,is_published", "&is_published=eq.true"),
    ]);

    let properties = [];
    if (propertiesResult.status === "fulfilled") {
      // Same visibility predicate the sitemap and the listing page apply.
      properties = propertiesResult.value.filter((p) => {
        const listed = p.is_listed !== false;
        const vacant = p.occupancy_status
          ? p.occupancy_status === "vacant"
          : p.is_available !== false;
        return listed && vacant;
      });
      for (const property of properties) {
        const routePath = meta.listingUrlPath(property);
        listingPaths[property.id] = routePath;
        routes.push([routePath, meta.listingHead(property)]);
      }
      log(`${properties.length} listings`);
    } else {
      warn(`properties unavailable (${propertiesResult.reason?.message}) — skipping listings`);
    }

    // Every facet, indexable or not: one that is below threshold still needs a
    // real page that says noindex, because internal links point at it.
    let facetCount = 0;
    for (const facet of meta.allFacetSlugs()) {
      const tags = meta.facetHead(facet, properties);
      if (!tags) continue;
      routes.push([`/properties/${facet}`, tags]);
      facetCount += 1;
    }
    log(`${facetCount} category pages`);

    if (hotelsResult.status === "fulfilled") {
      const hotels = hotelsResult.value.filter((h) => h.slug);
      for (const hotel of hotels) {
        routes.push([`/hotels/${hotel.slug}`, meta.hotelHead(hotel)]);
      }
      log(`${hotels.length} hotels`);

      if (hotelPagesResult.status === "fulfilled") {
        // Sub-pages only. The home page is already served at /hotels/:slug and
        // emitting it twice would be two URLs for identical content.
        const byId = new Map(hotels.map((h) => [h.id, h]));

        let subPages = 0;
        for (const page of hotelPagesResult.value) {
          if (page.is_home) continue;
          const hotel = byId.get(page.hotel_id);
          // A page whose hotel is unpublished has no reachable URL.
          if (!hotel || !page.slug) continue;
          routes.push([
            `/hotels/${hotel.slug}/${page.slug}`,
            meta.hotelHead(hotel, page.slug, page.title),
          ]);
          subPages += 1;
        }
        if (subPages > 0) log(`${subPages} hotel sub-pages`);
      }
    } else {
      warn(`hotels unavailable (${hotelsResult.reason?.message}) — skipping hotel pages`);
    }
  }

  for (const [routePath, tags] of routes) {
    await writeRoute(routePath, applyHead(shell, tags));
  }
  await writeFile(MANIFEST, JSON.stringify({ listingPaths }, null, 2), "utf8");
  log(`wrote ${routes.length} pre-rendered pages`);
}

try {
  await main();
} catch (err) {
  warn(`prerender failed (${err?.message ?? err}) — dist/index.html left as built`);
} finally {
  // The compiled metadata is a build artefact, not something to ship.
  await rm(META_OUT, { recursive: true, force: true }).catch(() => {});
}
process.exitCode = 0;
