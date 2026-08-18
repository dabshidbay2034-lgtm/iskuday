import { useState } from "react";
import { ImagePlus, Loader2, X, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PageSection, MenuItem } from "@/components/hotel/page-sections";
import { uid } from "@/components/hotel/page-sections";
import {
  ALIGN_OPTIONS, GALLERY_LAYOUT_OPTIONS, HERO_HEIGHT_OPTIONS, OVERLAY_OPTIONS,
  GAP_OPTIONS, PAD_OPTIONS, ROOM_COLUMN_OPTIONS, STYLE_AXES_FOR, TONE_OPTIONS, WIDTH_OPTIONS,
  type StyleAxis, type StyleOption,
} from "@/components/hotel/section-styles";

/**
 * The Inspector's per-block controls: CONTENT on top, LOOK underneath.
 *
 * Text fields that also exist as type-on-the-page targets in the canvas are
 * deliberately kept here too. Inline editing is the fast path, but a rail field
 * is the only way to reach text that renders empty (and the only comfortable
 * one on a phone), so the two stay in sync rather than one replacing the other.
 */

const UPLOAD_FIELD = "imageUrl" as const;
const UPLOAD_GALLERY = "images" as const;

/** The label + option list the Inspector draws for each style axis. */
const AXIS_UI: Record<StyleAxis, { label: string; options: StyleOption<never>[] }> = {
  heroHeight: { label: "Height", options: HERO_HEIGHT_OPTIONS as StyleOption<never>[] },
  align: { label: "Alignment", options: ALIGN_OPTIONS as StyleOption<never>[] },
  overlay: { label: "Image shade", options: OVERLAY_OPTIONS as StyleOption<never>[] },
  width: { label: "Width", options: WIDTH_OPTIONS as StyleOption<never>[] },
  tone: { label: "Surface", options: TONE_OPTIONS as StyleOption<never>[] },
  layout: { label: "Layout", options: GALLERY_LAYOUT_OPTIONS as StyleOption<never>[] },
  columns: { label: "Columns", options: ROOM_COLUMN_OPTIONS as StyleOption<never>[] },
  pad: { label: "Spacing", options: PAD_OPTIONS as StyleOption<never>[] },
  gap: { label: "Gap", options: GAP_OPTIONS as StyleOption<never>[] },
};

export function SectionFields({
  section, upload, uploadFile, uploading, onUpdate, onQueueDelete,
}: {
  section: PageSection;
  upload: (files: FileList | null, field: "imageUrl" | "images") => Promise<void>;
  /** Upload one file, get its public URL. Used by blocks that hold their own list of images. */
  uploadFile: (file: File) => Promise<string>;
  uploading: boolean;
  onUpdate: (patch: Partial<PageSection>) => void;
  /**
   * Hand a now-unreferenced image URL to the page's delete queue. Dropping it
   * from `sections` alone orphans the storage object forever; the queue is
   * flushed after a successful save and filtered against what's still in use.
   */
  onQueueDelete: (urls: string[]) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <ContentFields
          section={section}
          upload={upload}
          uploadFile={uploadFile}
          uploading={uploading}
          onUpdate={onUpdate}
          onQueueDelete={onQueueDelete}
        />
      </div>
      <StyleFields section={section} onUpdate={onUpdate} />
    </div>
  );
}

/* ── Look ──────────────────────────────────────────────────────────────────── */

function StyleFields({
  section, onUpdate,
}: {
  section: PageSection;
  onUpdate: (patch: Partial<PageSection>) => void;
}) {
  const axes = STYLE_AXES_FOR[section.type] ?? [];
  if (axes.length === 0) return null;

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Look
      </p>
      {axes.map((axis) => {
        const ui = AXIS_UI[axis];
        const current = section[axis] as unknown;
        return (
          <div key={axis} className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">{ui.label}</Label>
            <div className="flex flex-wrap gap-1.5">
              {ui.options.map((opt) => {
                const active = current === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onUpdate({ [axis]: opt.value } as Partial<PageSection>)}
                    className={cn(
                      "rounded-lg border px-2.5 h-7 text-[11px] font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
              {/* Clearing returns the block to the page's original look, which is
                  not always the first option — see `pick()` in PageSectionView. */}
              {current !== undefined && (
                <button
                  type="button"
                  onClick={() => onUpdate({ [axis]: undefined } as Partial<PageSection>)}
                  className="rounded-lg border border-transparent px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Content ───────────────────────────────────────────────────────────────── */

function ContentFields({
  section, upload, uploadFile, uploading, onUpdate, onQueueDelete,
}: {
  section: PageSection;
  upload: (files: FileList | null, field: "imageUrl" | "images") => Promise<void>;
  uploadFile: (file: File) => Promise<string>;
  uploading: boolean;
  onUpdate: (patch: Partial<PageSection>) => void;
  onQueueDelete: (urls: string[]) => void;
}) {
  const inputCls = "h-9 rounded-lg text-sm bg-background";

  switch (section.type) {
    case "hero":
      return (
        <>
          <UploadField
            label="Hero image"
            value={section.imageUrl ?? null}
            uploading={uploading}
            onFiles={(f) => upload(f, UPLOAD_FIELD)}
            onClear={() => {
              if (section.imageUrl) onQueueDelete([section.imageUrl]);
              onUpdate({ imageUrl: null });
            }}
          />
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Headline</Label>
            <Input
              value={section.headline ?? ""}
              onChange={(e) => onUpdate({ headline: e.target.value })}
              placeholder="Hotel name or a bold line"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Subtext / tagline</Label>
            <Textarea
              value={section.subtext ?? ""}
              onChange={(e) => onUpdate({ subtext: e.target.value })}
              placeholder="One welcoming line…"
              className="rounded-lg text-sm min-h-[52px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Button label</Label>
              <Input value={section.ctaLabel ?? ""} onChange={(e) => onUpdate({ ctaLabel: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Button link</Label>
              <Input value={section.ctaHref ?? ""} onChange={(e) => onUpdate({ ctaHref: e.target.value })} placeholder="#rooms" className={inputCls} />
            </div>
          </div>
        </>
      );

    case "text":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Heading</Label>
            <Input value={section.heading ?? ""} onChange={(e) => onUpdate({ heading: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Paragraph</Label>
            <Textarea
              value={section.body ?? ""}
              onChange={(e) => onUpdate({ body: e.target.value })}
              className="rounded-lg text-sm min-h-[96px]"
              placeholder="Tell guests what makes this hotel special…"
            />
          </div>
        </>
      );

    // A policy clause — a rule title plus the rule text. Same shape as a text
    // block, so the owner edits it inline the same way.
    case "policy":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Policy title</Label>
            <Input value={section.heading ?? ""} onChange={(e) => onUpdate({ heading: e.target.value })} placeholder="Check-in & check-out" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Policy text</Label>
            <Textarea
              value={section.body ?? ""}
              onChange={(e) => onUpdate({ body: e.target.value })}
              className="rounded-lg text-sm min-h-[96px]"
              placeholder="Check-in is from 14:00, check-out by 12:00…"
            />
          </div>
        </>
      );

    case "gallery":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Section title</Label>
            <Input value={section.title ?? "Gallery"} onChange={(e) => onUpdate({ title: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Photos</Label>
            <div className="grid grid-cols-3 gap-2">
              {(section.images ?? []).map((url, i) => (
                <div key={url + i} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-border">
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      onQueueDelete([url]);
                      onUpdate({ images: (section.images ?? []).filter((_, j) => j !== i) });
                    }}
                    className="absolute top-1 right-1 w-5 h-5 bg-foreground/70 rounded-full flex items-center justify-center text-background"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {(section.images ?? []).length < 12 && (
                <label
                  className={cn(
                    "aspect-[4/3] rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground cursor-pointer hover:border-accent/60 hover:bg-accent/5 transition-colors",
                    uploading && "opacity-60 pointer-events-none",
                  )}
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  <span className="text-[10px]">Add</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { upload(e.target.files, UPLOAD_GALLERY); e.target.value = ""; }} />
                </label>
              )}
            </div>
          </div>
        </>
      );

    case "rooms":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Section title</Label>
            <Input value={section.title ?? "Rooms & rates"} onChange={(e) => onUpdate({ title: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Subtitle</Label>
            <Input value={section.subtitle ?? ""} onChange={(e) => onUpdate({ subtitle: e.target.value })} className={inputCls} />
          </div>
          <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            Which rooms appear here is set under <span className="font-medium text-foreground">Page → Featured rooms</span>.
          </p>
        </>
      );

    case "menu":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Section title</Label>
            <Input value={section.title ?? "Menu"} onChange={(e) => onUpdate({ title: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Subtitle</Label>
            <Input value={section.subtitle ?? ""} onChange={(e) => onUpdate({ subtitle: e.target.value })} className={inputCls} />
          </div>
          <MenuItemsEditor
            items={section.items ?? []}
            uploadFile={uploadFile}
            onUpdate={onUpdate}
            onQueueDelete={onQueueDelete}
          />
        </>
      );

    case "cta":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Heading</Label>
            <Input value={section.heading ?? ""} onChange={(e) => onUpdate({ heading: e.target.value })} placeholder="Book your stay today" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Button label</Label>
              <Input value={section.buttonLabel ?? ""} onChange={(e) => onUpdate({ buttonLabel: e.target.value })} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Button link</Label>
              <Input value={section.buttonHref ?? ""} onChange={(e) => onUpdate({ buttonHref: e.target.value })} placeholder="#contact" className={inputCls} />
            </div>
          </div>
        </>
      );

    case "contact":
      return (
        <>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Heading</Label>
            <Input value={section.heading ?? "Get in touch"} onChange={(e) => onUpdate({ heading: e.target.value })} className={inputCls} />
          </div>
          <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            Phone, WhatsApp, email, map and socials come from{" "}
            <span className="font-medium text-foreground">Page → Contact &amp; socials</span>.
          </p>
        </>
      );
  }
}

/** Image upload + preview + clear (used by the hero block). */
function UploadField({
  label, value, uploading, onFiles, onClear,
}: {
  label: string;
  value: string | null;
  uploading: boolean;
  onFiles: (files: FileList | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt={label} className="w-24 h-16 rounded-lg object-cover border border-border" />
        ) : (
          <div className="w-24 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground">
            <ImagePlus className="w-5 h-5" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className={cn(
            "inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 h-8 text-xs font-medium cursor-pointer hover:border-accent/60",
            uploading && "opacity-60 pointer-events-none",
          )}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            {value ? "Replace" : "Upload"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {value && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={onClear}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Menu items editor for the menu section.
 *
 * ── WHY THE UPLOAD GOES TO STORAGE, NOT A DATA URL ─────────────────────────
 * The first version of this read each dish photo with `FileReader.readAsDataURL`
 * and stored the base64 inline. That put every photo inside the hotel's
 * `sections` JSONB column: a twenty-dish menu became several megabytes in one
 * row, re-sent in full on every page view and every editor save, with no CDN
 * and no lazy loading. On the connections this audience actually has, that is
 * the difference between a page that loads and one that doesn't.
 *
 * Dish photos now go through the same `hotel-assets` bucket as the gallery, and
 * only the URL is stored — which also makes them visible to the editor's
 * delete-queue accounting in EditHotel.
 */
function MenuItemsEditor({
  items, uploadFile, onUpdate, onQueueDelete,
}: {
  items: MenuItem[];
  uploadFile: (file: File) => Promise<string>;
  onUpdate: (patch: Partial<PageSection>) => void;
  onQueueDelete: (urls: string[]) => void;
}) {
  const inputCls = "h-9 rounded-lg text-sm bg-background";
  // Per-item, not global: uploading a photo for one dish must not disable the
  // upload button on every other row.
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const updateItem = (id: string, patch: Partial<MenuItem>) => {
    onUpdate({
      items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  const deleteItem = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.imageUrl) onQueueDelete([item.imageUrl]);
    onUpdate({ items: items.filter((i) => i.id !== id) });
  };

  const addItem = () => {
    const newItem: MenuItem = { id: uid(), name: "", price: 0 };
    onUpdate({ items: [...items, newItem] });
  };

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Menu Items
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={addItem}
        >
          <Plus className="w-3 h-3" /> Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          No items yet. Click "Add item" to start building your menu.
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-border bg-muted/30 p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(item.id, { name: e.target.value })}
                    placeholder="Item name (e.g., Chicken Biryani)"
                    className={cn(inputCls, "font-medium")}
                  />
                  <Input
                    value={item.category ?? ""}
                    onChange={(e) => updateItem(item.id, { category: e.target.value })}
                    placeholder="Category (e.g., Main course)"
                    className={inputCls}
                  />
                  <Textarea
                    value={item.description ?? ""}
                    onChange={(e) => updateItem(item.id, { description: e.target.value })}
                    placeholder="Description (optional)"
                    className="rounded-lg text-sm min-h-[48px]"
                  />
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground whitespace-nowrap">Price:</Label>
                    <Input
                      type="number"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, { price: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className={cn(inputCls, "flex-1")}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => deleteItem(item.id)}
                  aria-label={`Delete ${item.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {/* Image upload */}
              <div className="flex items-center gap-3">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-20 h-20 rounded-lg object-cover border border-border"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground">
                    <ImagePlus className="w-5 h-5" />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label
                    className={cn(
                      "inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 h-8 text-xs font-medium cursor-pointer hover:border-accent/60",
                      busyItemId === item.id && "opacity-60 pointer-events-none",
                    )}
                  >
                    {busyItemId === item.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="w-3.5 h-3.5" />
                    )}
                    {item.imageUrl ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const previous = item.imageUrl;
                        setBusyItemId(item.id);
                        try {
                          const url = await uploadFile(file);
                          // Queue the OLD image only once the new one is safely
                          // stored — a failed upload must not orphan the photo
                          // that is still on the page.
                          if (previous) onQueueDelete([previous]);
                          updateItem(item.id, { imageUrl: url });
                        } catch {
                          toast.error("Couldn't upload that photo.");
                        } finally {
                          setBusyItemId(null);
                        }
                      }}
                    />
                  </label>
                  {item.imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive"
                      onClick={() => {
                        if (item.imageUrl) onQueueDelete([item.imageUrl]);
                        updateItem(item.id, { imageUrl: null });
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
