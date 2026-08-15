#!/usr/bin/env node
/**
 * Find source files that nothing imports.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Three finished features shipped unreachable because a component was built
 * and then never mounted: the private-notes card (269 lines), the tenant card
 * and its dialog (603 lines), and the whole multi-page hotel manager (374
 * lines of hooks with no UI). Each was working code behind a permission gate
 * nobody could reach, and each was invisible to `tsc`, to eslint and to the
 * test suite — an unused module is not a type error.
 *
 * The rule is deliberately narrow: it reports MODULES NOTHING IMPORTS, not
 * unused exports. Unused exports are mostly types used within their own file
 * and produce far too much noise to act on; a file that nothing imports is
 * almost always either dead or a feature someone forgot to wire up, and both
 * are worth a look.
 *
 * Run: npm run orphans        (exit 1 if any are found, so CI can gate on it)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = "src";

/**
 * Entry points and files that are legitimately imported by nothing.
 *
 *  - App/main            the entry points themselves
 *  - src/test/**         vitest discovers these by filename, not by import
 *  - components/ui/**    vendored shadcn primitives; partial use is expected
 *  - vite-env.d.ts       ambient types
 */
const ALLOWED = [
  /^src[\\/]App\.tsx$/,
  /^src[\\/]main\.tsx$/,
  /^src[\\/]test[\\/]/,
  /^src[\\/]components[\\/]ui[\\/]/,
  /\.d\.ts$/,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((f) => relative(".", f));
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Every module specifier any file references.
 *
 * Covers the three shapes this codebase actually uses:
 *   import x from "…"      /  export … from "…"
 *   lazy(() => import("…"))   ← how every route is loaded; missing this
 *                                reports all 31 pages as orphans
 *   vi.mock("…")              ← test doubles
 */
const referenced = new Set();
for (const text of sources.values()) {
  for (const m of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) referenced.add(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) referenced.add(m[1]);
  for (const m of text.matchAll(/\bvi\.mock\(\s*["']([^"']+)["']/g)) referenced.add(m[1]);
}

/** The specifiers that could resolve to this file, in any style used here. */
function specifiersFor(file) {
  const posix = file.split(sep).join("/");
  const noExt = posix.replace(/\.(tsx|ts)$/, "");
  const bare = noExt.replace(/^src\//, "");
  const base = noExt.split("/").pop();
  const out = new Set([`@/${bare}`, noExt, posix]);
  // Relative imports resolve by basename from a sibling directory.
  for (const p of [`./${base}`, `../${base}`]) out.add(p);
  for (const r of [...referenced]) {
    if (r.endsWith(`/${base}`) || r === `./${base}`) out.add(r);
  }
  return out;
}

const orphans = files.filter((file) => {
  if (ALLOWED.some((re) => re.test(file))) return false;
  for (const spec of specifiersFor(file)) if (referenced.has(spec)) return false;
  return true;
});

if (orphans.length === 0) {
  console.log(`✓ no orphaned modules (${files.length} files scanned)`);
  process.exit(0);
}

console.error(`\n✗ ${orphans.length} module(s) that nothing imports:\n`);
for (const f of orphans.sort()) {
  const lines = sources.get(f).split("\n").length;
  console.error(`   ${String(lines).padStart(5)} lines  ${f}`);
}
console.error(
  "\nEach is either dead code to delete, or a finished feature nobody wired up.\n" +
    "If one is a deliberate entry point, add it to ALLOWED in scripts/find-orphans.mjs.\n",
);
process.exit(1);
