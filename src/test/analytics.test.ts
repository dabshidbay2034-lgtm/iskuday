import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import posthog from 'posthog-js';
import type { AnalyticsEvent } from '@/lib/analytics';

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    captureException: vi.fn(),
  },
}));

// The module is imported dynamically below so its module-scope
// `analyticsEnabled = Boolean(import.meta.env.VITE_POSTHOG_KEY)` is computed
// with a cleared env — otherwise a developer's local VITE_POSTHOG_KEY silently
// flips the "no key" tests into the live-PostHog path and they fail.
//
// Only `import type` is used above, so @/lib/analytics is NOT loaded by this
// file's top-level imports — the dynamic import below is its first load, and
// vi.stubEnv() makes Vite resolve import.meta.env from the stubbed value
// instead of the shell's real env. (We deliberately do NOT call
// vi.resetModules() here: it would also purge the posthog-js mock, and the
// assertions inspect posthog.capture/identify/reset below.)
let analytics: typeof import('@/lib/analytics');
let ALL_EVENTS: AnalyticsEvent[];

beforeAll(async () => {
  vi.stubEnv('VITE_POSTHOG_KEY', '');
  vi.stubEnv('VITE_POSTHOG_HOST', '');
  analytics = await import('@/lib/analytics');
  ALL_EVENTS = Object.values(analytics.ANALYTICS_EVENTS) as AnalyticsEvent[];
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('analytics event catalog', () => {
  it('names every event in snake_case, with no duplicates', () => {
    for (const event of ALL_EVENTS) {
      expect(event).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
    expect(new Set(ALL_EVENTS).size).toBe(ALL_EVENTS.length);
  });

  it('avoids the reserved "$" prefix PostHog uses for its own events', () => {
    // A custom event named like a built-in ($pageview, $identify) would be
    // merged into PostHog's own metrics rather than reported separately.
    for (const event of ALL_EVENTS) {
      expect(event.startsWith('$')).toBe(false);
    }
  });

  it('covers the funnel the setup doc promises', () => {
    expect(ALL_EVENTS).toEqual(
      expect.arrayContaining([
        'property_viewed',
        'property_contact_clicked',
        'property_search_submitted',
        'service_inquiry_submitted',
        'property_listed',
        'signup_completed',
        'favorite_toggled',
      ]),
    );
  });
});

describe('analytics helpers without a PostHog key', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // The whole point of the no-key path: a fresh clone and CI run with no
  // VITE_POSTHOG_KEY, and nothing may break or phone home.
  it('is disabled when no key is configured', () => {
    expect(analytics.analyticsEnabled).toBe(false);
  });

  it('never calls PostHog and never throws', () => {
    expect(() => {
      analytics.track(analytics.ANALYTICS_EVENTS.PROPERTY_VIEWED, { property_id: 'abc' });
      analytics.trackPageview('/properties');
      analytics.identifyUser('user_123', { platform_role: 'owner' });
      analytics.resetUser();
      analytics.captureException(new Error('boom'), { path: '/' });
    }).not.toThrow();

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
  });

  it('ignores an empty user id rather than identifying an anonymous visitor', () => {
    analytics.identifyUser('', { platform_role: 'user' });
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});
