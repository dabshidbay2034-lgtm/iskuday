import { useRef } from "react";
import { Reorder, useDragControls } from "framer-motion";
import {
  ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SECTION_META, SECTION_ORDER, type PageSection, type SectionType,
} from "@/components/hotel/page-sections";
import { PageSectionView, type PageBrand } from "@/components/hotel/PageSectionView";
import type { HotelRoomProperty } from "@/hooks/use-hotels";

/**
 * The builder canvas: the real page, made selectable.
 *
 * Every block renders through the SAME `PageSectionView` the public page uses,
 * in `mode="edit"` so nothing navigates and the gallery stops auto-advancing.
 * The chrome (outline, toolbar, insert strips) is layered on top and never
 * inside the block, so what you see is genuinely what gets published.
 */
export function EditorCanvas({
  sections, brand, rooms, selectedId,
  onSelect, onReorder, onPatch, onMove, onDuplicate, onDelete, onInsert,
}: {
  sections: PageSection[];
  brand: PageBrand;
  rooms: HotelRoomProperty[];
  selectedId: string | null;
  onSelect: (id: string, el: HTMLElement | null) => void;
  onReorder: (next: PageSection[]) => void;
  onPatch: (id: string, patch: Partial<PageSection>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onInsert: (type: SectionType, atIndex: number) => void;
}) {
  if (sections.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-muted-foreground mb-4">This page has no blocks yet.</p>
        <InsertStrip onInsert={(t) => onInsert(t, 0)} alwaysVisible />
      </div>
    );
  }

  return (
    <Reorder.Group axis="y" values={sections} onReorder={onReorder} as="div">
      {sections.map((section, i) => (
        <div key={section.id}>
          <InsertStrip onInsert={(t) => onInsert(t, i)} />
          <CanvasBlock
            section={section}
            brand={brand}
            rooms={rooms}
            selected={selectedId === section.id}
            isFirst={i === 0}
            isLast={i === sections.length - 1}
            onSelect={onSelect}
            onPatch={(patch) => onPatch(section.id, patch)}
            onMove={(dir) => onMove(section.id, dir)}
            onDuplicate={() => onDuplicate(section.id)}
            onDelete={() => onDelete(section.id)}
          />
        </div>
      ))}
      <InsertStrip onInsert={(t) => onInsert(t, sections.length)} />
    </Reorder.Group>
  );
}

function CanvasBlock({
  section, brand, rooms, selected, isFirst, isLast,
  onSelect, onPatch, onMove, onDuplicate, onDelete,
}: {
  section: PageSection;
  brand: PageBrand;
  rooms: HotelRoomProperty[];
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (id: string, el: HTMLElement | null) => void;
  onPatch: (patch: Partial<PageSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const meta = SECTION_META[section.type];

  return (
    <Reorder.Item
      value={section}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      className="relative"
    >
      <div
        ref={wrapRef}
        // The inspector finds its anchor by this attribute rather than holding a
        // captured node: React can replace this element on any re-render, and a
        // stale node reports `isConnected === false`, which silently hides the
        // panel instead of moving it.
        data-block-id={section.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${meta.label} block`}
        onClick={() => onSelect(section.id, wrapRef.current)}
        onKeyDown={(e) => {
          // ONLY when the wrapper itself has focus. Without this guard, Space
          // typed inside an inline text field bubbles up here and gets
          // preventDefault()-ed — default actions run after the event finishes
          // propagating, so the space is swallowed and you cannot type a
          // multi-word headline anywhere in the builder.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(section.id, wrapRef.current);
          }
        }}
        // Inline text lives inside these blocks, so a bare click must not be
        // swallowed — but any real link inside is already inert via mode="edit".
        className={cn(
          "group/block relative outline-none transition-shadow cursor-default",
          "ring-offset-0 hover:ring-1 hover:ring-primary/40",
          selected && "ring-2 ring-primary",
        )}
      >
        <PageSectionView section={section} brand={brand} rooms={rooms} mode="edit" onPatch={onPatch} />

        {/* Type label — top-left, only while hovered or selected. */}
        <span
          className={cn(
            "pointer-events-none absolute top-2 left-2 z-20 rounded-md bg-primary px-2 py-0.5",
            "text-[10px] font-semibold uppercase tracking-wider text-primary-foreground transition-opacity",
            selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100",
          )}
        >
          {meta.label}
        </span>

        {/* Toolbar — top-right. Kept out of the block's own flow so it can never
            shift the layout being previewed. */}
        <div
          className={cn(
            "absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-lg border border-border",
            "bg-card/95 backdrop-blur-sm p-0.5 shadow-elevated transition-opacity",
            selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Drag to reorder"
            title="Drag to reorder"
            onPointerDown={(e) => dragControls.start(e)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <ToolButton label="Move up" disabled={isFirst} onClick={() => onMove(-1)}>
            <ArrowUp className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton label="Move down" disabled={isLast} onClick={() => onMove(1)}>
            <ArrowDown className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton label="Duplicate" onClick={onDuplicate}>
            <Copy className="w-3.5 h-3.5" />
          </ToolButton>
          <ToolButton label="Delete block" destructive onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </ToolButton>
        </div>
      </div>
    </Reorder.Item>
  );
}

function ToolButton({
  label, onClick, disabled, destructive, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
        "disabled:opacity-30 disabled:pointer-events-none",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The "add a block here" row between two blocks.
 *
 * It keeps a REAL height even while idle. A zero-height strip that expands on
 * hover sounds tidy and is unusable: there is nothing to point at, and the
 * buttons overflow invisibly across the block below. So the strip always
 * occupies a thin band — that band is the hover target, and the buttons fade
 * in inside it.
 */
function InsertStrip({
  onInsert, alwaysVisible,
}: {
  onInsert: (type: SectionType) => void;
  alwaysVisible?: boolean;
}) {
  return (
    <div className="group/strip relative z-30 flex items-center gap-1 px-3 h-9">
      <div className="h-px flex-1 bg-border group-hover/strip:bg-primary/40 transition-colors" />
      <div
        className={cn(
          "flex items-center gap-1 transition-opacity",
          alwaysVisible
            ? "opacity-100"
            : "opacity-0 group-hover/strip:opacity-100 focus-within:opacity-100",
        )}
      >
        <Plus className="w-3 h-3 text-primary/60 shrink-0" />
        {SECTION_ORDER.map((type) => {
          const { label, Icon } = SECTION_META[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onInsert(type)}
              title={`Add ${label}`}
              aria-label={`Add ${label} block`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 h-7 text-[11px] font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground shadow-card"
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          );
        })}
      </div>
      <div className="h-px flex-1 bg-border group-hover/strip:bg-primary/40 transition-colors" />
    </div>
  );
}
