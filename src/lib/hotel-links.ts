/**
 * Where a hotel's pages live, on both hosts.
 *
 * A hotel's site is served from two places, and they disagree about URLs:
 *
 *   platform  `/hotels/:slug` (home) and `/hotels/:slug/:pageSlug`
 *   tenant    `/` (home) and `/:pageSlug`   (jazeera.mogadishurents.com)
 *
 * Every menu, footer and link on either host builds its paths here, so a nav
 * and a footer on the same page can never disagree about where a page is.
 *
 * Deliberately PURE — no React, no Supabase, no `window`. `isHomeSlug` used to
 * live in `use-hooks/use-hotel-pages`, which cannot be imported by a component
 * that a unit test renders without a live Supabase config; it is re-exported
 * from there so existing importers keep working.
 */

/** The minimum a link builder needs to know about a page. */
export type HotelPageRef = {
  /** '' or 'home' for the landing page; a URL segment otherwise. */
  slug: string;
  /** The `is_home` flag — authoritative, unlike the slug spelling. */
  isHome?: boolean;
};

/** `home` and `''` both address the landing page (see migration 20260810000001). */
export function isHomeSlug(slug: string | undefined | null): boolean {
  return slug === "" || slug == null || slug === "home";
}

/**
 * True for the hotel's landing page.
 *
 * The FLAG decides, not the spelling: a site that stores its home page as ''
 * and one that stores 'home' must both resolve to the same URL, and a hotel
 * that later promotes a different page must follow it.
 */
export function isHomePage(page: HotelPageRef): boolean {
  return page.isHome === true || isHomeSlug(page.slug);
}

/** Paths on the PLATFORM domain, for one hotel. */
export function platformHotelPagePath(hotelSlug: string) {
  return (page: HotelPageRef): string =>
    isHomePage(page) ? `/hotels/${hotelSlug}` : `/hotels/${hotelSlug}/${page.slug}`;
}

/** Paths on the hotel's OWN subdomain, where its site is rooted at "/". */
export function tenantHotelPagePath(page: HotelPageRef): string {
  return isHomePage(page) ? "/" : `/${page.slug}`;
}
