import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError } from "@/hooks/use-rent";
import { looseFrom } from "@/lib/supabase-loose";
import {
  defaultPageSections, deriveScalars, sectionsFor, type PageSection,
} from "@/components/hotel/page-sections";

/**
 * Hotel web-page data layer (migration 20260808000001).
 *
 * A hotel page is ONE row in `hotels` — a customizable public landing page
 * (hero, gallery, about, contact) with a stable `/hotels/:slug` URL — plus a
 * `hotel_rooms` join that decides which of the owner's nightly-rate rooms are
 * displayed on it. Rooms never move; the page just curates them.
 *
 * Both tables are added by 20260808000001 and aren't in the generated types
 * until `supabase gen types` runs, so reads/writes go through a loose accessor.
 * Asset uploads use the public `hotel-assets` storage bucket and return a
 * public URL straight away (hero / logo / gallery images).
 */

// ── Domain types ─────────────────────────────────────────────────────────────

export interface HotelSocials {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  twitter?: string;
}

export type Hotel = {
  id: string;
  ownerId: string;
  orgId: string | null;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  heroImageUrl: string | null;
  logoUrl: string | null;
  gallery: string[];
  accentColor: string;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  address: string | null;
  /**
   * The one district this hotel is in. Chosen once in page settings; every
   * room inherits it instead of being asked again. NULL until the owner picks
   * one — the add-room flow blocks on that rather than guessing.
   */
  district: string | null;
  mapsUrl: string | null;
  socials: HotelSocials;
  /**
   * How this hotel lets a guest pay: any of pay_now / deposit / at_hotel.
   * Empty or unrecognised falls back to at_hotel in `offeredOptions`, which
   * is how every listing worked before online payment existed.
   */
  paymentOptions: string[];
  /** Share taken up front when `deposit` is offered. Product default 25. */
  depositPercent: number;
  /** Typography / corner / colour-scheme preset. See src/lib/hotel-theme.ts. */
  fontPairing: string;
  cornerStyle: string;
  themeMode: string;
  /** The ordered blocks the public page renders (hero → … → contact). */
  sections: PageSection[];
  isPublished: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/** The bits of a plotted property the page actually renders. */
export type HotelRoomProperty = {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  isDailyRate: boolean | null;
  type: string | null;
  images: string[];
};

/** A room curated onto a hotel page, with the embedded property row. */
export type HotelRoomLink = {
  hotelId: string;
  propertyId: string;
  sortOrder: number;
  property: HotelRoomProperty | null;
};

type RawHotel = {
  id: string;
  owner_id: string;
  org_id: string | null;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  hero_image_url: string | null;
  logo_url: string | null;
  gallery: string[] | null;
  accent_color: string | null;
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  address: string | null;
  district: string | null;
  maps_url: string | null;
  socials: Record<string, string> | null;
  /** Optional: absent on a database without 20260905000001 applied. */
  payment_options?: string[] | null;
  deposit_percent?: number | null;
  /** Optional: absent without 20260906000001. */
  font_pairing?: string | null;
  corner_style?: string | null;
  theme_mode?: string | null;
  sections?: unknown;
  is_published: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

function toHotel(row: RawHotel): Hotel {
  return {
    id: row.id,
    ownerId: row.owner_id,
    orgId: row.org_id ?? null,
    slug: row.slug,
    name: row.name ?? "My hotel",
    tagline: row.tagline ?? null,
    description: row.description ?? null,
    heroImageUrl: row.hero_image_url ?? null,
    logoUrl: row.logo_url ?? null,
    gallery: row.gallery ?? [],
    accentColor: row.accent_color ?? "#0f766e",
    sections: sectionsFor({
      name: row.name ?? "My hotel",
      tagline: row.tagline,
      heroImageUrl: row.hero_image_url,
      description: row.description,
      gallery: row.gallery ?? [],
      sections: row.sections,
    }),
    contactPhone: row.contact_phone ?? null,
    contactWhatsapp: row.contact_whatsapp ?? null,
    contactEmail: row.contact_email ?? null,
    address: row.address ?? null,
    district: row.district ?? null,
    mapsUrl: row.maps_url ?? null,
    socials: row.socials ?? {},
    // Defaults, not assumptions: a database without 20260905000001 applied
    // returns neither column, and a hotel must still load and render.
    paymentOptions: row.payment_options ?? ["at_hotel"],
    depositPercent: Number(row.deposit_percent ?? 25),
    // `hotelTheme()` coerces anything unrecognised back to the default, so
    // these can be handed straight through without validating here.
    fontPairing: row.font_pairing ?? "modern",
    cornerStyle: row.corner_style ?? "soft",
    themeMode: row.theme_mode ?? "auto",
    isPublished: row.is_published ?? false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * True when the write was rejected only because `hotels.district` isn't there
 * yet.
 *
 * ── TWO CODES, NOT ONE ─────────────────────────────────────────────────────
 * The obvious check is Postgres 42703 (undefined_column), and that is wrong on
 * its own. A write through supabase-js never reaches Postgres: PostgREST
 * validates the payload against its own cached schema first and rejects it as
 * PGRST204 — "Could not find the 'district' column of 'hotels' in the schema
 * cache". 42703 is what a raw `select` of the column returns. Both mean the
 * same thing here, and matching only the first one silently does nothing,
 * which is how this was caught: the save still failed.
 *
 * Note PostgREST caches the schema, so even after the migration runs the cache
 * may need a moment (or `NOTIFY pgrst, 'reload schema'`) before writes take
 * the column.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The district column arrives in 20260818000001_hotel_district.sql. The client
 * ships independently of the database, so between deploying this code and
 * applying that migration the payload names a column that does not exist —
 * and PostgREST rejects the ENTIRE statement, not just the unknown field. The
 * effect would be that saving a hotel page, which works today, stops working
 * until someone runs the migration.
 *
 * Breaking a working feature to add a new one is not an acceptable trade, so
 * the write retries once without the field. The district silently doesn't
 * persist until the migration lands, which is the correct degradation: the
 * feature is unavailable, rather than the page being unsaveable.
 *
 * DELETE THIS once 20260818000001 is applied everywhere — it is scaffolding,
 * not architecture, and it would mask a genuine schema drift if left forever.
 */
function isMissingDistrictColumn(error: unknown): boolean {
  return isMissingColumn(error, /district/i);
}

/**
 * The payment columns arrive with 20260905000001. Same scaffolding, same
 * reason, same instruction: delete it once that migration is applied
 * everywhere. A hotel must stay editable on a database that is one
 * migration behind, or a half-rolled-out deploy locks every owner out of
 * their own page.
 */
function isMissingPaymentColumn(error: unknown): boolean {
  return isMissingColumn(error, /payment_options|deposit_percent/i);
}

/** The theme columns arrive with 20260906000001. Same scaffolding, same rule. */
function isMissingThemeColumn(error: unknown): boolean {
  return isMissingColumn(error, /font_pairing|corner_style|theme_mode/i);
}

function isMissingColumn(error: unknown, column: RegExp): boolean {
  const e = error as { code?: string; message?: string } | null;
  const code = e?.code ?? "";
  return (code === "42703" || code === "PGRST204") && column.test(e?.message ?? "");
}

// ── Slugs ────────────────────────────────────────────────────────────────────

/** "Hilton Beach Resort" → "hilton-beach-resort". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "hotel"
  );
}

/** Pick a slug that isn't already in the table (`-2`, `-3`, … on collision). */
async function pickUniqueSlug(base: string, excludeHotelId?: string): Promise<string> {
  let candidate = base;
  let attempts = 0;
  while (true) {
    attempts += 1;
    if (attempts > 50) throw new Error("Couldn't generate a unique slug.");
    const { data, error } = await looseFrom("hotels")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (error) throw error;
    if (!data || (excludeHotelId && data.id === excludeHotelId)) {
      return candidate;
    }
    candidate = `${base}-${attempts + 1}`;
  }
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const myHotelsKey = () => ["hotels", "mine"] as const;
export const hotelKey = (id?: string) => ["hotels", "id", id] as const;
export const hotelSlugKey = (slug?: string) => ["hotels", "slug", slug] as const;
export const hotelRoomsKey = (hotelId?: string) => ["hotels", "rooms", hotelId] as const;

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * The hotel pages the current user MANAGES (their own + their agency's).
 * Draft pages are invisible to outsiders, so a plain `select` also returns
 * published pages we don't manage — those are filtered out here.
 */
export function useMyHotels() {
  const { isSignedIn, userId, orgId } = useAppAuth();
  return useQuery({
    queryKey: myHotelsKey(),
    enabled: Boolean(isSignedIn),
    queryFn: async (): Promise<Hotel[]> => {
      const { data, error } = await looseFrom("hotels")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((data as RawHotel[]) ?? [])
        .map(toHotel)
        .filter((h) => h.ownerId === userId || (orgId != null && h.orgId === orgId));
    },
  });
}

/** One hotel page by slug. Published → readable by everyone; drafts by managers. */
export function usePublicHotelPage(slug?: string) {
  return useQuery({
    queryKey: hotelSlugKey(slug),
    enabled: Boolean(slug),
    queryFn: async (): Promise<Hotel | null> => {
      const { data, error } = await looseFrom("hotels")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data ? toHotel(data as RawHotel) : null;
    },
  });
}

/** One hotel page by id (the editor's load). */
export function useHotel(id?: string) {
  return useQuery({
    queryKey: hotelKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<Hotel | null> => {
      const { data, error } = await looseFrom("hotels")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toHotel(data as RawHotel) : null;
    },
  });
}

/**
 * Rooms curated onto a hotel page, plus their embedded property rows. Used by
 * both the editor (to show what's featured) and the public page (to render the
 * rooms section with nightly rates and a link through to each bookable room).
 */
export function useHotelRooms(hotelId?: string) {
  return useQuery({
    queryKey: hotelRoomsKey(hotelId),
    enabled: Boolean(hotelId),
    queryFn: async (): Promise<HotelRoomLink[]> => {
      const { data, error } = await looseFrom("hotel_rooms")
        .select("*, properties(id, title, price, location, is_daily_rate, type, property_images(image_url, sort_order))")
        .eq("hotel_id", hotelId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as RawRoomLink[]).map(toRoomLink);
    },
  });
}

type RawRoomLink = {
  hotel_id: string;
  property_id: string;
  sort_order: number | null;
  properties: {
    id: string;
    title: string;
    price: number | null;
    location: string | null;
    is_daily_rate: boolean | null;
    type: string | null;
    property_images: Array<{ image_url: string; sort_order: number | null }> | null;
  } | null;
};

function toRoomLink(row: RawRoomLink): HotelRoomLink {
  const images = (row.properties?.property_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((img) => img.image_url);
  return {
    hotelId: row.hotel_id,
    propertyId: row.property_id,
    sortOrder: Number(row.sort_order ?? 0),
    property: row.properties
      ? {
          id: row.properties.id,
          title: row.properties.title,
          price: Number(row.properties.price) || null,
          location: row.properties.location ?? null,
          isDailyRate: row.properties.is_daily_rate ?? null,
          type: row.properties.type,
          images,
        }
      : null,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type HotelFormInput = {
  name: string;
  tagline?: string;
  description?: string;
  heroImageUrl?: string;
  logoUrl?: string;
  gallery?: string[];
  accentColor?: string;
  contactPhone?: string;
  contactWhatsapp?: string;
  contactEmail?: string;
  address?: string;
  /** One of MOGADISHU_DISTRICTS. "" clears it back to unset. */
  district?: string;
  mapsUrl?: string;
  socials?: HotelSocials;
  paymentOptions?: string[];
  depositPercent?: number;
  fontPairing?: string;
  cornerStyle?: string;
  themeMode?: string;
  /** The ordered page blocks. When set, the scalar fields below are mirrored from it. */
  sections?: PageSection[];
  isPublished?: boolean;
};

/** Build the scalar payload from the block list (hero/tagline, text, gallery). */
function scalarsFromSections(sections: PageSection[] | undefined, fallbackName: string) {
  const s = deriveScalars(sections ?? [], { name: fallbackName });
  return {
    hero_image_url: s.heroImageUrl,
    tagline: s.tagline || null,
    description: s.description || null,
    gallery: s.gallery,
  };
}

/** Create a new hotel page (generating a unique slug from the name). */
export function useCreateHotel() {
  const queryClient = useQueryClient();
  const { userId, orgId } = useAppAuth();

  return useMutation({
    mutationFn: async (input: HotelFormInput): Promise<Hotel> => {
      if (!userId) throw new Error("You must be signed in.");
      const slug = await pickUniqueSlug(slugify(input.name));
      const name = input.name.trim();
      const sections =
        input.sections ??
        defaultPageSections({
          name,
          tagline: input.tagline,
          heroImageUrl: input.heroImageUrl,
          description: input.description,
          gallery: input.gallery,
        });
      const scalars = scalarsFromSections(sections, name);

      const payload = {
          owner_id: userId,
          org_id: orgId ?? null,
          slug,
          name,
          hero_image_url: scalars.hero_image_url,
          tagline: scalars.tagline,
          description: scalars.description,
          gallery: scalars.gallery,
          logo_url: input.logoUrl || null,
          accent_color: input.accentColor || "#0f766e",
          contact_phone: input.contactPhone?.trim() || null,
          contact_whatsapp: input.contactWhatsapp?.trim() || null,
          contact_email: input.contactEmail?.trim() || null,
          address: input.address?.trim() || null,
          district: input.district?.trim() || null,
          maps_url: input.mapsUrl?.trim() || null,
          socials: input.socials ?? {},
          payment_options: input.paymentOptions ?? ["at_hotel"],
          deposit_percent: input.depositPercent ?? 25,
          font_pairing: input.fontPairing ?? "modern",
          corner_style: input.cornerStyle ?? "soft",
          theme_mode: input.themeMode ?? "auto",
          sections,
          is_published: input.isPublished ?? false,
      };

      let { data, error } = await looseFrom("hotels").insert(payload).select("*").single();
      if (error && isMissingThemeColumn(error)) {
        const { font_pairing: _fp, corner_style: _cs, theme_mode: _tm, ...withoutTheme } = payload;
        ({ data, error } = await looseFrom("hotels").insert(withoutTheme).select("*").single());
      }
      if (error && isMissingPaymentColumn(error)) {
        const { payment_options: _po, deposit_percent: _dp, ...withoutPayment } = payload;
        ({ data, error } = await looseFrom("hotels").insert(withoutPayment).select("*").single());
      }
      if (error && isMissingDistrictColumn(error)) {
        const { district: _unused, ...withoutDistrict } = payload;
        ({ data, error } = await looseFrom("hotels").insert(withoutDistrict).select("*").single());
      }
      if (error) throw error;
      return toHotel(data as RawHotel);
    },
    onSuccess: (hotel) => {
      toast.success(`"${hotel.name}" created`);
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't create the hotel page")),
  });
}

/** Update an existing page (slug stays stable once chosen). */
export function useUpdateHotel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; input: HotelFormInput }): Promise<Hotel> => {
      const { id, input } = args;
      const name = input.name.trim();
      const sections = input.sections ?? [];
      const scalars = scalarsFromSections(sections, name);

      const payload = {
          name,
          hero_image_url: scalars.hero_image_url,
          tagline: scalars.tagline,
          description: scalars.description,
          gallery: scalars.gallery,
          logo_url: input.logoUrl || null,
          accent_color: input.accentColor || "#0f766e",
          contact_phone: input.contactPhone?.trim() || null,
          contact_whatsapp: input.contactWhatsapp?.trim() || null,
          contact_email: input.contactEmail?.trim() || null,
          address: input.address?.trim() || null,
          district: input.district?.trim() || null,
          maps_url: input.mapsUrl?.trim() || null,
          socials: input.socials ?? {},
          payment_options: input.paymentOptions ?? ["at_hotel"],
          deposit_percent: input.depositPercent ?? 25,
          font_pairing: input.fontPairing ?? "modern",
          corner_style: input.cornerStyle ?? "soft",
          theme_mode: input.themeMode ?? "auto",
          sections,
          is_published: input.isPublished ?? false,
      };

      let { data, error } = await looseFrom("hotels")
        .update(payload).eq("id", id).select("*").single();
      if (error && isMissingThemeColumn(error)) {
        const { font_pairing: _fp, corner_style: _cs, theme_mode: _tm, ...withoutTheme } = payload;
        ({ data, error } = await looseFrom("hotels")
          .update(withoutTheme).eq("id", id).select("*").single());
      }
      if (error && isMissingPaymentColumn(error)) {
        const { payment_options: _po, deposit_percent: _dp, ...withoutPayment } = payload;
        ({ data, error } = await looseFrom("hotels")
          .update(withoutPayment).eq("id", id).select("*").single());
      }
      if (error && isMissingDistrictColumn(error)) {
        const { district: _unused, ...withoutDistrict } = payload;
        ({ data, error } = await looseFrom("hotels")
          .update(withoutDistrict).eq("id", id).select("*").single());
      }
      if (error) throw error;
      return toHotel(data as RawHotel);
    },
    onSuccess: (hotel) => {
      toast.success("Hotel page saved");
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
      queryClient.invalidateQueries({ queryKey: hotelKey(hotel.id) });
      queryClient.invalidateQueries({ queryKey: hotelSlugKey(hotel.slug) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't save the hotel page")),
  });
}

export function useDeleteHotel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (hotel: Hotel) => {
      const { error } = await looseFrom("hotels").delete().eq("id", hotel.id);
      if (error) throw error;
      // Best-effort: also drop the page's own images from storage.
      for (const url of [
        hotel.heroImageUrl, hotel.logoUrl, ...hotel.gallery,
      ]) {
        if (url) await removeHotelAsset(url);
      }
      return hotel;
    },
    onSuccess: (hotel) => {
      toast.success(`"${hotel.name}" deleted`);
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't delete the hotel page")),
  });
}

/**
 * Replace the room selection on a page in one go: remove the existing links,
 * then insert the new set (RLS lets the page's managers do both).
 */
export function useSetHotelRooms(hotelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (propertyIds: string[]) => {
      if (!hotelId) throw new Error("No hotel selected.");
      const { error: delError } = await looseFrom("hotel_rooms")
        .delete()
        .eq("hotel_id", hotelId);
      if (delError) throw delError;

      if (propertyIds.length > 0) {
        const rows = propertyIds.map((propertyId, i) => ({
          hotel_id: hotelId,
          property_id: propertyId,
          sort_order: i,
        }));
        const { error } = await looseFrom("hotel_rooms").insert(rows);
        if (error) throw error;
      }
      return propertyIds;
    },
    onSuccess: () => {
      toast.success("Featured rooms updated");
      queryClient.invalidateQueries({ queryKey: hotelRoomsKey(hotelId) });
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't update the featured rooms")),
  });
}

/**
 * Attach ONE room to a hotel page, keeping the rooms already there.
 *
 * `useSetHotelRooms` above is the builder's curation control: it replaces the
 * whole list, which is right when the owner has just ticked checkboxes against
 * the full set. It is exactly wrong for the add-room wizard, which knows about
 * one new room and nothing about the others — calling it there would delete
 * every previously featured room.
 *
 * Appends at the end (`max(sort_order) + 1`) so the builder's manual ordering
 * survives, and ignores a duplicate rather than failing: attaching a room that
 * is already attached is a no-op, not an error.
 */
export function useAttachHotelRoom() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { hotelId: string; propertyId: string }) => {
      const { hotelId, propertyId } = args;

      const { data: last, error: readError } = await looseFrom("hotel_rooms")
        .select("sort_order")
        .eq("hotel_id", hotelId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;

      const { error } = await looseFrom("hotel_rooms").upsert(
        {
          hotel_id: hotelId,
          property_id: propertyId,
          sort_order: Number(last?.sort_order ?? -1) + 1,
        },
        { onConflict: "hotel_id,property_id", ignoreDuplicates: true },
      );
      if (error) throw error;
      return { hotelId, propertyId };
    },
    onSuccess: ({ hotelId }) => {
      queryClient.invalidateQueries({ queryKey: hotelRoomsKey(hotelId) });
      queryClient.invalidateQueries({ queryKey: myHotelsKey() });
    },
    // Deliberately quiet on failure: the caller creates the room first, and a
    // room that exists but isn't featured yet is a far smaller problem than a
    // scary toast implying the room wasn't saved. The caller says so instead.
  });
}

// ── Asset uploads (public `hotel-assets` bucket) ─────────────────────────────

/**
 * Upload an image and return its PUBLIC url (the bucket is public-read, so
 * published pages and draft previews both load it without auth).
 */
export async function uploadHotelAsset(file: File, userId: string): Promise<string> {
  const safeName = file.name.replace(/[^\w.\- ]/g, "_");
  const objectPath = `${userId}/hotel-pages/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from("hotel-assets")
    .upload(objectPath, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return supabase.storage.from("hotel-assets").getPublicUrl(objectPath).data.publicUrl;
}

/** Delete an asset by its public URL (no-op for non-bucket urls). */
export async function removeHotelAsset(url: string): Promise<void> {
  if (!url.includes("/hotel-assets/")) return;
  const marker = "/hotel-assets/";
  const idx = url.indexOf(marker);
  const path = idx >= 0 ? url.slice(idx + marker.length) : url;
  await supabase.storage.from("hotel-assets").remove([path]);
}