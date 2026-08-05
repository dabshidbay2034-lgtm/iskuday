# MogadishuRents

> Canonical project context, shared by every coding agent used here (Claude Code, Gemini
> CLI, Qwen Code). `GEMINI.md` and `QWEN.md` are thin pointers to this file — edit **this**
> file, not those.

A property rental marketplace for Mogadishu — houses, apartments, hotels and commercial
units. Single-page React app talking directly to Supabase (auth, Postgres, storage).
Originally scaffolded with Lovable; pushes to `main` sync back to the Lovable project.

## Stack

- **Vite 8** + **React 18** + **TypeScript** (`@vitejs/plugin-react-swc`)
- **shadcn/ui** (Radix primitives) + **Tailwind CSS 3**
- **Supabase** (`@supabase/supabase-js`) for auth, database, storage
- **TanStack Query** for server state, **React Router 6** for routing
- **Vitest** + Testing Library (jsdom) for tests
- **vite-plugin-pwa** — the app installs as a PWA
- Deployed on **Vercel** (SPA rewrites in `vercel.json`)

## Commands

```sh
npm i             # .npmrc sets legacy-peer-deps=true — required
npm run dev       # dev server on http://localhost:8080
npm run build     # production build
npm run lint      # eslint
npm run typecheck # REAL typecheck — see the warning below
npm run test      # vitest run (single pass)
npm run test:watch
```

Use **npm**. `bun.lock`/`bun.lockb` are leftovers from Lovable — don't regenerate them or
switch package managers.

## Layout

```
src/
  App.tsx                     all routes, lazy-loaded, wrapped in ProtectedRoute
  pages/                      one file per route (16 pages)
  components/                 app components
  components/ui/              shadcn/ui primitives — generated, avoid hand-editing
  hooks/                      use-favorites, use-mobile, use-toast
  lib/types.ts                domain types (Property, UserProfile, PropertyType, UserRole)
  lib/districts.ts            Mogadishu district list used by search/filters
  integrations/supabase/      client.ts + types.ts — BOTH AUTO-GENERATED, do not edit
  test/                       vitest setup + tests
supabase/
  migrations/                 SQL migrations, timestamp-prefixed
  functions/increment-view/   edge function bumping property view counts
```

`temp-repo/` is a stray duplicate clone of this repo. Ignore it — never read from or write
to it.

## Conventions

- Import via the `@` alias (`@/components/...`, `@/lib/utils`), never long relative paths.
- New pages: create in `src/pages/`, add a `lazy()` import and a `<Route>` in `src/App.tsx`.
  Gate access with `<ProtectedRoute allowedRoles={[...]}>` when the page isn't public.
- Compose UI from `src/components/ui/` primitives and Tailwind classes; use `cn()` from
  `@/lib/utils` to merge class names. No CSS modules or styled-components.
- TypeScript here is **non-strict** (`strict: false`, `noImplicitAny: false`) and
  `@typescript-eslint/no-unused-vars` is off. Match the surrounding style rather than
  tightening types across files you're only passing through.
- Data fetching goes through TanStack Query against the `supabase` client from
  `@/integrations/supabase/client`.

## Domain model

Supabase tables: `profiles`, `properties`, `property_images`, `favorites`, `inquiries`,
`user_roles`. RPCs: `has_role`, `increment_property_view`.

- `PropertyType`: `house` | `apartment` | `hotel` | `commercial`. Hotels price per night
  (`is_daily_rate`); type-specific fields on `Property` are optional (bedrooms, floor_number,
  has_balcony, …) — see `src/lib/types.ts`.
- `UserRole`: `user` | `owner` | `hotel_manager` | `agent` | `admin` | `semi_admin`.
  Owners/agents list properties; admin and semi_admin have their own panels.

Schema changes need a new timestamped file in `supabase/migrations/`. Row-level security is
enforced in the database — when adding a table or column, add the matching RLS policy in the
same migration.

## Environment

`.env` (gitignored, never commit) provides:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Only the publishable/anon key belongs in client code. Anything requiring a service-role key
must live in a Supabase edge function under `supabase/functions/`.

## Working agreements

- Don't commit or push unless asked.
- Test coverage is thin (`src/test/example.test.ts` is a placeholder) — add tests next to
  the logic you change rather than assuming a suite exists.
- Run `npm run lint`, `npm run typecheck` and `npm run test` before calling a
  change done.
- **Never verify with bare `tsc --noEmit`.** `tsconfig.json` is a solution-style
  config (`"files": []` plus project references), so that command compiles zero
  files and exits 0 no matter how broken the code is. It silently reported
  "clean" across a whole migration here while 20+ real errors existed. Always
  use `npm run typecheck`, which targets the actual projects.
