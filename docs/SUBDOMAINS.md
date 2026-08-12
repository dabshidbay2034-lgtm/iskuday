# Hotel subdomains — `<hotel>.mogadishurents.com`

Every hotel can be served from its own subdomain so its page reads as **their**
website rather than a page inside ours. `jazeera.mogadishurents.com` shows the
Jazeera hotel's logo, colours, nav and footer — no MogadishuRents header.

This document is the runbook: DNS, Vercel, Clerk, RLS, SEO, PWA, local dev, and a
verification checklist. Read the **Clerk** section before you promise anyone a
launch date — it is the only part of this that can actually block shipping.

---

## 0. How resolution works in the code

| File | Role |
| ---- | ---- |
| `src/lib/tenant.ts` | Pure `hostname → Tenant` resolution. No DOM, no network, unit-testable. |
| `src/components/hotel/TenantShell.tsx` | The hotel's own chrome (header / nav / footer) plus the by-subdomain lookup. |
| `vercel.json` | SPA rewrite (unchanged) + `www` → apex redirect. |
| `hotels.subdomain` | The unique, DNS-label-safe column the lookup keys off (migration `20260810000001`). |

```ts
import { resolveTenant } from "@/lib/tenant";

const tenant = resolveTenant();          // reads window.location by default
if (tenant.kind === "hotel") { /* tenant.subdomain */ }
```

### The resolution table

| Host | Result | Why |
| ---- | ------ | --- |
| `mogadishurents.com` | platform | the apex is us |
| `www.mogadishurents.com` | platform | `www` is reserved (and redirected to apex, see §2) |
| `jazeera.mogadishurents.com` | hotel `jazeera` | the normal case |
| `admin.mogadishurents.com` | platform | reserved label |
| `a.b.mogadishurents.com` | platform | a `*.domain` cert covers **one** label only — deeper names fail TLS before our code runs |
| `mogadishu-rents-git-x7f2.vercel.app` | **platform** | preview deploys are never tenants — see below |
| `localhost` / `127.0.0.1` | platform | |
| `jazeera.localhost:8080` | hotel `jazeera` | local dev |
| `localhost:8080/?__tenant=jazeera` | hotel `jazeera` | local/preview override |
| `mogadishurents.com/?__tenant=jazeera` | platform | override is **ignored** on the production domain |
| anything else | platform | |

Two of those are deliberate defences, not accidents:

- **`*.vercel.app` is always platform.** A preview host looks like
  `mogadishu-rents-git-abc123-team.vercel.app`. Treating its first label as a
  subdomain means every preview deploy resolves to a hotel named `mogadishu-rents-git-abc123-team`,
  which does not exist — so **every preview 404s**. `tenant.ts` only ever reads a
  subdomain off `mogadishurents.com` and `localhost`; nothing else.
- **`?__tenant=` is ignored on the production domain.** Otherwise
  `https://mogadishurents.com/?__tenant=somebody` would dress our apex up as
  somebody else's hotel — a free phishing primitive, for no benefit, since the
  real subdomain works there anyway.

`RESERVED_SUBDOMAINS` is `www, app, api, admin, mail, staging, dev`. See §3 for
labels you **must add** to it if you stand up a Clerk production instance.

### Routing contract (for whoever wires the routes)

`TenantShell` renders chrome only; the body is `children`. Its nav links point at:

- `/` — the hotel's home page
- `/<page-slug>` — one published `hotel_pages` row (`tenantPagePath()` exports this)

If the routing step chooses different paths, change `tenantPagePath` — it is the
single place those hrefs are built.

---

## 1. DNS

One wildcard record. On the DNS provider that holds `mogadishurents.com`:

```
*.mogadishurents.com.   CNAME   cname.vercel-dns.com.
```

Keep the apex pointing wherever Vercel tells you it should (an `A` record to
`76.76.21.21`, or `ALIAS`/`ANAME` to `cname.vercel-dns.com` if your provider
supports it at the apex).

**Explicit records beat the wildcard.** A wildcard only answers names that have
no record of their own, so existing `clerk.`, `accounts.`, `mail.` and any
`_dmarc`/`_domainkey` records keep working untouched. That is also why any label
used by another service must be in `RESERVED_SUBDOMAINS` — otherwise a hotel
could claim `clerk` in the UI and be permanently broken by DNS it cannot see.

Verify (give DNS 5–30 minutes, longer if the zone has a big TTL):

```bash
dig +short anything-at-all.mogadishurents.com     # → cname.vercel-dns.com.
dig +short clerk.mogadishurents.com               # → unchanged, NOT the wildcard
```

```powershell
nslookup anything-at-all.mogadishurents.com
nslookup clerk.mogadishurents.com
```

---

## 2. Vercel

1. Project → **Settings → Domains → Add** → `*.mogadishurents.com`.
2. Keep `mogadishurents.com` attached as well. `www.mogadishurents.com` can be
   attached too; `vercel.json` redirects it to the apex regardless (see below).

**The wildcard-certificate constraint.** A `*.mogadishurents.com` TLS certificate
can only be issued through a **DNS-01** ACME challenge — the CA requires a TXT
record at `_acme-challenge.mogadishurents.com`, because there is no single HTTP
host to serve a file from. That means one of:

- **Nameservers on Vercel** (`ns1.vercel-dns.com` / `ns2.vercel-dns.com`) — Vercel
  writes and rotates the challenge record itself. **This is the recommended
  setup**: issuance and every renewal are automatic.
- **External DNS** — you add the verification TXT record Vercel shows you by
  hand, and you are responsible for it still being correct at renewal. Delegate
  it once with `_acme-challenge.mogadishurents.com CNAME <target Vercel gives you>`
  if your provider allows, so renewals stop being a manual chore.

If the wildcard domain sits in "Invalid Configuration" in the dashboard, it is
almost always this TXT record. Confirm the exact current requirement in the
Vercel dashboard when you add the domain — it tells you which records it wants.

### What changed in `vercel.json`

```json
{
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ],
  "redirects": [
    {
      "source": "/(.*)",
      "has": [{ "type": "host", "value": "www.mogadishurents.com" }],
      "destination": "https://mogadishurents.com/$1",
      "permanent": false
    }
  ]
}
```

- **The SPA rewrite is byte-for-byte unchanged.** Nothing had to be added for
  wildcard hosts: Vercel applies a project's routing config to *every* domain
  attached to that project, so `jazeera.mogadishurents.com/anything` already
  lands on the same `index.html` the apex serves. Tenant resolution then happens
  in the browser. If you find yourself adding `has: host` rules to make the
  wildcard work, something else is wrong — check the domain is attached first.
- **Added:** `www` → apex redirect. With subdomains in play we need exactly one
  canonical origin for the platform: it is where the canonical URL in
  `index.html` points, and (per §3) it is where every authenticated session
  lives. Two working platform origins means duplicate content for Google and a
  class of "I'm signed in on one and not the other" bug reports.
- It is `permanent: false` (307) **on purpose**. A 308 is cached by browsers
  effectively forever and is painful to undo. Flip it to `"permanent": true`
  once you have watched it behave in production for a few days.

---

## 3. Clerk — the real blocker

**Read this before building anything authenticated on a subdomain.**

### What breaks

Clerk sessions are **domain-scoped**. The session cookie Clerk sets while a user
signs in on `https://mogadishurents.com` is not, by default, presented by the
browser to `https://jazeera.mogadishurents.com`, and Clerk's Frontend API will
not accept a request from an origin it has not been told about. Concretely, on a
hotel subdomain today:

- `useAppAuth()` reports **signed out**, even for a user who signed in on the
  apex seconds earlier.
- `window.Clerk.session` is `undefined`, so the `accessToken` callback in
  `src/integrations/supabase/client.ts` returns `null` and **every Supabase query
  runs as anonymous**.
- Anything gated behind `<ProtectedRoute>` bounces to sign-in, and signing in
  from the subdomain either fails on origin checks or lands the user back on the
  apex, still signed out from the subdomain's point of view.

This is not a bug we can patch around in app code. It is how browser cookies and
Clerk's origin allowlist work.

### What you would have to configure to change that

Clerk's supported mechanism for one app across several origins is **satellite
domains**: one primary domain plus explicitly registered satellites, with a
handshake redirect through the primary on sign-in, and each satellite's
`ClerkProvider` configured with `isSatellite`, `domain` and an absolute
`signInUrl` pointing at the primary. Separately, the instance's **allowed
origins** must include the origins that talk to the Frontend API.

The problem is scale: satellites are **registered per domain**. A platform where
every hotel mints a new subdomain would need a satellite (and an allowed origin)
registered for each one, at signup time, through Clerk's API — with whatever
per-plan limits, quotas and propagation delays that carries. Wildcard satellite
registration is not something to assume exists.

> **Verify against the current Clerk documentation and your plan's limits before
> shipping any of this.** The details above are the shape of the problem, not a
> quote from today's docs; Clerk has changed multi-domain handling before. Check:
> whether wildcard origins are accepted, whether satellites can be created via
> API at tenant-creation time, and what a production instance actually sets its
> session cookie domain to.

Also note that a Clerk **production** instance adds its own DNS records under
`mogadishurents.com` (typically `clerk`, `accounts`, `clkmail` and two
`clk._domainkey*` CNAMEs). Those are explicit records so the wildcard leaves them
alone (§1) — but **add `clerk` and `accounts` to `RESERVED_SUBDOMAINS` in
`src/lib/tenant.ts` the day you create that instance**, or a hotel will be able to
claim a label whose DNS points at Clerk.

### Recommendation: keep all authenticated work on the apex

**Subdomains serve public, anonymous content only. Every signed-in surface —
sign-in, sign-up, `/manage`, the hotel page builder, payroll, bookings admin —
stays on `https://mogadishurents.com`.**

This is the recommendation, and the reasons are not stylistic:

1. **It ships now.** It needs zero Clerk configuration, because there is no
   session on the subdomain to get wrong.
2. **The failure mode is the safe one.** No Clerk session on a tenant host means
   the Supabase client sends no token, so the subdomain can only ever read what
   an anonymous visitor may read. There is no configuration mistake that turns a
   public tenant site into a data leak.
3. **The blast radius of a Clerk misconfiguration is otherwise the whole
   platform.** Allowed-origin and satellite settings are instance-wide. Getting
   them wrong to serve tenant sites can lock users out of the apex too.
4. **Owners lose very little.** They edit at `mogadishurents.com/manage` — the
   same place they already do — and their public site is at their own address.

**The cost, stated plainly:** an owner cannot click "Edit this page" while
browsing their own subdomain and stay in place. Those links must jump to the
apex. `TenantShell` therefore assumes nothing about auth, and `platformUrl()` in
`src/lib/tenant.ts` exists to build those absolute jumps correctly from any
environment. If product later insists on in-place editing, that is the point at
which you spend the time on satellite domains — and you re-read Clerk's current
docs first.

---

## 4. Supabase & RLS

**Nothing about RLS changes, and nothing about it should.**

The hotel is resolved from the hostname **in the browser**, and then looked up
with an ordinary `select … eq("subdomain", …)`. The existing policy from
`20260808000001` still decides what comes back:

```sql
-- "Published hotel pages are public"
USING (
  is_published = true
  OR owner_id = auth.jwt()->>'sub'
  OR (org_id IS NOT NULL AND org_id = public.current_org_id())
  OR public.has_role(auth.jwt()->>'sub', 'admin')
)
```

An anonymous visitor on `jazeera.mogadishurents.com` sends no JWT, so they get
published rows and nothing else — which is exactly what they would get asking for
the same hotel from the apex. A draft returns no row, and `TenantShell` renders
the "no hotel here" page.

> **Never let a hostname become an authorization input.** It is fully
> attacker-controlled: anyone can point a CNAME at us, spoof a `Host` header, or
> append `?__tenant=`. "This request came from `jazeera.`, so it may read
> Jazeera's data" is a vulnerability, not a feature. The tenant is a
> *presentation* decision. Postgres decides who may read what, from the JWT.

The same rule applies to any future Edge Function or API route: authorize from
the verified Clerk JWT, never from `req.headers.host`.

---

## 5. SEO

- **Canonicals.** `index.html` hardcodes `<link rel="canonical" href="https://mogadishurents.com/">`.
  On a tenant host that is actively harmful — it tells Google that every page of
  the hotel's site is really our home page. Whatever renders tenant pages must
  overwrite the canonical (and `og:url`) to the tenant origin, e.g.
  `https://jazeera.mogadishurents.com/rooms`. The apex copy of the same page
  (`/hotels/jazeera`) should then canonicalise **to the subdomain**, so the two
  URLs do not compete.
- **`robots.txt` and `sitemap.xml` are apex-only.** `public/robots.txt` is served
  byte-identically on every subdomain, including its
  `Sitemap: https://mogadishurents.com/sitemap.xml` line and its `Disallow`
  entries for apex-only paths like `/dashboard`. `public/sitemap.xml` lists only
  apex URLs, so **no tenant page is in any sitemap**. Neither blocks indexing —
  crawlers still follow links — but tenant pages will be discovered slowly. The
  fix is a generated per-host sitemap (a serverless function that reads the
  `Host` header and emits that hotel's published pages); that is a separate piece
  of work, not part of this change.
- **Subdomains are separate sites to Google.** A hotel's subdomain does not
  inherit the apex's authority, and vice versa. That is the correct trade for
  "it's their website", but set expectations: a new tenant site starts from zero.

---

## 6. PWA

The service worker is **scoped per origin**. `vite-plugin-pwa` registers
`/sw.js` at the root of whatever host served the page, so:

- Every hotel subdomain installs its **own** service worker and its **own** cache
  storage. Nothing is shared with the apex — a user who has the MogadishuRents
  PWA installed still gets a cold cache on `jazeera.mogadishurents.com`.
- The **install prompt fires per host too.** A visitor can be prompted to install
  "MogadishuRents" on the apex and again on each tenant site. The manifest served
  is the apex one (`name: "MogadishuRents — Home Rental"`, `start_url: "/"`), so
  a hotel's install prompt currently offers **our** name and icon on **their**
  domain, which contradicts the entire point. Either serve a per-host manifest or
  suppress the install UI on tenant hosts — decide before launch.
- Anything cached under a tenant origin persists there independently. When
  debugging "the subdomain is showing an old build", clear the site data for that
  exact origin, not for the apex.
- `navigateFallbackDenylist: [/^\/~oauth/]` in `vite.config.ts` still applies on
  every host. It is unrelated to tenancy but do not drop it — the SW must not
  swallow Clerk's OAuth callback path.

---

## 7. Local development

Wildcard DNS and a wildcard certificate exist only on the real domain, so there
are two supported ways to work on tenant rendering locally:

1. **`<sub>.localhost:8080`** — Chrome, Firefox and Safari resolve any
   `*.localhost` name to loopback with no hosts-file entry. Run `npm run dev` and
   open `http://jazeera.localhost:8080`. This is the highest-fidelity option: the
   hostname really is a subdomain, so the same code path runs as in production.
2. **`?__tenant=<sub>`** — `http://localhost:8080/?__tenant=jazeera`. Use this
   when a real subdomain is not available: Safari on some older iOS versions,
   corporate DNS that hijacks unknown names, containers, and **preview deploys**
   (`https://<preview>.vercel.app/?__tenant=jazeera`), which have no wildcard
   certificate.

The override is ignored on `mogadishurents.com` itself (§0). It is a development
affordance, not a production feature.

---

## 8. Verification checklist

Run this in order after setup. Every step has an observable result.

**DNS**

- [ ] `dig +short jazeera.mogadishurents.com` → `cname.vercel-dns.com.`
- [ ] `dig +short nonexistent-hotel.mogadishurents.com` → same CNAME (the wildcard answers everything)
- [ ] `dig +short mogadishurents.com` → the apex target Vercel asked for
- [ ] Any pre-existing subdomain (`clerk`, `mail`, …) still resolves to its own target, not the wildcard

**TLS & Vercel**

- [ ] Vercel → Settings → Domains shows `*.mogadishurents.com` as **Valid Configuration**
- [ ] `curl -sI https://jazeera.mogadishurents.com | head -1` → `HTTP/2 200` with no certificate warning
- [ ] `curl -sI https://really-anything.mogadishurents.com | head -1` → also 200 (the wildcard cert covers unknown labels)
- [ ] `curl -sI https://www.mogadishurents.com` → `307` with `location: https://mogadishurents.com/`
- [ ] `curl -s https://jazeera.mogadishurents.com/some/deep/path | grep -c "<div id=\"root\">"` → `1` (SPA rewrite reaches the wildcard host)

**Tenant resolution**

- [ ] `https://jazeera.mogadishurents.com` shows the **hotel's** logo/name, not the MogadishuRents header
- [ ] The nav lists that hotel's published pages, and only published ones
- [ ] `https://mogadishurents.com` still shows the platform header — unchanged
- [ ] `https://www.mogadishurents.com` lands on the platform after the redirect
- [ ] `https://admin.mogadishurents.com` (reserved) shows the **platform**, not a hotel
- [ ] `https://no-such-hotel.mogadishurents.com` shows the friendly "there's no hotel here yet" page, not a blank screen or a raw 404
- [ ] An **unpublished** hotel's subdomain shows "isn't live yet" to a signed-out visitor
- [ ] Open a **preview deploy** URL → it renders the **platform**, not a 404 (the `*.vercel.app` guard)
- [ ] `https://<preview>.vercel.app/?__tenant=jazeera` renders the tenant shell
- [ ] `https://mogadishurents.com/?__tenant=jazeera` renders the **platform** (override correctly ignored)

**Auth boundary (per the §3 recommendation)**

- [ ] Sign in on the apex, then open a tenant subdomain — the page still renders fine as a public site
- [ ] In the console on the tenant host: `window.Clerk?.session` is `undefined` — expected, and harmless
- [ ] The tenant site exposes **no** links into `/manage`, `/dashboard` or the builder that assume a session; any editing link goes to `https://mogadishurents.com/…`
- [ ] Network tab on the tenant host: Supabase requests carry **no** `Authorization` header and still return the published hotel

**Data safety**

- [ ] With the browser signed out, a draft hotel's subdomain returns no row (check the Supabase response body, not just the UI)
- [ ] No code path passes `window.location.hostname` into a query as anything but a `subdomain` filter

**Regressions**

- [ ] `/hotels/<slug>` on the apex still works exactly as before
- [ ] `npm run test` and `npm run typecheck` pass
