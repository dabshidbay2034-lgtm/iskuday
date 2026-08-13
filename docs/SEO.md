# SEO & crawlability

Operational notes for `sitemap.xml`, `robots.txt`, and getting listings indexed.

---

## 1. How the sitemap is produced

`https://mogadishurents.com/sitemap.xml` is **generated at build time** by
`scripts/generate-sitemap.mjs` and written to `dist/sitemap.xml`. It is wired
into `package.json`:

```json
"build": "vite build && node scripts/generate-sitemap.mjs"
```

It runs *after* `vite build` because Vite wipes `dist/` on every build. There is
no checked-in `public/sitemap.xml` any more — it was deleted. If you re-add one
it will be overwritten by the generator, so don't.

Refreshing it means **deploying**. Any Vercel deploy — a push to `main`, or
`vercel --prod` — re-runs the query and re-emits the file. A new listing added
between deploys will not appear until the next one. If listings are being added
faster than deploys happen, add a Vercel Deploy Hook on a daily cron.

Run it locally without a full build: `npm run sitemap` (needs `dist/` to exist
and `.env` to be populated).

### Why build-time and not a Supabase edge function

The alternative was a `supabase/functions/sitemap` edge function serving
`application/xml`, with a `vercel.json` rewrite pointing `/sitemap.xml` at it.
That would always be fresh, with no deploy lag. It was rejected because:

- **This project's edge functions are not deployed.** `increment-view` and
  `send-notification` both 404 in production today (see `docs/DEPLOY_FUNCTIONS.md`).
  Putting the sitemap behind that same un-fired pipeline means the single file
  that tells Google what to crawl inherits a known-broken deploy dependency.
  A 404 at `/sitemap.xml` is worse than a sitemap that is a day stale.
- **It costs an invocation on every crawler fetch**, including from bots we get
  no value from.
- **A build step has no runtime failure mode.** Once the file is in `dist/` it
  is a static asset on Vercel's CDN. It cannot time out, rate-limit, or cold-start.

The cost is staleness between deploys. At the current rate of listings that is
the right trade. Revisit if listing volume ever outpaces deploy frequency —
that is the signal to switch to (a), not before.

### What the sitemap contains

| Entry | Source | changefreq | priority |
|---|---|---|---|
| `/` | static | daily | 1.0 |
| `/properties` | static | daily | 0.9 |
| `/services` | static, `lastmod` = newest published service | weekly | 0.7 |
| `/about` | static | monthly | 0.5 |
| `/privacy` | static | yearly | 0.3 |
| `/property/{id}` | every publicly visible listing | weekly | 0.8 |
| `/hotels/{slug}` | every hotel page where `is_published` | weekly | 0.8 |

`<lastmod>` comes from `updated_at`, falling back to `created_at`, and is
omitted entirely if neither parses.

**Property visibility mirrors `src/pages/Properties.tsx` exactly**:
`is_listed` true-or-null **AND** `occupancy_status` vacant-or-null **AND**
`is_available` **AND NOT** `is_hidden`. The two OR-groups are applied in JS in
the generator using the same expression the page uses at lines 131–133, so the
two can be diffed by eye. **If you change the filter on the Properties page,
change it in the generator too.** A sitemap that lists URLs rendering "Property
not found" is worse than one that omits them, because Google learns the file
lies and de-prioritises the whole thing.

**Services get no per-service URLs.** The `services` table has a `slug` column,
but `App.tsx` routes only `/services` — there is no `/services/:slug`. Emitting
one URL per service would advertise pages that all resolve to `NotFound`. So
published services contribute their newest `updated_at` as the `<lastmod>` on
`/services` instead. If a service detail route ever ships, update
`servicesLastmod()` in the generator to emit real URLs.

**Never in the sitemap**: `/signin`, `/signup`, `/dashboard`, `/manage/*`,
`/admin-panel`, `/semiadmin`, `/admin/*`, `/profile`, `/saved`,
`/complete-profile`, `/forgot-password`, `/reset-password`, `/join/*`. These are
authenticated-only, have nothing a search result could show, and `/join/:token`
carries a live invite credential in the URL.

`/agency/:orgId` is also omitted: the URL is an opaque Clerk org id and the page
is thin. Worth revisiting if agency profiles gain real content.

### Fail-soft behaviour

The generator **must never break `npm run build`**, and is written to that
contract:

- Missing `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` → logs a
  warning, emits the 5 static pages, exits 0.
- Supabase unreachable, timing out (20s cap), or returning a non-2xx → each of
  the three queries is settled independently via `Promise.allSettled`, so one
  failing source does not cost the other two. Whatever succeeded still ships.
- Anything else escaping `main()` → top-level catch writes the static-only
  sitemap and exits 0.
- `process.exitCode = 0` unconditionally.

Verified: with `.env` removed, and with `VITE_SUPABASE_URL=https://nope.invalid`,
the build completes and emits a valid 5-URL sitemap.

The trade is deliberate: **a deploy that ships no site is strictly worse than a
deploy whose sitemap is missing listings.** But it does mean a silent
degradation is possible — if Search Console suddenly reports 5 URLs instead of
21, check the Vercel build log for `[sitemap] WARNING`.

### The 50,000-URL ceiling

A sitemap file caps at 50,000 URLs / 50MB. We are at 21. The ceiling is three
orders of magnitude away, so a sitemap index would be pure ceremony today. The
generator logs a loud warning and truncates if the count ever exceeds `MAX_URLS`
— that warning is the cue to split into an index, not a thing to ignore.

### XML escaping

Every `<loc>` is percent-encoded per path segment and then XML-escaped
(`&`→`&amp;`, `<`, `>`, `"`, `'`). District names and titles reach these URLs,
and **one unescaped `&` makes the whole document unparseable** — Google rejects
the file, not just the bad URL.

---

## 2. robots.txt

Lives at `public/robots.txt`, shipped as a static asset.

### It is not a security control

`robots.txt` is world-readable. Every path listed in it is a path published to
the entire internet, and it only *asks* well-behaved crawlers not to fetch those
URLs. The actual protection for those routes is `<ProtectedRoute>` in
`src/App.tsx` plus row-level security in Postgres. **Never add a path there that
would be a problem to reveal, and never treat an entry there as "hidden".**

The previous version disallowed `/x9k2m-panel` and `/v7r3p-overview` — routes
that do not exist. Someone obfuscated the admin paths in robots.txt while
leaving the real ones (`/admin-panel`, `/semiadmin`) fully crawlable. Obfuscating
robots.txt buys nothing and costs you the actual blocks.

### What changed

- Removed `/x9k2m-panel` and `/v7r3p-overview` — neither route exists.
- Added the **real** private routes to all three user-agent groups:
  `/signin`, `/signup`, `/forgot-password`, `/reset-password`,
  `/complete-profile`, `/dashboard`, `/profile`, `/saved`, `/add-property`,
  `/manage/`, `/admin-panel`, `/semiadmin`, `/admin/`, `/join/`.
- Kept the `Sitemap:` line, and kept `Twitterbot` / `facebookexternalhit`
  unrestricted — those are link-preview unfurlers, not indexers, and blocking
  them breaks the WhatsApp/Facebook/X card that is how most listings get shared.

---

## 3. vercel.json

Three crawl-relevant changes:

1. **SPA rewrite now excludes `sitemap.xml` and `robots.txt`.** Vercel checks
   the filesystem before rewrites, so a present file already won — but if the
   sitemap ever fails to build we want `/sitemap.xml` to 404 honestly rather
   than serve `index.html` under an `.xml` URL. A crawler that parses HTML as a
   sitemap reports "invalid XML" and stops trusting the file.
2. **Explicit `Content-Type` headers** — `application/xml; charset=utf-8` for
   the sitemap, `text/plain; charset=utf-8` for robots. Plus a 1-hour
   `Cache-Control` so a stale sitemap never outlives a deploy by much.
3. **`www` → apex is now a permanent 308** (was a temporary 307). A 307 tells
   Google the split is provisional and leaves both hosts competing as separate
   origins. The apex is canonical in `index.html`, in the sitemap and in
   robots.txt, so the redirect should say so permanently and let link equity
   consolidate. *Note: browsers cache 308s aggressively — this is hard to walk
   back, which is fine because it reflects a settled architectural decision.*

`vercel.json` cannot carry comments: Vercel's schema sets
`additionalProperties: false` at every level, so even a `"comment"` key fails
validation and breaks the deploy. That is why the reasoning lives here.

---

## 4. Submitting to Google Search Console

1. Go to [Search Console](https://search.google.com/search-console) and add
   **`https://mogadishurents.com`** as a property. Prefer the **Domain**
   property type (DNS TXT record) — it covers apex, `www`, and every hotel
   subdomain in one place. A URL-prefix property would need a separate entry per
   host.
2. Verify ownership via the DNS TXT record with your domain registrar.
3. **Sitemaps** in the left nav → enter `sitemap.xml` → **Submit**.
4. Come back in 24–48h. Status should read *Success* with a discovered-URL count
   matching the `[sitemap] wrote …` line in the Vercel build log. If it reads
   *Couldn't fetch*, load `https://mogadishurents.com/sitemap.xml` in a browser
   first — an HTML page or a 404 there is the real problem.

Repeat for [Bing Webmaster Tools](https://www.bing.com/webmasters); it can
import the Search Console setup directly.

---

## 5. Verifying

**Sitemap is live and well-formed**

```bash
curl -sI https://mogadishurents.com/sitemap.xml   # expect 200 + application/xml
curl -s  https://mogadishurents.com/sitemap.xml | head -20
curl -s  https://mogadishurents.com/robots.txt
```

Confirm no `/signin`, `/signup`, `/dashboard`, or `/join/` URL appears in the
sitemap, and that the `Sitemap:` line is present in robots.txt.

**robots.txt rules** — Search Console → Settings → **robots.txt report**. Check
that a `/property/...` URL is *Allowed* and `/dashboard` is *Disallowed*.

**URL Inspection** (Search Console, top search bar) — paste a live property URL.
Look at:
- *URL is on Google* / *not on Google*
- **Test Live URL** → **View Tested Page** → **Screenshot** and **HTML**. This
  is the one that matters for this app: if the screenshot shows the loading
  spinner rather than the listing, Googlebot is not getting the rendered page.
- **Request Indexing** for individual pages you want in fast.

**Rich Results Test** — <https://search.google.com/test/rich-results>. Paste a
property URL and confirm the structured data (owned by `src/lib/structured-data.ts`)
is detected with no errors. Detected types should be relevant to the page —
a listing should not report the same generic type as the homepage.

Also check social previews, since those matter more than search for how listings
actually spread here:
- <https://developers.facebook.com/tools/debug/> (WhatsApp uses the same OG tags)
- <https://cards-dev.twitter.com/validator>

---

## 6. After deploying — checklist

- [ ] Vercel build log contains `[sitemap] wrote dist/sitemap.xml with N URLs`
      and **no** `[sitemap] WARNING` lines.
- [ ] N matches roughly `5 + (public listings) + (published hotel pages)`.
- [ ] `/sitemap.xml` returns 200 with `application/xml`.
- [ ] `/robots.txt` returns 200 and contains the `Sitemap:` line.
- [ ] `https://www.mogadishurents.com/properties` 308s to the apex.
- [ ] Spot-check three property URLs from the sitemap in a browser — every one
      must render a listing, not "Property not found".
- [ ] Search Console → Sitemaps shows *Success*.
- [ ] Search Console → Pages, a week later: *Indexed* count is climbing and the
      *Discovered – currently not indexed* bucket is not the majority.

---

## 7. The honest caveat: this is a client-rendered SPA

Everything above helps Google **find** the URLs. It does not change the fact
that every one of them serves an empty `<div id="root">` and a JavaScript bundle.

Google does execute JavaScript, but rendering happens in a second pass on a
separate, slower queue. In practice that means:

- **Slower indexing.** Days-to-weeks rather than hours, especially for a new
  domain with little authority.
- **Less reliable indexing.** If the render times out, a Supabase query fails,
  or the bundle errors, Googlebot indexes the empty shell. The URL Inspection
  screenshot is how you catch this — a spinner in that screenshot is the
  smoking gun.
- **Bing, and most AI crawlers, are worse at it than Google.** Several execute
  no JavaScript at all, so they see nothing but the shell.
- **Social unfurlers execute no JavaScript, ever.** WhatsApp, Facebook and X
  read only the `<meta>` tags present in the initial HTML response. Per-listing
  OG tags injected client-side by `src/components/Seo.tsx` are invisible to
  them — every share gets the generic site-wide card from `index.html`.

**If indexing stays thin after 4–6 weeks with a healthy sitemap, prerendering
the public routes is the next step** — not more sitemap tuning. The public
surface is small and well-bounded (`/`, `/properties`, `/property/:id`,
`/hotels/:slug`, `/services`, `/about`, `/privacy`), which makes it tractable.
Options, roughly in order of effort:

1. **Prerender at build time** (e.g. `vite-plugin-prerender` or a Puppeteer pass
   over the same URL list this generator already computes) — emits real HTML per
   route, no server needed, and reuses the sitemap query. Goes stale between
   deploys exactly like the sitemap does.
2. **Vercel prerendering / a bot-detecting edge middleware** that serves cached
   HTML to crawlers and the SPA to humans.
3. **Migrate to a framework with SSR.** Correct long-term, largest change.

Option 1 is the natural pairing with the build-time sitemap: same trigger, same
data, same staleness profile, and it fixes the social-preview gap at the same
time.
