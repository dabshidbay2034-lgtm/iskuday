import { describe, it, expect, vi, afterEach } from 'vitest';
import posthog from 'posthog-js';
import {
  ANALYTICS_EVENTS,
  analyticsEnabled,
  captureException,
  identifyUser,
  resetUser,
  track,
  trackPageview,
  type AnalyticsEvent,
} from '@/lib/analytics';

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    captureException: vi.fn(),
  },
}));

const ALL_EVENTS = Object.values(ANALYTICS_EVENTS) as AnalyticsEvent[];

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
    expect(analyticsEnabled).toBe(false);
  });

  it('never calls PostHog and never throws', () => {
    expect(() => {
      track(ANALYTICS_EVENTS.PROPERTY_VIEWED, { property_id: 'abc' });
      trackPageview('/properties');
      identifyUser('user_123', { platform_role: 'owner' });
      resetUser();
      captureException(new Error('boom'), { path: '/' });
    }).not.toThrow();

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
  });

  it('ignores an empty user id rather than identifying an anonymous visitor', () => {
    identifyUser('', { platform_role: 'user' });
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});
