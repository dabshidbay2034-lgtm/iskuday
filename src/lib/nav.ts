/**
 * What goes in the header, in one place, for both layouts.
 *
 * ── WHY THIS IS NOT JUST JSX IN Header.tsx ──────────────────────────────────
 * It was, twice: the desktop bar and the mobile sheet each hand-wrote their own
 * list, and they had already drifted apart. The same route was "Explore" on
 * desktop and "All Properties" on mobile. "About" was sixth on one and third on
 * the other. The category menu existed as a dropdown on one and a chip row on
 * the other, with no shared order. A visitor who checked the site on a phone
 * and then a laptop was reading two different maps of the same building.
 *
 * One array fixes that by construction — a link cannot appear in one layout and
 * not the other, and cannot be called two things, because there is only one
 * place to write it down.
 *
 * ── THE OTHER HALF: THERE USED TO BE EIGHT ──────────────────────────────────
 * Home · Overview · Explore · Categories · Services · About · Manage · Team.
 * Three of those were the same idea wearing different hats:
 *
 *   • Home duplicated the logo, which sat ten pixels to its left and is the
 *     single most universally understood control on any website.
 *   • Categories went to /properties?type=…, which is Explore with a filter
 *     already applied — a whole dropdown to pre-fill one query parameter.
 *   • "Overview" is the owner sales page. That word tells a renter looking for
 *     a two-bedroom in Hodan nothing at all about what is behind it.
 *
 * What is left is four public entries. The category links did not disappear —
 * they moved INSIDE Explore, which is where somebody looking for "villas"
 * would have gone first anyway.
 */

export type NavContext = {
  /** Owner, agent, hotel_manager or admin — someone with listings to run. */
  canManageProperties: boolean;
  /** Signed in with an active Clerk organization. */
  hasOrg: boolean;
};

export type NavItem = {
  id: string;
  to: string;
  label: string;
  /**
   * Whether this entry belongs in the bar for this visitor.
   *
   * Everything public returns true. The point of the predicate is the two
   * kinds of conditional entry: tools that only exist for a business account,
   * and the sales page that should stop following people who already bought.
   */
  visible: (ctx: NavContext) => boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    id: "explore",
    to: "/properties",
    label: "Explore",
    visible: () => true,
  },
  {
    id: "services",
    to: "/services",
    label: "Services",
    visible: () => true,
  },
  {
    id: "owners",
    to: "/showcase",
    label: "For owners",
    // Hidden once the visitor manages anything. It is a pitch, and a pitch
    // aimed at an existing customer is just a nav entry they never press —
    // this is also what keeps a signed-in hotelier's bar from growing to six.
    visible: (ctx) => !ctx.canManageProperties,
  },
  {
    id: "about",
    to: "/about",
    label: "About",
    visible: () => true,
  },
  {
    id: "manage",
    to: "/manage",
    label: "Manage",
    visible: (ctx) => ctx.canManageProperties,
  },
  {
    id: "team",
    to: "/team",
    label: "Team",
    visible: (ctx) => ctx.hasOrg,
  },
];

/** The entries this visitor should see, in order. */
export function visibleNavItems(ctx: NavContext): NavItem[] {
  return NAV_ITEMS.filter((item) => item.visible(ctx));
}

/**
 * Is this the page the visitor is currently on?
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 * Nothing computed this before. "Home" was hard-coded to the active colour and
 * every other entry to the muted one, so the bar claimed you were on the home
 * page no matter where you actually were — on /services, on a property, in the
 * middle of checkout. A navigation bar's one job beyond linking is telling you
 * where you are, and it was answering the same way every time.
 *
 * Prefix matching so a child route keeps its parent lit: /properties/abc still
 * shows Explore as current. The query string is deliberately ignored —
 * /properties?type=villa is still Explore, which is what makes it safe to have
 * folded the category links in underneath it.
 */
export function isNavItemActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}
