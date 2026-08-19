import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, Globe, Loader2, Monitor, Save, Smartphone, Tablet,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorCanvas } from "@/components/hotel/EditorCanvas";
import { InspectorPanel, type PageSettings } from "@/components/hotel/InspectorPanel";
import {
  DevicePreviewFrame, type DeviceMode,
} from "@/components/hotel/DevicePreviewFrame";
import type { PageBrand } from "@/components/hotel/PageSectionView";
import {
  duplicateSection, newSection, type PageSection, type SectionType,
} from "@/components/hotel/page-sections";
import { applyLook, type PageTemplate } from "@/components/hotel/page-templates";
import { HotelTeamCard } from "@/components/hotel/HotelTeamCard";
import { HotelPagesCard } from "@/components/hotel/HotelPagesCard";
import {
  useHotel, useHotelRooms, useUpdateHotel, useSetHotelRooms,
  uploadHotelAsset, removeHotelAsset, type HotelRoomProperty,
} from "@/hooks/use-hotels";
import { useAppAuth } from "@/hooks/use-auth";
import { useOrgProperties } from "@/hooks/use-rent";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { clampPercent } from "@/lib/payments";

const DEVICES: { value: DeviceMode; Icon: typeof Monitor; label: string }[] = [
  { value: "desktop", Icon: Monitor, label: "Desktop" },
  { value: "tablet", Icon: Tablet, label: "Tablet" },
  { value: "mobile", Icon: Smartphone, label: "Mobile" },
];

/**
 * EVERY storage URL a block references, including its descendants.
 *
 * Both the delete queue and the still-in-use set are built from this, so they
 * can never disagree about what a block owns. Two things were missed by the
 * flat `[s.imageUrl, ...s.images]` version it replaces:
 *
 *   • `items[].imageUrl` — a menu block's dish photos. Harmless while those
 *     were inline data URLs (removeHotelAsset ignores anything that isn't a
 *     hotel-assets URL), but the moment they became real uploads, deleting a
 *     menu block would have orphaned every photo on it.
 *   • `children` — anything inside a row/column. A hero nested in a column was
 *     invisible to both sets, so its image was never cleaned up on delete AND
 *     never counted as in-use, which is the combination that deletes a live
 *     image out from under a published page.
 */
function imageUrlsOf(section: PageSection): string[] {
  const own = [
    section.imageUrl,
    ...(section.images ?? []),
    ...(section.items ?? []).map((i) => i.imageUrl),
  ];
  const nested = (section.children ?? []).flatMap(imageUrlsOf);
  return [...own, ...nested].filter(Boolean) as string[];
}

/**
 * The hotel-page BUILDER (/manage/hotels/:id).
 *
 * You edit the page by looking at it: the canvas renders the real blocks through
 * the same component the public page uses, you click one to select it, and the
 * inspector floats in beside it. Text is typed directly on the page; images,
 * links and the look come from the panel.
 */
const EditHotel = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userId } = useAppAuth();

  const { data: hotel, isPending: hotelPending } = useHotel(id);
  const { data: roomLinks } = useHotelRooms(id);
  const candidateRooms = useOrgProperties();
  const updateHotel = useUpdateHotel();
  const setRooms = useSetHotelRooms(id);

  const [settings, setSettings] = useState<PageSettings>({
    name: "", accentColor: "#0f766e", logoUrl: "",
    contactPhone: "", contactWhatsapp: "", contactEmail: "", address: "", district: "", mapsUrl: "",
    socials: { facebook: "", instagram: "", tiktok: "", twitter: "" },
    // Matches the database default. A hotel that never opens this panel keeps
    // taking bookings exactly as it did before online payment existed.
    paymentOptions: ["pay_now", "deposit", "at_hotel"],
    depositPercent: 25,
    fontPairing: "modern",
    cornerStyle: "soft",
    themeMode: "auto",
    isPublished: false,
  });
  const [sections, setSections] = useState<PageSection[]>([]);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"block" | "page">("page");
  const [device, setDevice] = useState<DeviceMode>("desktop");

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

  /**
   * Storage objects to delete AFTER a successful save.
   *
   * Deleting on click was destructive: the object went immediately while the row
   * still pointed at it, so cancelling (or just closing the tab) left a live,
   * published page rendering a broken image.
   */
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);

  /**
   * Hydrate once per hotel, not on every refetch.
   *
   * The old effect keyed on the `hotel` object, so any background refetch
   * overwrote whatever the owner had typed. Harmless for a quick form; fatal for
   * an in-place editing session that stays open for twenty minutes.
   */
  const hydratedIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);

  const hydrate = useCallback((h: NonNullable<typeof hotel>) => {
    setSettings({
      name: h.name,
      accentColor: h.accentColor || "#0f766e",
      logoUrl: h.logoUrl ?? "",
      contactPhone: h.contactPhone ?? "",
      contactWhatsapp: h.contactWhatsapp ?? "",
      contactEmail: h.contactEmail ?? "",
      address: h.address ?? "",
      district: h.district ?? "",
      paymentOptions: h.paymentOptions?.length ? h.paymentOptions : ["at_hotel"],
      depositPercent: h.depositPercent || 25,
      fontPairing: h.fontPairing || "modern",
      cornerStyle: h.cornerStyle || "soft",
      themeMode: h.themeMode || "auto",
      mapsUrl: h.mapsUrl ?? "",
      socials: {
        facebook: h.socials?.facebook ?? "",
        instagram: h.socials?.instagram ?? "",
        tiktok: h.socials?.tiktok ?? "",
        twitter: h.socials?.twitter ?? "",
      },
      isPublished: h.isPublished,
    });
    setSections(h.sections);
    dirtyRef.current = false;
  }, []);

  useEffect(() => {
    if (!hotel || hydratedIdRef.current === hotel.id) return;
    hydratedIdRef.current = hotel.id;
    hydrate(hotel);
  }, [hotel, hydrate]);

  // Room ORDER is meaningful — `hotel_rooms.sort_order` is what the page renders
  // by. The previous code flattened a Set and sorted lexicographically by UUID,
  // silently discarding the saved order on every load.
  const linkedRoomIds = useMemo(
    () => (roomLinks ?? []).map((l) => l.propertyId),
    [roomLinks],
  );
  const linkedKey = linkedRoomIds.join(",");
  useEffect(() => {
    setSelectedRooms(linkedRoomIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedKey]);

  const myRooms = useMemo(
    () => (candidateRooms.data ?? []).filter((p) => p.type === "hotel"),
    [candidateRooms.data],
  );

  /** Rooms as the renderer wants them, preferring the saved link (it has photos). */
  const previewRooms: HotelRoomProperty[] = useMemo(() => {
    const saved = new Map(
      (roomLinks ?? [])
        .filter((l) => l.property)
        .map((l) => [l.propertyId, l.property as HotelRoomProperty]),
    );
    return selectedRooms.map((rid) => {
      const hit = saved.get(rid);
      if (hit) return hit;
      const p = myRooms.find((r) => r.id === rid);
      return {
        id: rid,
        title: p?.title ?? "Room",
        price: p?.monthlyRent ?? null,
        location: p?.location ?? null,
        isDailyRate: p?.isDailyRate ?? true,
        type: "hotel",
        images: [],
      };
    });
  }, [roomLinks, selectedRooms, myRooms]);

  const brand: PageBrand = useMemo(() => ({
    name: settings.name,
    tagline: sections.find((s) => s.type === "hero")?.subtext ?? null,
    accentColor: settings.accentColor,
    logoUrl: settings.logoUrl || null,
    contactPhone: settings.contactPhone || null,
    contactWhatsapp: settings.contactWhatsapp || null,
    contactEmail: settings.contactEmail || null,
    address: settings.address || null,
    mapsUrl: settings.mapsUrl || null,
    socials: settings.socials,
    paymentOptions: settings.paymentOptions,
    // Clamped on the way out as well as in the database: the number input lets
    // someone pass through 0 while typing, and a 0% deposit is a free stay.
    depositPercent: clampPercent(settings.depositPercent),
    fontPairing: settings.fontPairing,
    cornerStyle: settings.cornerStyle,
    themeMode: settings.themeMode,
  }), [settings, sections]);

  const selected = sections.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = sections.findIndex((s) => s.id === selectedId);

  const nameError = settings.name.trim().length < 2 ? "Enter the hotel's name." : null;
  const accentError = !/^#[0-9a-fA-F]{6}$/.test(settings.accentColor)
    ? "Use a hex colour like #0f766e." : null;

  /* ── Mutators (every one marks the draft dirty) ──────────────────────────── */

  const touch = () => { dirtyRef.current = true; };

  const patchSettings = (p: Partial<PageSettings>) => {
    touch();
    setSettings((prev) => ({ ...prev, ...p }));
  };

  const patchSection = (sid: string, patch: Partial<PageSection>) => {
    touch();
    setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  };

  const moveSection = (sid: string, dir: -1 | 1) => {
    touch();
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === sid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const insertSection = (type: SectionType, at: number) => {
    touch();
    const block = newSection(type);
    setSections((prev) => {
      const next = prev.slice();
      next.splice(at, 0, block);
      return next;
    });
    setSelectedId(block.id);
    setInspectorTab("block");
  };

  const duplicate = (sid: string) => {
    touch();
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === sid);
      if (i < 0) return prev;
      const copy = duplicateSection(prev[i]);
      const next = prev.slice();
      next.splice(i + 1, 0, copy);
      return next;
    });
  };

  const removeSection = (sid: string) => {
    touch();
    const block = sections.find((s) => s.id === sid);
    // Its images become unreferenced — queue them, don't delete yet.
    if (block) {
      const urls = imageUrlsOf(block);
      if (urls.length) setPendingDeletes((prev) => [...prev, ...urls]);
    }
    setSections((prev) => prev.filter((s) => s.id !== sid));
    if (selectedId === sid) { setSelectedId(null); setInspectorTab("page"); }
  };

  const selectBlock = (sid: string) => {
    setSelectedId(sid);
    setInspectorTab("block");
  };

  /**
   * Resolve the panel's anchor during render, every render.
   *
   * Two weaker versions of this were wrong. Capturing the node at click time
   * goes stale the moment framer-motion re-projects the Reorder list, and the
   * hook responds to a disconnected node by hiding itself entirely — the panel
   * silently disappears instead of moving. Doing the lookup in an effect has
   * the same problem one beat later, because the node can be replaced by a
   * render whose deps didn't change. Querying here is a DOM read during render,
   * which is impure but idempotent: it returns the SAME node while the node is
   * stable, so the hook's dependency identity stays put and listeners are not
   * re-attached on every keystroke.
   */

  /* ── Uploads ─────────────────────────────────────────────────────────────── */

  const uploadOne = async (file: File): Promise<string> => {
    if (!userId) throw new Error("Not signed in.");
    if (!file.type.startsWith("image/")) throw new Error("Image files only.");
    return uploadHotelAsset(file, userId);
  };

  const uploadForSection = async (files: FileList | null, field: "imageUrl" | "images") => {
    if (!files?.length || !selected) return;
    setUploading(true);
    try {
      if (field === "imageUrl") {
        const url = await uploadOne(files[0]);
        if (selected.imageUrl) setPendingDeletes((prev) => [...prev, selected.imageUrl as string]);
        patchSection(selected.id, { imageUrl: url });
      } else {
        const room = Math.max(0, 12 - (selected.images?.length ?? 0));
        const urls = await Promise.all(
          Array.from(files).slice(0, room).map((f) => uploadOne(f)),
        );
        patchSection(selected.id, { images: [...(selected.images ?? []), ...urls] });
      }
    } catch {
      toast.error("Couldn't upload that image.");
    } finally {
      setUploading(false);
    }
  };

  const onLogoFile = async (file: File) => {
    setLogoUploading(true);
    try {
      const url = await uploadOne(file);
      if (settings.logoUrl) setPendingDeletes((prev) => [...prev, settings.logoUrl]);
      patchSettings({ logoUrl: url });
      toast.success("Logo updated");
    } catch {
      toast.error("Couldn't upload the logo.");
    } finally {
      setLogoUploading(false);
    }
  };

  const onLogoRemove = () => {
    if (settings.logoUrl) setPendingDeletes((prev) => [...prev, settings.logoUrl]);
    patchSettings({ logoUrl: "" });
  };

  /* ── Save ────────────────────────────────────────────────────────────────── */

  const save = async () => {
    if (nameError || accentError || !id) {
      toast.error(nameError ?? accentError ?? "");
      setInspectorTab("page");
      return;
    }
    setBusy(true);
    try {
      await updateHotel.mutateAsync({
        id,
        input: {
          name: settings.name,
          accentColor: settings.accentColor,
          logoUrl: settings.logoUrl || null,
          contactPhone: settings.contactPhone,
          contactWhatsapp: settings.contactWhatsapp,
          contactEmail: settings.contactEmail,
          address: settings.address,
          district: settings.district,
          mapsUrl: settings.mapsUrl,
          socials: Object.fromEntries(
            Object.entries(settings.socials).filter(([, v]) => v.trim() !== ""),
          ),
          sections,
          isPublished: settings.isPublished,
        },
      });

      const roomsChanged =
        selectedRooms.length !== linkedRoomIds.length ||
        selectedRooms.some((r, i) => linkedRoomIds[i] !== r);
      if (roomsChanged) await setRooms.mutateAsync(selectedRooms);

      // Only NOW is it safe to delete. Filter against what the saved draft still
      // references, so removing an image and putting it back before saving does
      // not delete a live object.
      const inUse = new Set<string>(
        [settings.logoUrl, ...sections.flatMap(imageUrlsOf)].filter(Boolean) as string[],
      );
      const doomed = pendingDeletes.filter((u) => !inUse.has(u));
      if (doomed.length) {
        await Promise.allSettled(doomed.map((u) => removeHotelAsset(u)));
      }
      setPendingDeletes([]);
      dirtyRef.current = false;
      toast.success(settings.isPublished ? "Hotel page published" : "Hotel page saved");
    } catch {
      // the mutations toast their own errors
    } finally {
      setBusy(false);
    }
  };

  // Losing an in-place editing session to a stray back-swipe is a much bigger
  // deal than losing a half-filled form.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const leave = () => {
    if (dirtyRef.current && !window.confirm("Leave without saving? Your changes will be lost.")) return;
    navigate("/manage/hotels");
  };

  /* ── Render ──────────────────────────────────────────────────────────────── */

  if (hotelPending) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <div className="container max-w-5xl py-6 space-y-4">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <div className="container max-w-2xl py-24 text-center">
          <h1 className="font-heading font-bold text-2xl text-foreground mb-2">Page not found</h1>
          <p className="text-muted-foreground text-sm mb-6">
            This hotel page doesn't exist or you don't have access to it.
          </p>
          <Button variant="hero" onClick={() => navigate("/manage/hotels")}>
            Back to hotel pages
          </Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Built once and rendered in two places — the desktop rail and the mobile
  // sheet — so the two surfaces can never drift out of sync.
  const inspector = (
    <InspectorPanel
      tab={inspectorTab}
      onTabChange={setInspectorTab}
      onClose={() => { setSelectedId(null); setInspectorTab("page"); }}
      section={selected}
      sectionIndex={selectedIndex}
      onSectionPatch={(patch) => selected && patchSection(selected.id, patch)}
      upload={uploadForSection}
      uploadFile={uploadOne}
      uploading={uploading}
      settings={settings}
      onSettingsChange={patchSettings}
      rooms={myRooms}
      selectedRooms={selectedRooms}
      onToggleRoom={(rid) => {
        touch();
        setSelectedRooms((prev) =>
          prev.includes(rid) ? prev.filter((r) => r !== rid) : [...prev, rid],
        );
      }}
      slug={hotel.slug}
      onApplyLook={(t: PageTemplate) => {
        touch();
        setSections((prev) => applyLook(prev, t));
        setSettings((prev) => ({ ...prev, accentColor: t.accentColor }));
        toast.success(`${t.label} look applied`);
      }}
      onLogoFile={onLogoFile}
      onLogoRemove={onLogoRemove}
      logoUploading={logoUploading}
      onQueueDelete={(urls) => setPendingDeletes((prev) => [...prev, ...urls])}
      /* Membership writes go straight to the database, so this panel is
         deliberately outside the draft/save cycle the rest of the inspector
         lives in — inviting someone is not something you "save later". */
      team={<HotelTeamCard hotelId={hotel.id} ownerId={hotel.ownerId} />}
      pages={<HotelPagesCard hotelId={hotel.id} slug={hotel.slug} />}
    />
  );

  return (
    <div className="min-h-screen bg-muted/30 pb-24 md:pb-0">
      <Header />

      {/* Builder toolbar */}
      <div className="sticky top-16 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="container max-w-[1600px] py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Link
              to="/manage/hotels"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> All hotel pages
            </Link>
            <p className="font-heading font-bold text-sm md:text-base text-foreground truncate">
              {settings.name || "Untitled page"}
              <span className="ml-2 font-sans font-normal text-[11px] text-muted-foreground">
                <Globe className="w-3 h-3 inline mr-0.5" />/hotels/{hotel.slug}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center rounded-lg border border-border p-0.5">
              {DEVICES.map(({ value, Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-label={label}
                  aria-pressed={device === value}
                  title={label}
                  onClick={() => setDevice(value)}
                  className={cn(
                    "w-8 h-7 rounded-md flex items-center justify-center transition-colors",
                    device === value
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={`/hotels/${hotel.slug}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{settings.isPublished ? "View" : "Preview"}</span>
              </a>
            </Button>
            <Button variant="outline" size="sm" onClick={leave}>Cancel</Button>
            <Button variant="hero" size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {busy ? "Saving…" : settings.isPublished ? "Save & publish" : "Save draft"}
            </Button>
          </div>
        </div>
      </div>

      {/* Canvas — clicking the backdrop clears the selection.
          The right gutter on wide screens is the floating panel's home: without
          it a full-bleed block spans the viewport, nothing "fits right", and the
          panel is forced to dock across the bottom on every selection. */}
      {/* Split pane: canvas and rail are FLEX SIBLINGS, so the rail's width is
          reserved by the layout itself. Nothing is positioned, so the rail can
          never cover the block being edited and there is no anchor to go stale. */}
      <div className="flex items-start">
        <div
          className="flex-1 min-w-0 py-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedId(null);
              setInspectorTab("page");
            }
          }}
        >
          <DevicePreviewFrame device={device}>
            <div className="bg-background rounded-2xl overflow-hidden border border-border shadow-card">
              <EditorCanvas
                sections={sections}
                brand={brand}
                rooms={previewRooms}
                selectedId={selectedId}
                onSelect={selectBlock}
                onReorder={(next) => { touch(); setSections(next); }}
                onPatch={patchSection}
                onMove={moveSection}
                onDuplicate={duplicate}
                onDelete={removeSection}
                onInsert={insertSection}
              />
            </div>
          </DevicePreviewFrame>
        </div>

        {/* Desktop rail. Below md the same panel renders in a bottom sheet. */}
        <aside className="hidden md:block w-96 shrink-0 self-stretch border-l border-border">
          <div className="sticky top-28 h-[calc(100vh-8rem)]">
            {inspector}
          </div>
        </aside>
      </div>

      {/* Mobile: a bottom sheet, because a 384px rail on a 390px phone is the
          whole screen. Sits above BottomNav (z-50). */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-[60] h-[55vh] border-t border-border rounded-t-2xl overflow-hidden shadow-elevated">
        {inspector}
      </div>

      <BottomNav />
    </div>
  );
};

export default EditHotel;
