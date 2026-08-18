import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Static guards for the product's strictest rule: a phone number is visible
 * only to its owner and to platform admins.
 *
 * This was a live data leak. `public.profiles` carried phone, phone2 and phone3
 * while its RLS policy was `FOR SELECT USING (true)` — so every number in the
 * database was readable by anyone holding the anon key, which ships in the
 * browser bundle. Hiding the field in React fixed nothing; the row still went
 * over the wire.
 *
 * The columns now live in `profile_contacts`, readable only by the owning user
 * or an admin. These tests fail if anyone reintroduces the old shape. They read
 * source text rather than running code, because the regression they guard
 * against is a *query* being written, not a function returning the wrong value
 * — there is no runtime seam to assert on.
 */

const SRC = resolve(__dirname, '..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Generated types legitimately describe every column, tests describe the rule.
      if (entry === 'test' || entry === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && entry !== 'types.ts') {
      acc.push(full);
    }
  }
  return acc;
}

const ALL_SOURCES = sourceFiles(SRC);
const read = (f: string) => readFileSync(f, 'utf8');
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/');

/** Public surfaces — a phone number must never reach any of these. */
const PUBLIC_COMPONENTS = [
  'components/PropertyCard.tsx',
  'components/FeaturedProperties.tsx',
  'pages/Properties.tsx',
  'pages/PropertyDetail.tsx',
  'pages/AgencyProfile.tsx',
  'pages/Index.tsx',
  'pages/Services.tsx',
];

describe('phone privacy', () => {
  it('has real source files to inspect', () => {
    // Guard the guard: a broken walker would make every test below vacuous.
    expect(ALL_SOURCES.length).toBeGreaterThan(20);
  });

  /** Every `.from("profiles")` in a file, paired with the columns it selects. */
  function profileSelects(src: string): string[] {
    const found: string[] = [];
    const re = /from\(\s*["'`]profiles["'`]\s*\)([\s\S]{0,400})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const select = /\.select\(\s*["'`]([^"'`]*)["'`]/.exec(m[1]);
      if (select) found.push(select[1]);
    }
    return found;
  }

  it('never selects a phone column from the profiles table', () => {
    const offenders: string[] = [];

    for (const file of ALL_SOURCES) {
      for (const columns of profileSelects(read(file))) {
        if (/\bphone\d?\b/.test(columns)) {
          offenders.push(`${rel(file)} → profiles.select("${columns}")`);
        }
      }
    }

    expect(
      offenders,
      `profiles is world-readable. Phone numbers live in profile_contacts, ` +
        `which only the owning user or a platform admin may read.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('does not select("*") from profiles in a public component', () => {
    // Narrower than the rule above on purpose. `select("*")` is safe today —
    // the phone columns are gone — but a public page fetching a stranger's
    // whole profile row starts leaking the moment anyone adds a private column.
    // Authenticated surfaces (Dashboard, ProfileSettings, Admin) read the
    // caller's own row or are admin-gated, so they are held to a lower bar.
    const offenders: string[] = [];

    for (const relPath of PUBLIC_COMPONENTS) {
      const full = join(SRC, relPath);
      if (!existsSync(full)) continue;

      for (const columns of profileSelects(read(full))) {
        if (columns.trim() === '*') {
          offenders.push(`${relPath} → profiles.select("*")`);
        }
      }
    }

    expect(
      offenders,
      `Ask for the columns you render.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('does not render public view totals on the property detail page', () => {
    const file = join(SRC, 'pages/PropertyDetail.tsx');
    const src = read(file);
    const offenders = [
      /property\.views\s*\|\|\s*0\s*\}\s*views/i,
      /views\s*\}/i,
    ].filter((pattern) => pattern.test(src));

    expect(
      offenders,
      'Anonymous visitors must never see the listing view total on the public property page.',
    ).toEqual([]);
  });

  it('limits view totals to the property owner only', () => {
    const detail = read(join(SRC, 'pages/PropertyDetail.tsx'));
    const dashboard = read(join(SRC, 'pages/Dashboard.tsx'));

    const ownerOnlyDetail = /currentUserId === property\.owner_id/.test(detail);
    const ownerOnlyDashboard = /platformRole === "owner"/.test(dashboard);
    const leakedToAdminOrManager =
      /isAdmin\s*\|\|\s*isSemiAdmin|ANALYTICS_VIEW|hotel_manager/.test(detail) ||
      /hotel_manager|semi_admin|admin/.test(dashboard);

    expect(ownerOnlyDetail, 'PropertyDetail must derive visibility from the owner match.').toBe(true);
    expect(ownerOnlyDashboard, 'Dashboard stats must be owner-only.').toBe(true);
    expect(
      leakedToAdminOrManager,
      'View totals must not be exposed to admins, semi-admins, or manager roles.',
    ).toBe(false);
  });

  it('does not reference profiles.phone / phone2 / phone3 anywhere', () => {
    const offenders: string[] = [];

    for (const file of ALL_SOURCES) {
      for (const [i, line] of read(file).split('\n').entries()) {
        // Property/owner objects sourced from `profiles`.
        if (/\b(profile|owner|ownerProfile)\.phone\d?\b/.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      offenders,
      `These columns were dropped from public.profiles and moved to ` +
        `profile_contacts.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('never renders an owner phone number in a public component', () => {
    const offenders: string[] = [];

    for (const relPath of PUBLIC_COMPONENTS) {
      const full = join(SRC, relPath);
      // Some of these are still being written by other agents.
      if (!existsSync(full)) continue;

      for (const [i, line] of read(full).split('\n').entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        // A phone value being interpolated into markup, or a tel: link.
        if (/\{[^}]*\bphone\b[^}]*\}/.test(line) || /href=\{?["'`]?tel:/.test(line)) {
          offenders.push(`${relPath}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    expect(
      offenders,
      `Renters must reach an owner through the inquiry flow, never a phone ` +
        `number. Only platform admins may see contact details.\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps org-private tables out of public components', () => {
    // property_private holds the owner's private notes; tenants holds a
    // tenant's phone. Neither may be queried from a public surface.
    const PRIVATE_TABLES = ['property_private', 'tenants'];
    const offenders: string[] = [];

    for (const relPath of PUBLIC_COMPONENTS) {
      const full = join(SRC, relPath);
      if (!existsSync(full)) continue;
      const src = read(full);

      for (const table of PRIVATE_TABLES) {
        if (new RegExp(`from\\(\\s*["'\`]${table}["'\`]`).test(src)) {
          offenders.push(`${relPath} queries ${table}`);
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
