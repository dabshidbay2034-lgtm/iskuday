import { useState } from "react";
import {
  Home,
  Loader2,
  Plus,
  Trash2,
  Globe,
  FileText,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MAX_HOTEL_PAGES,
  useCreateHotelPage,
  useDeleteHotelPage,
  useHotelPages,
  useSetHomePage,
  useUpdateHotelPage,
  type HotelPage,
} from "@/hooks/use-hotel-pages";

/**
 * The pages of one hotel site — add, rename, publish, set home, delete.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `hotel_pages` (20260810000002) and six hooks in use-hotel-pages.ts shipped
 * with no UI at all: five of those hooks had zero callers, so a hotel could
 * never have more than the one page the migration seeded. The schema, the RLS,
 * the 3-page cap trigger and the public renderer were all in place and simply
 * unreachable. This is the missing surface.
 *
 * ── ONE SLUG RULE WORTH KNOWING ────────────────────────────────────────────
 * The home page answers on the site root, so its slug is not editable here —
 * `useSetHomePage` also forces sort_order 0 so the nav and the landing page
 * agree about what comes first. Renaming the home page changes its title only.
 *
 * Deleting the home page is refused by the hook, not just hidden here: the
 * partial unique index guarantees exactly one home per hotel, and a site with
 * no landing page would 404 at its own root.
 */
/**
 * A rename box that keeps its own draft.
 *
 * Bound straight to `page.title` it would fight the query cache: the mutation
 * refetches, the refetch overwrites the field mid-word, and the caret jumps.
 * The draft is local; the mutation only runs when the field is left, and an
 * unchanged title is not written at all.
 */
function PageTitleInput({
  page,
  onCommit,
}: {
  page: HotelPage;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(page.title);

  const commit = () => {
    const next = draft.trim();
    if (!next || next === page.title) {
      setDraft(page.title);
      return;
    }
    onCommit(next);
  };

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(page.title);
      }}
      className="h-7 text-xs border-0 shadow-none px-1 focus-visible:ring-1"
      aria-label={`Rename ${page.title}`}
    />
  );
}

export function HotelPagesCard({ hotelId, slug }: { hotelId: string; slug: string }) {
  const { data: pages, isPending, isError } = useHotelPages(hotelId);
  const createPage = useCreateHotelPage(hotelId);
  const updatePage = useUpdateHotelPage(hotelId);
  const deletePage = useDeleteHotelPage(hotelId);
  const setHome = useSetHomePage(hotelId);

  const [newTitle, setNewTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<HotelPage | null>(null);

  const list = [...(pages ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
  // The trigger is the real limit; this only stops a round-trip that would
  // come back as an error the owner can't act on.
  const atCap = list.length >= MAX_HOTEL_PAGES;

  const movePage = (page: HotelPage, direction: -1 | 1) => {
    const index = list.findIndex((item) => item.id === page.id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= list.length) return;

    const other = list[swapIndex];
    const currentOrder = page.sortOrder;
    const nextOrder = other.sortOrder;

    updatePage.mutate({
      id: page.id,
      input: { title: page.title, sortOrder: nextOrder },
    });
    updatePage.mutate({
      id: other.id,
      input: { title: other.title, sortOrder: currentOrder },
    });
  };

  const add = () => {
    const title = newTitle.trim();
    if (!title) return;
    // `useCreateHotelPage` always inserts is_home = false — deliberately, so an
    // "add page" button can never race the partial unique index that enforces
    // one home per hotel. That leaves a real gap on the FIRST page: a hotel
    // with pages but no home has no landing page and 404s at its own root.
    // Promoting it here closes that, and is what makes the empty-state copy
    // below true.
    const isFirst = list.length === 0;
    createPage.mutate(
      { title },
      {
        onSuccess: (page) => {
          setNewTitle("");
          if (isFirst) setHome.mutate(page.id);
        },
      },
    );
  };

  /** No page is flagged home — the site has no root. Worth saying out loud. */
  const missingHome = list.length > 0 && !list.some((p) => p.isHome);

  if (isPending) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading pages…
      </p>
    );
  }

  if (isError) {
    return (
      <p className="text-[11px] text-destructive">
        Couldn't load this hotel's pages.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {list.map((page) => (
          <li
            key={page.id}
            className="rounded-lg border border-border bg-background p-2 space-y-1.5"
          >
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {/* Commits on blur/Enter, never per keystroke — an onChange
                  mutation would fire one UPDATE per letter typed. */}
              <PageTitleInput
                page={page}
                onCommit={(title) =>
                  updatePage.mutate({ id: page.id, input: { title } })
                }
              />
              {page.isHome && (
                <Badge variant="secondary" className="text-[9px] rounded-full shrink-0 gap-0.5">
                  <Home className="w-2.5 h-2.5" /> Home
                </Badge>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground pl-5 truncate">
              /{slug}{page.isHome ? "" : `/${page.slug}`}
            </p>

            <div className="flex items-center gap-2 pl-5">
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Switch
                  checked={page.isPublished}
                  onCheckedChange={(v) =>
                    updatePage.mutate({
                      id: page.id,
                      input: { title: page.title, isPublished: v },
                    })
                  }
                  aria-label={`Publish ${page.title}`}
                />
                <Globe className="w-3 h-3" /> {page.isPublished ? "Live" : "Draft"}
              </label>

              <div className="ml-auto flex items-center gap-1">
                {!page.isHome && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px]"
                      disabled={setHome.isPending}
                      onClick={() => setHome.mutate(page.id)}
                    >
                      Make home
                    </Button>
                    <div className="flex items-center gap-0.5 ml-auto">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground"
                        disabled={list.findIndex((item) => item.id === page.id) === 0}
                        onClick={() => movePage(page, -1)}
                        aria-label={`Move ${page.title} up`}
                      >
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground"
                        disabled={list.findIndex((item) => item.id === page.id) === list.length - 1}
                        onClick={() => movePage(page, 1)}
                        aria-label={`Move ${page.title} down`}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(page)}
                      aria-label={`Delete ${page.title}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {list.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No pages yet. The first one you add becomes this site's home page.
        </p>
      )}

      <div className="flex items-center gap-1.5">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={atCap ? `Limit is ${MAX_HOTEL_PAGES} pages` : "Rooms, Contact…"}
          disabled={atCap}
          className="h-8 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          disabled={atCap || !newTitle.trim() || createPage.isPending}
          onClick={add}
        >
          {createPage.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Add
        </Button>
      </div>

      {missingHome && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          No home page set — this site has nothing at its root. Pick one with
          "Make home".
        </p>
      )}

      <p className="text-[10px] text-muted-foreground">
        {list.length} of {MAX_HOTEL_PAGES} pages used.
      </p>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the page and everything on it. Guests following a link
              to /{slug}/{deleteTarget?.slug} will get a not-found page. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deletePage.mutate(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
