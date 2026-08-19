import { AlertCircle, Check, Loader2, Upload, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import { PAYMENT_OPTIONS, PAYMENT_OPTION_META } from "@/lib/payments";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SECTION_META, type PageSection } from "@/components/hotel/page-sections";
import { SectionFields } from "@/components/hotel/SectionFields";
import { PAGE_TEMPLATES, type PageTemplate } from "@/components/hotel/page-templates";
import type { ManagedProperty } from "@/hooks/use-rent";

const ACCENT_PRESETS = [
  "#0f766e", "#047857", "#1d4ed8", "#b45309", "#b91c1c", "#0f172a", "#7c3aed", "#be185d",
];

export type PageSettings = {
  name: string;
  accentColor: string;
  logoUrl: string;
  contactPhone: string;
  contactWhatsapp: string;
  contactEmail: string;
  address: string;
  /** The hotel's single district. "" = not chosen yet. */
  district: string;
  mapsUrl: string;
  socials: { facebook: string; instagram: string; tiktok: string; twitter: string };
  /** Which ways this hotel lets a guest pay. See src/lib/payments.ts. */
  paymentOptions: string[];
  /** Share taken up front when a deposit is offered. */
  depositPercent: number;
  isPublished: boolean;
};

/**
 * The inspector rail: Block settings for the current selection, Page settings
 * for everything shared. Rendered inside a flow container by the builder.
 */
export function InspectorPanel({
  tab, onTabChange, onClose,
  section, sectionIndex, onSectionPatch, upload, uploadFile, uploading,
  settings, onSettingsChange,
  rooms, selectedRooms, onToggleRoom,
  slug, onApplyLook, onLogoFile, onLogoRemove, logoUploading, onQueueDelete,
  team,
  pages,
}: {
  tab: "block" | "page";
  onTabChange: (t: "block" | "page") => void;
  onClose: () => void;
  section: PageSection | null;
  sectionIndex: number;
  onSectionPatch: (patch: Partial<PageSection>) => void;
  upload: (files: FileList | null, field: "imageUrl" | "images") => Promise<void>;
  /**
   * Upload one file and hand back its public URL.
   *
   * `upload` above writes into the SELECTED BLOCK's own fields, which is the
   * wrong shape for anything holding a list of its own images — a menu block's
   * dishes each carry a picture. This is the raw primitive for those.
   */
  uploadFile: (file: File) => Promise<string>;
  uploading: boolean;
  settings: PageSettings;
  onSettingsChange: (patch: Partial<PageSettings>) => void;
  rooms: ManagedProperty[];
  selectedRooms: string[];
  onToggleRoom: (id: string) => void;
  slug: string;
  onApplyLook: (t: PageTemplate) => void;
  onLogoFile: (file: File) => void;
  onLogoRemove: () => void;
  logoUploading: boolean;
  onQueueDelete: (urls: string[]) => void;
  /**
   * The hotel's team panel, passed in as a slot.
   *
   * It needs the hotel id and owner, which this panel is otherwise blissfully
   * unaware of — taking them as props would drag membership data into a
   * component whose entire job is editing blocks. A slot keeps the seam at the
   * page, where the hotel already lives.
   */
  team?: React.ReactNode;
  /** The hotel's page list (add/rename/publish/home/delete), passed in as a slot. */
  pages?: React.ReactNode;
}) {
  /**
   * A plain block that fills whatever container it is given — no positioning.
   *
   * This started as a panel floating beside the selected block. That design
   * needs a live DOM anchor, and the canvas replaces its nodes on every
   * keystroke as the reorder list re-projects, so the anchor was perpetually
   * detached and the panel hid itself. A rail in normal flow has no anchor, no
   * collision maths and no flip logic, and it cannot cover the block it edits.
   */
  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <Tabs
        value={tab}
        onValueChange={(v) => onTabChange(v as "block" | "page")}
        className="flex flex-col min-h-0 flex-1"
      >
        <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
          <TabsList className="h-8 flex-1">
            <TabsTrigger value="block" className="text-xs h-6 flex-1" disabled={!section}>
              {section ? SECTION_META[section.type].label : "Block"}
            </TabsTrigger>
            <TabsTrigger value="page" className="text-xs h-6 flex-1">Page</TabsTrigger>
          </TabsList>
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 min-h-0 flex-1">
          <TabsContent value="block" className="mt-0 space-y-3">
            {section ? (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Block {sectionIndex + 1} · {SECTION_META[section.type].hint}
                </p>
                <SectionFields
                  section={section}
                  upload={upload}
                  uploadFile={uploadFile}
                  uploading={uploading}
                  onUpdate={onSectionPatch}
                  onQueueDelete={onQueueDelete}
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-6 text-center">
                Click a block on the page to edit it.
              </p>
            )}
          </TabsContent>

          <TabsContent value="page" className="mt-0">
            <PageTab
              settings={settings}
              onChange={onSettingsChange}
              rooms={rooms}
              selectedRooms={selectedRooms}
              onToggleRoom={onToggleRoom}
              slug={slug}
              onApplyLook={onApplyLook}
              onLogoFile={onLogoFile}
              onLogoRemove={onLogoRemove}
              logoUploading={logoUploading}
              team={team}
              pages={pages}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/* ── Page-wide settings ────────────────────────────────────────────────────── */

function PageTab({
  settings, onChange, rooms, selectedRooms, onToggleRoom, slug, onApplyLook,
  onLogoFile, onLogoRemove, logoUploading, team, pages,
}: {
  settings: PageSettings;
  onChange: (patch: Partial<PageSettings>) => void;
  rooms: ManagedProperty[];
  selectedRooms: string[];
  onToggleRoom: (id: string) => void;
  slug: string;
  onApplyLook: (t: PageTemplate) => void;
  onLogoFile: (file: File) => void;
  onLogoRemove: () => void;
  logoUploading: boolean;
  team?: React.ReactNode;
  /** The hotel's page list (add/rename/publish/home/delete), passed in as a slot. */
  pages?: React.ReactNode;
}) {
  const accentError = !/^#[0-9a-fA-F]{6}$/.test(settings.accentColor)
    ? "Use a hex colour like #0f766e."
    : null;

  return (
    <div className="space-y-5">
      <Group title="Identity">
        <div className="space-y-1.5">
          <Label htmlFor="hotel-name" className="text-[11px] text-muted-foreground">Hotel name</Label>
          <Input
            id="hotel-name"
            value={settings.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-9 rounded-lg text-sm bg-background"
            aria-invalid={settings.name.trim().length < 2}
          />
          {settings.name.trim().length < 2 && (
            <p className="text-[11px] text-destructive">Enter the hotel's name.</p>
          )}
        </div>
      </Group>

      <Group title="Accent colour">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              onClick={() => onChange({ accentColor: c })}
              className={cn(
                "w-7 h-7 rounded-full border-2 transition-transform",
                settings.accentColor.toLowerCase() === c.toLowerCase()
                  ? "border-foreground scale-110"
                  : "border-transparent",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={settings.accentColor}
            onChange={(e) => onChange({ accentColor: e.target.value })}
            className="w-7 h-7 rounded-full border border-border cursor-pointer"
            aria-label="Custom accent colour"
          />
        </div>
        {accentError && <p className="text-[11px] text-destructive mt-1">{accentError}</p>}
      </Group>

      {/* Restyles only — never touches text or images, so there's nothing to
          confirm and nothing to undo. */}
      <Group title="Looks">
        <p className="text-[11px] text-muted-foreground mb-2">
          Restyles the page. Your words and photos stay exactly as they are.
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {PAGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onApplyLook(t)}
              className="rounded-lg border border-border p-2 text-left hover:border-primary/50 transition-colors"
            >
              <span
                className="block h-5 rounded mb-1.5"
                style={{ background: `linear-gradient(135deg, ${t.accentColor}, #0f172a 160%)` }}
              />
              <span className="text-[10px] font-medium text-foreground">{t.label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Logo">
        <div className="flex items-start gap-3">
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="Logo" className="w-14 h-14 rounded-xl object-cover border border-border" />
          ) : (
            <div className="w-14 h-14 rounded-xl border border-dashed border-border flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-lg border border-border px-3 h-8 text-xs font-medium cursor-pointer hover:border-accent/60",
                logoUploading && "opacity-60 pointer-events-none",
              )}
            >
              {logoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {settings.logoUrl ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onLogoFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            {settings.logoUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive"
                onClick={onLogoRemove}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </Group>

      <Group title="Featured rooms">
        {rooms.length === 0 ? (
          <p className="text-[11px] text-muted-foreground rounded-lg border border-dashed border-border p-3">
            No hotel rooms yet. List a nightly-rate unit of type "Hotel" and it appears here.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-52 overflow-y-auto">
            {rooms.map((room) => {
              const checked = selectedRooms.includes(room.id);
              return (
                <li key={room.id}>
                  <label
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2 cursor-pointer transition-colors",
                      checked ? "border-primary/50 bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleRoom(room.id)}
                      className="w-3.5 h-3.5 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-foreground truncate">{room.title}</span>
                      <span className="block text-[10px] text-muted-foreground truncate">{room.location}</span>
                    </span>
                    {checked && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      {/* ── Payment ───────────────────────────────────────────────────────────
          What a guest is offered on the booking form. A hotel that only takes
          cash keeps "At the hotel" and turns the other two off; one that wants
          the money up front does the reverse.

          Turning everything off would leave a booking form with no way to
          proceed, so the last option cannot be unticked — the handler below
          refuses rather than the UI hiding the checkbox, because a disabled
          control with no explanation reads as a bug. */}
      <Group title="Payment">
        <div className="space-y-2">
          {PAYMENT_OPTIONS.map((option) => {
            const meta = PAYMENT_OPTION_META[option];
            const checked = settings.paymentOptions.includes(option);
            const isLast = checked && settings.paymentOptions.length === 1;
            return (
              <label
                key={option}
                className="flex items-start gap-2.5 cursor-pointer"
                title={isLast ? "A hotel has to accept at least one way to pay." : undefined}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    if (!next && isLast) return;
                    onChange({
                      paymentOptions: next
                        ? [...settings.paymentOptions, option]
                        : settings.paymentOptions.filter((o) => o !== option),
                    });
                  }}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-xs text-foreground">
                    {option === "deposit"
                      ? `Deposit (${settings.depositPercent}%)`
                      : meta.label}
                  </span>
                  <span className="block text-[11px] text-muted-foreground leading-snug">
                    {meta.hint}
                  </span>
                </span>
              </label>
            );
          })}

          {settings.paymentOptions.includes("deposit") && (
            <div className="pt-1">
              <Label className="text-[11px] text-muted-foreground">Deposit percentage</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={settings.depositPercent}
                onChange={(e) =>
                  // Clamped on save as well (and in the database) — this only
                  // stops the field fighting the person typing "2" on the way
                  // to "25".
                  onChange({ depositPercent: Number(e.target.value) || 0 })
                }
                className="h-9 text-xs mt-1"
              />
            </div>
          )}

          <p className="text-[11px] text-muted-foreground pt-1">
            Guests pay with EVC Plus, Zaad, eDahab, Sahal or a card. Money reaches your
            account through Sifalo Pay.
          </p>
        </div>
      </Group>

      {/* ── District ──────────────────────────────────────────────────────────
          A hotel is one building, so it has one district — and this is the only
          place it can be set. The add-room wizard reads it from here instead of
          asking again, which is what stops one hotel's rooms from ending up
          scattered across two districts in search. */}
      <Group title="District">
        <div className="space-y-2">
          <Select
            value={settings.district || undefined}
            onValueChange={(v) => onChange({ district: v })}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Choose the district" />
            </SelectTrigger>
            <SelectContent>
              {MOGADISHU_DISTRICTS.map((d) => (
                <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {settings.district ? (
            <p className="text-[11px] text-muted-foreground">
              Every room you add is filed under{" "}
              <span className="text-foreground">{settings.district}</span>.
            </p>
          ) : (
            <p className="text-[11px] text-amber-600 dark:text-amber-500 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
              Set this before adding rooms — the room form takes its district
              from here and won't run without it.
            </p>
          )}
        </div>
      </Group>

      <Group title="Contact & socials">
        <div className="space-y-2">
          <Field label="Phone" value={settings.contactPhone} onChange={(v) => onChange({ contactPhone: v })} placeholder="+252…" />
          <Field label="WhatsApp" value={settings.contactWhatsapp} onChange={(v) => onChange({ contactWhatsapp: v })} placeholder="+252…" />
          <Field label="Email" value={settings.contactEmail} onChange={(v) => onChange({ contactEmail: v })} placeholder="stay@hotel.com" />
          {/* Street only — the district above is the authoritative one. */}
          <Field label="Street address" value={settings.address} onChange={(v) => onChange({ address: v })} placeholder="Street or landmark" />
          <Field label="Maps link" value={settings.mapsUrl} onChange={(v) => onChange({ mapsUrl: v })} placeholder="https://maps.app.goo.gl/…" />
          <Field label="Facebook" value={settings.socials.facebook} onChange={(v) => onChange({ socials: { ...settings.socials, facebook: v } })} />
          <Field label="Instagram" value={settings.socials.instagram} onChange={(v) => onChange({ socials: { ...settings.socials, instagram: v } })} />
          <Field label="TikTok" value={settings.socials.tiktok} onChange={(v) => onChange({ socials: { ...settings.socials, tiktok: v } })} />
          <Field label="X / Twitter" value={settings.socials.twitter} onChange={(v) => onChange({ socials: { ...settings.socials, twitter: v } })} />
        </div>
      </Group>

      {/* Sits above Publish on purpose: deciding who can edit the page is the
          last thing you settle before deciding whether the world can see it. */}
      {/* Above Team and Publish: what pages exist is a more basic question
          than who may edit them or whether the world can see them. */}
      {pages && <Group title="Pages">{pages}</Group>}

      {team && <Group title="Team">{team}</Group>}

      <Group title="Publish">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Public at <span className="text-foreground">/hotels/{slug}</span>. Drafts are only visible to you.
          </p>
          <Switch checked={settings.isPublished} onCheckedChange={(v) => onChange({ isPublished: v })} />
        </div>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-lg text-sm bg-background"
      />
    </div>
  );
}
