/**
 * Hostname → tenant resolution.
 *
 * Every hotel can be served from its own `<subdomain>.mogadishurents.com` so the
 * page reads as THEIR website rather than a page inside ours. Which hotel we are
 * looking at is therefore a property of the HOSTNAME, not of the route — this
 * module is the one place that decision is made.
 *
 * Deliberately pure: the only input is a hostname string (plus, for the dev
 * escape hatch, a query string). No React, no DOM beyond reading defaults from
 * `window.location`, no network. That keeps it unit-testable and keeps the rule
 * set — which has several non-obvious edge cases — verifiable in isolation.
 *
 * NAMING: "tenant" here means a multi-tenancy tenant — one hotel's slice of the
 * platform. It has nothing to do with `manage/tenant-card.tsx`, where a tenant is
 * a person renting a unit.
 *
 * SECURITY: the resolved tenant is a PRESENTATION decision only. The hostname is
 * attacker-controlled (anyone can point a CNAME at us, and `?__tenant=` is just a
 * query param) so it must never be used as an authorization input. What a visitor
 * may read is decided by Supabase RLS against their Clerk JWT — see docs/SUBDOMAINS.md.
 */

/** The apex the platform itself lives on. Wildcard tenants hang off this. */
export const PLATFORM_ROOT_DOMAIN = "mogadishurents.com";

export type Tenant = { kind: "platform" } | { kind: "hotel"; subdomain: string };

/**
 * Labels a hotel may never claim. These are either already in use, reserved for
 * infrastructure, or would let a tenant impersonate the platform.
 */
export const RESERVED_SUBDOMAINS = [
  "www",
  "app",
  "api",
  "admin",
  "mail",
  "staging",
  "dev",
] as const;

/**
 * Dev/preview escape hatch: `https://<preview>.vercel.app/?__tenant=jazeera`.
 * Needed because wildcard DNS + a wildcard TLS cert exist only on the real
 * domain — you cannot get either on `localhost` or on a preview deploy.
 */
export const TENANT_QUERY_PARAM = "__tenant";

/** A single DNS label: a-z, 0-9 and inner hyphens, max 63 chars. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const RESERVED = new Set<string>(RESERVED_SUBDOMAINS);

// ── Host helpers ─────────────────────────────────────────────────────────────

/**
 * `window.location.hostname` never carries a port, but callers and tests
 * routinely pass a `host` ("jazeera.localhost:8080"), and a fully-qualified name
 * ("jazeera.mogadishurents.com.") is the same host as its unrooted form.
 */
function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

function runtimeHostname(): string {
  // "" resolves to platform, which is the right answer for SSR / node tests.
  return typeof window === "undefined" ? "" : window.location.hostname;
}

function runtimeSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

/** Is this host the production apex or something under it? */
function isPlatformDomain(host: string): boolean {
  return host === PLATFORM_ROOT_DOMAIN || host.endsWith(`.${PLATFORM_ROOT_DOMAIN}`);
}

/** True for a syntactically valid, non-reserved hotel subdomain. */
export function isReservedSubdomain(label: string): boolean {
  return RESERVED.has(label.trim().toLowerCase());
}

/**
 * Coerce user input to a usable subdomain, or null if it can't be one.
 * Shared by the resolver and by anything that validates an owner's chosen label.
 */
export function normalizeSubdomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const label = input.trim().toLowerCase();
  if (!DNS_LABEL.test(label)) return null;
  if (isReservedSubdomain(label)) return null;
  return label;
}

/**
 * The tenant implied by the host alone, or null when the host says "platform".
 *
 * Only ONE level of subdomain is ever a tenant. `a.b.mogadishurents.com` is
 * platform because a `*.mogadishurents.com` certificate does not cover it — the
 * browser would fail the TLS handshake before this code ever ran, so treating it
 * as a tenant would only hide the misconfiguration.
 */
function tenantFromHost(host: string): Tenant | null {
  const suffix = hostSuffix(host);
  if (!suffix) return null;

  const label = host.slice(0, -(suffix.length + 1));
  if (!label || label.includes(".")) return null;
  const subdomain = normalizeSubdomain(label);
  return subdomain ? { kind: "hotel", subdomain } : null;
}

/**
 * The tenant-bearing suffix this host hangs off, if any.
 *
 * `*.vercel.app` is intentionally absent: a preview deploy's host is
 * `mogadishu-rents-git-abc123-team.vercel.app`, and reading that random hash as
 * a subdomain makes every preview resolve to a hotel that does not exist — i.e.
 * every preview 404s. Previews are always the platform.
 */
function hostSuffix(host: string): string | null {
  if (host.endsWith(`.${PLATFORM_ROOT_DOMAIN}`)) return PLATFORM_ROOT_DOMAIN;
  // `<sub>.localhost` resolves to 127.0.0.1 in Chrome/Firefox/Safari with no
  // hosts-file entry, which makes it the cheapest way to exercise tenants locally.
  if (host.endsWith(".localhost")) return "localhost";
  return null;
}

/**
 * The `?__tenant=` override is honoured everywhere EXCEPT the production domain,
 * where the hostname is the only source of truth. Otherwise a link like
 * `https://mogadishurents.com/?__tenant=jazeera` would dress the platform apex up
 * as somebody's hotel — a free phishing primitive for zero benefit, since the
 * real subdomain works there anyway.
 */
function allowsQueryOverride(host: string): boolean {
  return !isPlatformDomain(host);
}

function tenantFromQuery(search: string): Tenant | null {
  if (!search) return null;
  const raw = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  ).get(TENANT_QUERY_PARAM);
  const subdomain = normalizeSubdomain(raw);
  return subdomain ? { kind: "hotel", subdomain } : null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the tenant for a hostname.
 *
 * | host                                   | result                      |
 * | -------------------------------------- | --------------------------- |
 * | `mogadishurents.com`                   | platform                    |
 * | `www.mogadishurents.com`               | platform (reserved label)   |
 * | `jazeera.mogadishurents.com`           | hotel `jazeera`             |
 * | `admin.mogadishurents.com`             | platform (reserved label)   |
 * | `a.b.mogadishurents.com`               | platform (not wildcard-covered) |
 * | `<hash>.vercel.app`                    | platform (preview deploy)   |
 * | `localhost` / `127.0.0.1`              | platform                    |
 * | `jazeera.localhost:8080`               | hotel `jazeera`             |
 * | `localhost:8080/?__tenant=jazeera`     | hotel `jazeera`             |
 * | `mogadishurents.com/?__tenant=jazeera` | platform (override ignored) |
 * | anything else                          | platform                    |
 *
 * @param hostname defaults to `window.location.hostname`; a `host` with a port
 *                 ("jazeera.localhost:8080") is accepted too.
 * @param search   defaults to `window.location.search`; only consulted off the
 *                 production domain.
 */
export function resolveTenant(hostname?: string, search?: string): Tenant {
  const host = normalizeHost(hostname ?? runtimeHostname());

  const fromHost = tenantFromHost(host);
  if (fromHost) return fromHost;

  if (allowsQueryOverride(host)) {
    const fromQuery = tenantFromQuery(search ?? runtimeSearch());
    if (fromQuery) return fromQuery;
  }

  return { kind: "platform" };
}

/** The pieces of `window.location` the URL builders need. */
export type UrlContext = {
  hostname: string;
  protocol: string;
  /** "" when the port is the protocol default. */
  port: string;
};

function runtimeContext(): UrlContext {
  if (typeof window === "undefined") {
    // No window (tests, SSR): assume production, which is the only context where
    // an absolute link to somebody else's origin is meaningful.
    return { hostname: PLATFORM_ROOT_DOMAIN, protocol: "https:", port: "" };
  }
  const { hostname, protocol, port } = window.location;
  return { hostname, protocol, port };
}

function withPort(host: string, port: string): string {
  return port ? `${host}:${port}` : host;
}

/**
 * An absolute URL for a hotel's own site, correct in every environment:
 *
 * - on production        → `https://jazeera.mogadishurents.com`
 * - on `*.localhost`     → `http://jazeera.localhost:8080`
 * - anywhere else        → `<current origin>/?__tenant=jazeera`
 *
 * That last branch is what makes "View your site" work on preview deploys and on
 * `127.0.0.1`, where no wildcard DNS or certificate exists.
 */
export function subdomainUrl(subdomain: string, ctx?: UrlContext): string {
  const label = normalizeSubdomain(subdomain);
  const { hostname, protocol, port } = ctx ?? runtimeContext();
  const host = normalizeHost(hostname);

  // Nothing sensible to link to — send them to the platform rather than to a
  // host that cannot resolve.
  if (!label) return platformUrl("/", ctx);

  if (isPlatformDomain(host)) return `https://${label}.${PLATFORM_ROOT_DOMAIN}`;
  if (host === "localhost" || host.endsWith(".localhost")) {
    return `${protocol}//${withPort(`${label}.localhost`, port)}`;
  }
  return `${protocol}//${withPort(host, port)}/?${TENANT_QUERY_PARAM}=${label}`;
}

/**
 * An absolute URL back to the PLATFORM — the apex in production, the current
 * origin everywhere else. Tenant chrome needs this because a relative "/" on
 * `jazeera.mogadishurents.com` stays on the tenant's own site.
 */
export function platformUrl(path = "/", ctx?: UrlContext): string {
  const { hostname, protocol, port } = ctx ?? runtimeContext();
  const host = normalizeHost(hostname);
  const suffix = path.startsWith("/") ? path : `/${path}`;

  if (isPlatformDomain(host)) return `https://${PLATFORM_ROOT_DOMAIN}${suffix}`;
  if (host.endsWith(".localhost")) {
    return `${protocol}//${withPort("localhost", port)}${suffix}`;
  }
  return `${protocol}//${withPort(host, port)}${suffix}`;
}
