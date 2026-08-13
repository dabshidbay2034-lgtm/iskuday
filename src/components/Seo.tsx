import { useLayoutEffect } from "react";

import {
  DEFAULT_OG_IMAGE,
  absoluteUrl,
  serializeJsonLd,
} from "@/lib/seo";

/**
 * Per-route <head> management, hand-rolled.
 *
 * WHY NOT A LIBRARY: React 18 has no native metadata hoisting (that lands in
 * 19), react-helmet-async is unmaintained against React 18's StrictMode, and
 * `.npmrc` in this repo carries `legacy-peer-deps` — meaning npm will happily
 * install a helmet whose peer range excludes our React and fail at runtime
 * instead of at install time. A ~150-line effect we control is the cheaper risk.
 *
 * WHY NOT `document.title = x`: the naive version is write-only. Navigate from
 * /property/abc to / and the homepage inherits the listing's title, canonical
 * and og:image, because nothing ever put them back. Pages that render no <Seo>
 * at all (every /manage and /admin screen) inherit whatever the last public
 * page left behind. So every mutation here records how to undo itself, and the
 * effect cleanup replays those undos in reverse — returning the head to exactly
 * what index.html shipped before the next route writes over it.
 *
 * ORDERING: React runs the unmounting tree's layout-effect cleanups before the
 * mounting tree's layout effects in the same commit, so a route change is
 * always restore-then-apply, never apply-then-restore. `useLayoutEffect` rather
 * than `useEffect` so the head is correct before paint — it matters for the
 * scrape-on-idle crawlers that snapshot the DOM shortly after load.
 *
 * INVARIANT: exactly ONE <Seo> may be mounted at a time. Two would race on the
 * same elements and the loser's undo would restore the winner's value. A
 * dev-only warning below catches that during development.
 */

export type SeoProps = {
  /** Full <title>, already including any brand suffix — pass buildTitle(...). */
  title: string;
  description: string;
  /** ABSOLUTE url — build it with absoluteUrl(). See the canonical bug in lib/seo.ts. */
  canonical: string;
  /** Absolute image url; falls back to the site's OG image. */
  image?: string;
  type?: "website" | "article" | "product";
  noindex?: boolean;
  jsonLd?: object | object[];
};

/** A recorded reversal of one head mutation. */
type Undo = () => void;

/** Marks the <script> tag this component owns, so it never touches index.html's. */
const JSON_LD_ATTR = "data-seo-jsonld";

let mountedInstances = 0;

/**
 * Upsert an attribute on an existing head element, or create the element.
 *
 * "Upsert by selector" is the whole game: index.html already ships a
 * description, a canonical and the full og:/twitter: set, so appending would
 * leave TWO canonicals on the page — and two conflicting canonicals is treated
 * as no canonical at all, putting us right back where we started.
 */
function upsert(
  selector: string,
  create: () => HTMLElement,
  attr: string,
  value: string,
  undos: Undo[],
): void {
  const existing = document.head.querySelector<HTMLElement>(selector);

  if (existing) {
    const previous = existing.getAttribute(attr);
    undos.push(() => {
      // A tag that existed without the attribute must go back to not having it,
      // not to having an empty one — `content=""` is a real, and wrong, value.
      if (previous === null) existing.removeAttribute(attr);
      else existing.setAttribute(attr, previous);
    });
    existing.setAttribute(attr, value);
    return;
  }

  const created = create();
  created.setAttribute(attr, value);
  document.head.appendChild(created);
  undos.push(() => created.remove());
}

function meta(nameOrProperty: "name" | "property", key: string, value: string, undos: Undo[]) {
  upsert(
    `meta[${nameOrProperty}="${key}"]`,
    () => {
      const el = document.createElement("meta");
      el.setAttribute(nameOrProperty, key);
      return el;
    },
    "content",
    value,
    undos,
  );
}

export function Seo({
  title,
  description,
  canonical,
  image,
  type = "website",
  noindex = false,
  jsonLd,
}: SeoProps): null {
  // jsonLd is almost always a fresh object literal, so it changes identity on
  // every render. Serialising it here makes the dependency a plain string —
  // otherwise the effect would tear down and rebuild the entire head on each
  // re-render, which on Properties (re-renders on every keystroke in the search
  // box) means thrashing document.title while the user types.
  const jsonLdText = jsonLd ? serializeJsonLd(jsonLd) : "";

  useLayoutEffect(() => {
    if (import.meta.env.DEV) {
      mountedInstances += 1;
      if (mountedInstances > 1) {
        console.warn(
          `[Seo] ${mountedInstances} <Seo> components are mounted at once ("${title}"). ` +
            "They will fight over the same head elements — render exactly one per route.",
        );
      }
    }

    const undos: Undo[] = [];
    const url = absoluteUrl(canonical);
    const ogImage = absoluteUrl(image || DEFAULT_OG_IMAGE);

    // <title> is a text node, not an attribute, so it gets its own undo.
    const previousTitle = document.title;
    undos.push(() => {
      document.title = previousTitle;
    });
    document.title = title;

    meta("name", "description", description, undos);

    upsert(
      'link[rel="canonical"]',
      () => {
        const el = document.createElement("link");
        el.setAttribute("rel", "canonical");
        return el;
      },
      "href",
      url,
      undos,
    );

    meta("property", "og:title", title, undos);
    meta("property", "og:description", description, undos);
    meta("property", "og:url", url, undos);
    meta("property", "og:image", ogImage, undos);
    meta("property", "og:type", type, undos);

    meta("name", "twitter:card", "summary_large_image", undos);
    meta("name", "twitter:title", title, undos);
    meta("name", "twitter:description", description, undos);
    meta("name", "twitter:image", ogImage, undos);

    // Only written when the page asks to be hidden. Leaving index.html's
    // "index, follow" untouched on normal pages keeps one less thing to restore,
    // and the undo above still flips a noindex page back to indexable when you
    // navigate away from it.
    if (noindex) {
      meta("name", "robots", "noindex, follow", undos);
    }

    if (jsonLdText) {
      // Our own script element, never index.html's sitewide WebApplication node
      // — the two are allowed to coexist and describe different things.
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.setAttribute(JSON_LD_ATTR, "");
      // textContent, not innerHTML: the browser must not parse this as markup.
      script.textContent = jsonLdText;
      document.head.appendChild(script);
      undos.push(() => script.remove());
    }

    return () => {
      if (import.meta.env.DEV) mountedInstances -= 1;
      // Reverse order so a create/remove pair unwinds like a stack and an
      // element created by an earlier call is still present for a later undo.
      for (let i = undos.length - 1; i >= 0; i -= 1) undos[i]();
    };
  }, [title, description, canonical, image, type, noindex, jsonLdText]);

  return null;
}

export default Seo;
