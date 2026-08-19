import { useLayoutEffect } from "react";

import type { ThemeModeKey } from "@/lib/hotel-theme";

/**
 * Pin the colour scheme while a hotel's page is on screen.
 *
 * ── WHY THE ROOT ELEMENT ────────────────────────────────────────────────────
 * Tailwind is configured with `darkMode: "class"`, so every `dark:` variant
 * fires when any ANCESTOR carries `.dark`. A wrapper div can therefore add dark
 * but can never remove it — "always light" applied to a subtree does nothing at
 * all for a visitor whose device is dark, which is the only case that setting
 * exists to serve. A hotel page is the whole page, so it owns <html> while it
 * is mounted.
 *
 * ── WHY IT PUTS THINGS BACK ─────────────────────────────────────────────────
 * Same discipline as src/components/Seo.tsx: every mutation records how to undo
 * itself. Without that, navigating from a dark hotel back to the marketplace
 * would leave the whole platform dark until a full reload — the visitor changed
 * page, not preference.
 *
 * `useLayoutEffect` so the scheme is right before paint. A frame of the wrong
 * palette on a page whose entire job is a first impression is worse than it
 * sounds.
 */
export function useHotelThemeMode(mode: ThemeModeKey | undefined) {
  useLayoutEffect(() => {
    // `auto` is what every page did before this existed: follow whatever the
    // platform's own theme provider decided.
    if (!mode || mode === "auto") return;

    const root = document.documentElement;
    const had = root.classList.contains("dark");
    const want = mode === "dark";
    if (had === want) return;

    root.classList.toggle("dark", want);
    return () => {
      root.classList.toggle("dark", had);
    };
  }, [mode]);
}
