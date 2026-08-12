import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PageSection } from "@/components/hotel/page-sections";
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

const UPLOAD_FIELD: "imageUrl" = "imageUrl";
const UPLOAD_GALLERY: "images" = "images";

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
  section, upload, uploading, onUpdate, onQueueDelete,
}: {
  section: PageSection;
  upload: (files: FileList | null, field: "imageUrl" | "images") => Promise<void>;
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
  section, upload, uploading, onUpdate, onQueueDelete,
}: {
  section: PageSection;
  upload: (files: FileList | null, field: "imageUrl" | "images") => Promise<void>;
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
