import posthog from "posthog-js";

/**
 * PostHog analytics — product analytics, session replay and error tracking.
 *
 * Exposed as a plain module rather than a React context/provider, matching
 * `@/integrations/supabase/client`: nothing here needs React state, so a
 * provider would only add a layer without buying anything.
 *
 * OPTIONAL BY DESIGN. Unlike the Clerk key (which `main.tsx` treats as
 * required and throws on), a missing `VITE_POSTHOG_KEY` must never break the
 * app — someone cloning this repo, and CI, both run without one. When the key
 * is absent PostHog is never initialised and every helper below is a no-op, so
 * call sites don't need to guard.
 *
 * Everything the browser sees is public, so only the *project* API key belongs
 * here. PostHog's personal/private API keys must never carry a VITE_ prefix.
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

/** True only when a project key was provided. See the no-op note above. */
export const analyticsEnabled = Boolean(POSTHOG_KEY);

let initialised = false;

export function initAnalytics() {
  if (initialised) return;

  if (!analyticsEnabled) {
    // One line, not a warning per event — a dev without a key should be told
    // once and then left alone.
    console.info(
      "[analytics] VITE_POSTHOG_KEY is not set — analytics is disabled. See docs/POSTHOG_SETUP.md.",
    );
    initialised = true;
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,

    // Pageviews are sent by hand from AnalyticsBridge on route change. This is
    // a single-page app: PostHog's automatic capture fires on full page loads,
    // so leaving it on would miss every client-side navigation and mis-count
    // the first one.
    capture_pageview: false,
    capture_pageleave: true,

    // Uncaught errors and unhandled promise rejections. React error boundaries
    // swallow render errors before they reach window.onerror, so ErrorBoundary
    // reports those explicitly via captureException() below.
    capture_exceptions: true,

    // Anonymous visits still count in events and trends; they just don't create
    // a billable Person profile until identifyUser() runs. Most traffic here is
    // signed-out browsing, so this matters.
    person_profiles: "identified_only",

    session_recording: {
      // Mask EVERY input's value, not just passwords. This app collects phone
      // numbers and email addresses, and a replay is a recording of a real
      // person's screen — the conservative default is the correct one. Relax
      // per-field later if a specific flow genuinely needs it.
      maskAllInputs: true,
    },
  });

  initialised = true;
}

// ── Event catalog ────────────────────────────────────────────────────────────

/**
 * Every custom event the app sends, in one place.
 *
 * Same shape as `PERMISSIONS` in `@/lib/permissions` — a frozen map, so a typo
 * at a call site is a type error rather than a silently-misnamed event that
 * quietly splits a funnel in two.
 */
export const ANALYTICS_EVENTS = {
  PROPERTY_VIEWED: "property_viewed",
  PROPERTY_CONTACT_CLICKED: "property_contact_clicked",
  PROPERTY_SEARCH_SUBMITTED: "property_search_submitted",
  SERVICE_INQUIRY_SUBMITTED: "service_inquiry_submitted",
  PROPERTY_LISTED: "property_listed",
  SIGNUP_COMPLETED: "signup_completed",
  FAVORITE_TOGGLED: "favorite_toggled",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

type Props = Record<string, unknown>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Record a product event.
 *
 * Never let analytics break a user action: every helper here swallows its own
 * errors. A failed capture must not take down the submit handler it sits in.
 */
export function track(event: AnalyticsEvent, properties?: Props) {
  if (!analyticsEnabled) return;
  try {
    posthog.capture(event, properties);
  } catch (err) {
    console.warn("[analytics] capture failed:", err);
  }
}

/** Manual pageview, sent on route change (see `capture_pageview: false`). */
export function trackPageview(path: string) {
  if (!analyticsEnabled) return;
  try {
    posthog.capture("$pageview", { $current_url: window.location.href, path });
  } catch (err) {
    console.warn("[analytics] pageview failed:", err);
  }
}

/**
 * Attach the session to a known user.
 *
 * `userId` is the Clerk id — the same id `user_roles.user_id` and every RLS
 * policy key on, so a person in PostHog lines up with a row in Postgres.
 * Deliberately no email or phone: those live in `profile_contacts`, which is
 * owner-readable only, and sending them here would route private contact
 * details to a third party.
 */
export function identifyUser(userId: string, properties?: Props) {
  if (!analyticsEnabled || !userId) return;
  try {
    posthog.identify(userId, properties);
  } catch (err) {
    console.warn("[analytics] identify failed:", err);
  }
}

/**
 * Clear the identity on sign-out.
 *
 * Without this the next person to use the same browser — a shared phone or a
 * cyber-café machine, both common here — keeps sending events under the
 * previous user's id.
 */
export function resetUser() {
  if (!analyticsEnabled) return;
  try {
    posthog.reset();
  } catch (err) {
    console.warn("[analytics] reset failed:", err);
  }
}

/**
 * Report an error that the app caught itself.
 *
 * Needed because React error boundaries stop render errors before they reach
 * window.onerror, so `capture_exceptions` never sees them.
 */
export function captureException(error: unknown, context?: Props) {
  if (!analyticsEnabled) return;
  try {
    posthog.captureException(error, context);
  } catch (err) {
    console.warn("[analytics] exception capture failed:", err);
  }
}
