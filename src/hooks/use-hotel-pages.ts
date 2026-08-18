import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { describeWriteError } from "@/hooks/use-rent";
import { isHomeSlug } from "@/lib/hotel-links";
import {
  defaultPageSections, sectionsFor, sectionsFromJson, type PageSection,
} from "@/components/hotel/page-sections";

/**
 * Multi-page hotel websites (migration 20260810000001).
 *
 * A hotel is no longer one page but a small SITE: up to three `hotel_pages`
 * rows, each carrying its own ordered `sections` block list, its own slug and
 * its own publish switch. Exactly one page per hotel is the home page.
 *
 * Relationship to `hotels.sections`: the home page's blocks are ALSO still
 * mirrored on the hotel row, because the existing editor and public page read
 * them from there. The migration deliberately left that column in place, so
 * treat `hotels.sections` as the legacy mirror and `hotel_pages.sections` as
 * the source of truth for anything page-aware.
 *
 * `hotel_pages` isn't in the generated Supabase types until `supabase gen
 * types` runs, so reads/writes go through the same loose accessor use-hotels.ts
 * uses.
 */

// ── Domain types ─────────────────────────────────────────────────────────────

/** The database-enforced page limit (trigger `hotel_pages_cap`), mirrored here
 *  only so the UI can disable "Add page" before the round-trip. The trigger is
 *  the real limit — this constant is a courtesy. */
export const MAX_HOTEL_PAGES = 3;

export type HotelPage = {
  id: string;
  hotelId: string;
  /** '' or 'home' for the landing page; a URL segment otherwise. */
  slug: string;
  title: string;
  /** The ordered blocks this page renders (hero → … → contact). */
  sections: PageSection[];
  sortOrder: number;
  isHome: boolean;
  isPublished: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

type RawHotelPage = {
  id: string;
  hotel_id: string;
  slug: string | null;
  title: string | null;
  sections: unknown;
  sort_order: number | null;
  is_home: boolean | null;
  is_published: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

function toHotelPage(row: RawHotelPage): HotelPage {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    slug: row.slug ?? "",
    title: row.title ?? "Untitled page",
    // sectionsFromJson, not sectionsFor: a non-home page that is genuinely
    // empty must stay empty. Defaulting it to a hero/about/gallery skeleton
    // would resurrect blocks the user just deleted on their next reload.
    sections: sectionsFromJson(row.sections),
    sortOrder: Number(row.sort_order ?? 0),
    isHome: row.is_home ?? false,
    isPublished: row.is_published ?? false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = { from: (table: string) => any };
const looseFrom = (table: string) => (supabase as unknown as LooseClient).from(table);

// ── Slugs ────────────────────────────────────────────────────────────────────

/**
 * "Rooms & Rates" → "rooms-rates". Matches `hotel_pages_slug_check`, so a title
 * full of punctuation can't produce a slug the database will reject.
 */
export function pageSlugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "page"
  );
}

/**
 * `home` and `''` both address the landing page (see the migration's STEP 2).
 *
 * Defined in `@/lib/hotel-links` — a pure module with no Supabase import — so
 * that link-building components can use it without dragging the whole data
 * layer in. Re-exported here because this is where callers already look for it.
 */
export { isHomeSlug };

/**
 * The blocks to render for a page, back-filling the HOME page from the hotel's
 * legacy scalar fields when its own `sections` is still empty.
 *
 * Only the home page gets that fallback: it is the one page that predates
 * `hotel_pages` and whose content may still only exist on the hotel row.
 */
export function sectionsForPage(
  page: HotelPage,
  hotel?: {
    name: string;
    tagline?: string | null;
    heroImageUrl?: string | null;
    description?: string | null;
    gallery?: string[];
  } | null,
): PageSection[] {
  if (page.sections.length > 0) return page.sections;
  if (!page.isHome) return [];
  if (hotel) return sectionsFor({ ...hotel, sections: page.sections });
  return defaultPageSections({ name: page.title });
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The 3-page cap is raised by a database trigger as a check_violation, so the
 * raw message is a sentence about triggers. Translate it before it reaches a
 * toast; everything else falls through to the shared RLS-aware translator.
 */
function describePageError(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (/at most \d+ pages/i.test(message)) {
    return `A hotel can have at most ${MAX_HOTEL_PAGES} pages. Delete one before adding another.`;
  }
  if (/hotel_pages_hotel_slug_key/i.test(message)) {
    return "This hotel already has a page with that address.";
  }
  if (/hotel_pages_one_home_per_hotel/i.test(message)) {
    return "This hotel already has a home page.";
  }
  if (/hotel_pages_slug_check/i.test(message)) {
    return "That page address isn't valid — use letters, numbers and dashes.";
  }
  return describeWriteError(error, fallback);
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const hotelPagesKey = (hotelId?: string) => ["hotel-pages", hotelId] as const;
export const hotelPageKey = (hotelId?: string, slug?: string) =>
  ["hotel-pages", hotelId, "slug", slug] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Every page of one hotel, in display order. RLS decides what comes back:
 * managers see drafts too, the public sees only published pages of a published
 * hotel.
 */
export function useHotelPages(hotelId?: string) {
  return useQuery({
    queryKey: hotelPagesKey(hotelId),
    enabled: Boolean(hotelId),
    queryFn: async (): Promise<HotelPage[]> => {
      const { data, error } = await looseFrom("hotel_pages")
        .select("*")
        .eq("hotel_id", hotelId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data as RawHotelPage[]) ?? []).map(toHotelPage);
    },
  });
}

/**
 * One page of a hotel by its slug — the public site's per-route load.
 *
 * An empty/absent slug means "the landing page", which is resolved by the
 * is_home flag rather than by guessing at a slug spelling: a site whose home
 * page is stored as '' and one that stores 'home' must both resolve.
 */
export function usePublicHotelPage(hotelId?: string, slug?: string) {
  return useQuery({
    queryKey: hotelPageKey(hotelId, slug ?? ""),
    enabled: Boolean(hotelId),
    queryFn: async (): Promise<HotelPage | null> => {
      const query = looseFrom("hotel_pages").select("*").eq("hotel_id", hotelId);
      const { data, error } = isHomeSlug(slug)
        ? await query.eq("is_home", true).maybeSingle()
        : await query.eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data ? toHotelPage(data as RawHotelPage) : null;
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type HotelPageInput = {
  title: string;
  /** Derived from the title when omitted. */
  slug?: string;
  sections?: PageSection[];
  sortOrder?: number;
  isPublished?: boolean;
};

/**
 * Add a page.
 *
 * The count check below is a courtesy that saves a round-trip and gives a
 * better message — it is NOT the limit. `hotel_pages_cap` in the database is,
 * and its error is surfaced verbatim (translated) if two tabs race past this
 * check at the same time.
 */
export function useCreateHotelPage(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: HotelPageInput): Promise<HotelPage> => {
      if (!hotelId) throw new Error("No hotel selected.");

      const { count, error: countError } = await looseFrom("hotel_pages")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotelId);
      if (countError) throw countError;
      if ((count ?? 0) >= MAX_HOTEL_PAGES) {
        throw new Error(
          `A hotel can have at most ${MAX_HOTEL_PAGES} pages. Delete one before adding another.`,
        );
      }

      const title = input.title.trim() || "New page";
      const { data, error } = await looseFrom("hotel_pages")
        .insert({
          hotel_id: hotelId,
          slug: input.slug?.trim() || pageSlugify(title),
          title,
          sections: input.sections ?? [],
          sort_order: input.sortOrder ?? (count ?? 0),
          // Never true here: the home page is claimed by the migration or by
          // useSetHomePage(), and racing the partial unique index from an
          // "add page" button would fail with a confusing index name.
          is_home: false,
          is_published: input.isPublished ?? false,
        })
        .select("*")
        .single();
      if (error) throw error;
      return toHotelPage(data as RawHotelPage);
    },
    onSuccess: (page) => {
      toast.success(`"${page.title}" added`);
      queryClient.invalidateQueries({ queryKey: hotelPagesKey(hotelId) });
    },
    onError: (error: unknown) =>
      toast.error(describePageError(error, "Couldn't add the page")),
  });
}

/** Save one page. `is_home` is not settable here — use useSetHomePage(). */
export function useUpdateHotelPage(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; input: HotelPageInput }): Promise<HotelPage> => {
      const { id, input } = args;
      const title = input.title.trim() || "Untitled page";

      // Only send what the caller asked to change: a page editor that always
      // wrote every column would clobber sort_order every time someone renamed
      // a page from a different screen.
      const patch: Record<string, unknown> = { title };
      if (input.slug !== undefined) patch.slug = input.slug.trim() || pageSlugify(title);
      if (input.sections !== undefined) patch.sections = input.sections;
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      if (input.isPublished !== undefined) patch.is_published = input.isPublished;

      const { data, error } = await looseFrom("hotel_pages")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return toHotelPage(data as RawHotelPage);
    },
    onSuccess: (page) => {
      toast.success("Page saved");
      queryClient.invalidateQueries({ queryKey: hotelPagesKey(page.hotelId) });
      queryClient.invalidateQueries({ queryKey: hotelPageKey(page.hotelId, page.slug) });
    },
    onError: (error: unknown) =>
      toast.error(describePageError(error, "Couldn't save the page")),
  });
}

/**
 * Delete a page.
 *
 * The home page is refused outright rather than deleted-and-reassigned: a site
 * whose landing page vanished is a 404 at the hotel's own URL, and picking a
 * replacement silently is a worse surprise than saying no. Make another page
 * home first, then delete this one.
 */
export function useDeleteHotelPage(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (page: HotelPage): Promise<HotelPage> => {
      if (page.isHome) {
        throw new Error(
          "This is the home page. Make another page the home page before deleting it.",
        );
      }
      const { error } = await looseFrom("hotel_pages").delete().eq("id", page.id);
      if (error) throw error;
      return page;
    },
    onSuccess: (page) => {
      toast.success(`"${page.title}" deleted`);
      queryClient.invalidateQueries({ queryKey: hotelPagesKey(hotelId ?? page.hotelId) });
    },
    onError: (error: unknown) =>
      toast.error(describePageError(error, "Couldn't delete the page")),
  });
}

/**
 * Promote a page to home.
 *
 * Two statements, in this order, on purpose: `hotel_pages_one_home_per_hotel`
 * is a partial UNIQUE INDEX and unique indexes cannot be DEFERRABLE, so the old
 * home must be cleared and committed to the statement before the new one is
 * set. Doing it the other way round trips the index every single time.
 */
export function useSetHomePage(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pageId: string): Promise<string> => {
      if (!hotelId) throw new Error("No hotel selected.");

      const { error: clearError } = await looseFrom("hotel_pages")
        .update({ is_home: false })
        .eq("hotel_id", hotelId)
        .neq("id", pageId);
      if (clearError) throw clearError;

      // sort_order 0 as well, so the home page also leads the page list/nav —
      // otherwise the site menu and the landing page disagree about what comes
      // first.
      const { error } = await looseFrom("hotel_pages")
        .update({ is_home: true, sort_order: 0 })
        .eq("id", pageId);
      if (error) throw error;
      return pageId;
    },
    onSuccess: () => {
      toast.success("Home page updated");
      queryClient.invalidateQueries({ queryKey: hotelPagesKey(hotelId) });
    },
    onError: (error: unknown) =>
      toast.error(describePageError(error, "Couldn't set the home page")),
  });
}
