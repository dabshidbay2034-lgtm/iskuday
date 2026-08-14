import { createElement } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BedDouble, Building2, CalendarCheck, Facebook, ImagePlus,
  Instagram, Mail, MapPin, MessageCircle, Phone, Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GalleryCarousel } from "@/components/hotel/GalleryCarousel";
import { InlineText, type InlineTextTag } from "@/components/hotel/InlineText";
import type { PageSection } from "@/components/hotel/page-sections";
import {
  GALLERY_GRID_CLASS, alignClass, blockWidthClass, galleryLayoutOf, heroHeightClass,
  overlayClass, padClass, roomColumnsClass, toneClass,
} from "@/components/hotel/section-styles";
import type { Hotel, HotelRoomProperty, HotelSocials } from "@/hooks/use-hotels";
import { formatMoney } from "@/hooks/use-rent";

/**
 * The ONE renderer for a hotel page block.
 *
 * Both surfaces share it so they can never drift: the public page
 * (`/hotels/:slug`) renders saved blocks, and the builder renders the SAME
 * markup in its live canvas. Any markup change here must be intentional on
 * both — a "small tweak" silently restyles every published hotel page.
 */

/** "live" = the public page. "edit" = the builder canvas (nothing navigates). */
export type PageSectionMode = "live" | "edit";

/**
 * The page-wide brand/contact data a block may need.
 *
 * Deliberately NOT a `Hotel`: the public page derives this from the saved row,
 * while the builder derives it from LIVE UNSAVED state, so recolouring the
 * accent or fixing a phone number repaints the canvas with no round-trip.
 */
export type PageBrand = {
  name: string;
  tagline: string | null;
  accentColor: string;
  logoUrl: string | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  address: string | null;
  mapsUrl: string | null;
  socials: HotelSocials;
};

/** Derive the brand from a saved hotel row. */
export function brandFromHotel(h: Hotel): PageBrand {
  return {
    name: h.name,
    tagline: h.tagline,
    accentColor: h.accentColor,
    logoUrl: h.logoUrl,
    contactPhone: h.contactPhone,
    contactWhatsapp: h.contactWhatsapp,
    contactEmail: h.contactEmail,
    address: h.address,
    mapsUrl: h.mapsUrl,
    socials: h.socials,
  };
}

/** Fallback when a hero block has no image: a brand gradient in the accent. */
function HeroFallback({ color }: { color: string }) {
  return (
    <div
      className="absolute inset-0"
      style={{ background: `linear-gradient(135deg, ${color} 0%, #0f172a 140%)` }}
    />
  );
}

/**
 * A link that goes inert in the builder.
 *
 * Clicking a room card or a `tel:` link while editing would yank the owner off
 * the canvas, so in "edit" mode this collapses to a `<span>` carrying the same
 * className/style — identical pixels, no navigation.
 */
function MaybeLink({
  mode, to, href, target, rel, className, style, ariaLabel, children,
}: {
  mode: PageSectionMode;
  /** In-app route (react-router). Takes precedence over `href`. */
  to?: string;
  /** Raw href — `tel:`, `mailto:`, `https:` or a `#anchor`. */
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  children: ReactNode;
}) {
  if (mode === "edit") {
    return <span className={className} style={style} aria-label={ariaLabel}>{children}</span>;
  }
  if (to) {
    return <Link to={to} className={className} style={style} aria-label={ariaLabel}>{children}</Link>;
  }
  return (
    <a href={href} target={target} rel={rel} className={className} style={style} aria-label={ariaLabel}>
      {children}
    </a>
  );
}

/**
 * Resolve a style axis, falling back to the block's ORIGINAL literal class.
 *
 * Not `resolver(undefined)`: the style vocabulary can't express every value the
 * page already shipped (the gallery is `py-8`, rooms are `py-10`, neither of
 * which is a `Pad` step). Returning the original verbatim when the owner hasn't
 * chosen anything means every already-published page renders byte-identically,
 * and the new vocabulary only applies where someone actually picked from it.
 */
function pick<T>(value: T | undefined, resolve: (v: T) => string, original: string): string {
  return value === undefined ? original : resolve(value);
}

/**
 * Page text that becomes type-on-the-page in the builder.
 *
 * In "live" mode this renders the ORIGINAL element and children untouched —
 * `InlineText`'s read-only branch adds its own wrapping classes, which would
 * quietly restyle every published page. So the editing component is confined to
 * the canvas, and the public page keeps the markup it has always had.
 */
function EditableText({
  mode, as, className, value, placeholder, singleLine, onCommit, children,
}: {
  mode: PageSectionMode;
  as: InlineTextTag;
  className?: string;
  /** The raw stored value — what the owner edits. */
  value: string;
  placeholder?: string;
  singleLine?: boolean;
  onCommit: (next: string) => void;
  /** Live-mode children, so any display fallback stays exactly as it was. */
  children?: ReactNode;
}) {
  if (mode === "edit") {
    return (
      <InlineText
        as={as}
        className={className}
        value={value}
        placeholder={placeholder}
        singleLine={singleLine ?? true}
        editable
        onCommit={onCommit}
      />
    );
  }
  return createElement(as, { className }, children ?? value);
}

/* ── One block of the page ─────────────────────────────────────────────────── */

export function PageSectionView({
  section, brand, rooms, mode = "live", onPatch,
}: {
  section: PageSection;
  brand: PageBrand;
  rooms: HotelRoomProperty[];
  mode?: PageSectionMode;
  /** Edit mode only: type-on-the-page text edits commit through here. */
  onPatch?: (patch: Partial<PageSection>) => void;
}): JSX.Element | null {
  const accent = brand.accentColor || "#0f766e";
  const isEdit = mode === "edit";
  const patch = (p: Partial<PageSection>) => onPatch?.(p);

  switch (section.type) {
    case "hero": {
      const centered = section.align === "center";
      return (
        <section
          className={cn(
            "relative flex items-end overflow-hidden bg-slate-950",
            pick(section.heroHeight, heroHeightClass, "min-h-[380px] md:min-h-[480px]"),
          )}
        >
          {section.imageUrl ? (
            <img
              src={section.imageUrl}
              alt={section.headline || brand.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <HeroFallback color={accent} />
          )}
          <div
            className={cn(
              "absolute inset-0",
              pick(section.overlay, overlayClass, "bg-gradient-to-t from-black/80 via-black/30 to-black/10"),
            )}
          />

          <div
            className={cn(
              "relative container max-w-5xl pb-12 md:pb-16 text-white",
              pick(section.align, (a) => alignClass(a), ""),
            )}
          >
            <MaybeLink
              mode={mode}
              to="/properties?type=hotel"
              className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white mb-4 rounded-full bg-white/10 backdrop-blur-sm px-3 py-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> All hotels
            </MaybeLink>

            <div className={cn("flex items-center gap-3 mb-3", centered && "justify-center")}>
              {brand.logoUrl && (
                <img
                  src={brand.logoUrl}
                  alt={`${brand.name} logo`}
                  className="w-12 h-12 rounded-2xl object-cover border border-white/20 bg-white/10"
                />
              )}
              <Badge
                className="rounded-full text-[10px] uppercase tracking-wider font-semibold"
                style={{ backgroundColor: accent }}
              >
                Hotel
              </Badge>
            </div>

            <EditableText
              mode={mode}
              as="h1"
              className="font-heading font-bold text-3xl md:text-5xl mb-2 drop-shadow-sm"
              value={section.headline ?? ""}
              placeholder={brand.name || "Hotel name"}
              onCommit={(v) => patch({ headline: v })}
            >
              {section.headline || brand.name}
            </EditableText>

            {(isEdit || section.subtext) && (
              <EditableText
                mode={mode}
                as="p"
                className={cn(
                  // `whitespace-pre-line` so a two-line tagline typed in the
                  // builder still reads as two lines once published, instead of
                  // collapsing into one run-on sentence.
                  "text-white/85 text-base md:text-lg max-w-xl mb-6 whitespace-pre-line",
                  centered && "mx-auto",
                )}
                value={section.subtext ?? ""}
                placeholder="One welcoming line…"
                singleLine={false}
                onCommit={(v) => patch({ subtext: v })}
              />
            )}

            {(isEdit || section.ctaLabel) && (
              <MaybeLink mode={mode} href={section.ctaHref || "#contact"}>
                <Button className="text-white font-semibold shadow-lg" style={{ backgroundColor: accent }}>
                  <EditableText
                    mode={mode}
                    as="span"
                    value={section.ctaLabel ?? ""}
                    placeholder="Button label"
                    onCommit={(v) => patch({ ctaLabel: v })}
                  />
                </Button>
              </MaybeLink>
            )}
          </div>
        </section>
      );
    }

    // An empty block collapses to nothing on the public page. In the builder it
    // must stay visible and selectable, or a freshly added block would vanish
    // the instant it appeared and there'd be no way to fill it in.
    case "text":
      if (!isEdit && !section.heading && !section.body) return null;
      return (
        <section
          className={cn(
            "container",
            pick(section.width, (w) => blockWidthClass(w), "max-w-3xl"),
            pick(section.pad, (p) => padClass(p), "py-10 md:py-14"),
            pick(section.align, (a) => alignClass(a), "text-center"),
            pick(section.tone, toneClass, ""),
          )}
        >
          {(isEdit || section.heading) && (
            <EditableText
              mode={mode}
              as="h2"
              className="font-heading font-bold text-xl md:text-2xl text-foreground mb-3"
              value={section.heading ?? ""}
              placeholder="Heading"
              onCommit={(v) => patch({ heading: v })}
            />
          )}
          {(isEdit || section.body) && (
            <EditableText
              mode={mode}
              as="p"
              className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line"
              value={section.body ?? ""}
              placeholder="Tell guests what makes this hotel special…"
              singleLine={false}
              onCommit={(v) => patch({ body: v })}
            />
          )}
        </section>
      );

    case "gallery": {
      const images = section.images ?? [];
      if (!isEdit && images.length === 0) return null;
      return (
        <section
          className={cn(
            "container",
            pick(section.width, (w) => blockWidthClass(w), "max-w-5xl"),
            pick(section.pad, (p) => padClass(p), "py-8"),
          )}
        >
          {(isEdit || section.title) && (
            <EditableText
              mode={mode}
              as="h2"
              className="font-heading font-bold text-xl md:text-2xl text-foreground mb-4"
              value={section.title ?? ""}
              placeholder="Gallery"
              onCommit={(v) => patch({ title: v })}
            />
          )}
          {images.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-12 text-center">
              <ImagePlus className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No photos yet — add some from the panel.
              </p>
            </div>
          ) : galleryLayoutOf(section.layout) === "grid" ? (
            <div className={GALLERY_GRID_CLASS}>
              {images.map((url, i) => (
                <img
                  key={`${url}-${i}`}
                  src={url}
                  alt={`${brand.name} photo ${i + 1}`}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover rounded-2xl border border-border"
                />
              ))}
            </div>
          ) : (
            <GalleryCarousel
              images={images}
              altPrefix={`${brand.name} photo`}
              accent={accent}
              autoPlay={mode === "live"}
            />
          )}
        </section>
      );
    }

    case "rooms":
      return (
        <section
          id="rooms"
          className={cn(
            "container scroll-mt-20",
            pick(section.width, (w) => blockWidthClass(w), "max-w-5xl"),
            pick(section.pad, (p) => padClass(p), "py-10"),
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <EditableText
              mode={mode}
              as="h2"
              className="font-heading font-bold text-xl md:text-2xl text-foreground"
              value={section.title ?? ""}
              placeholder="Rooms & rates"
              onCommit={(v) => patch({ title: v })}
            >
              {section.title || "Rooms & rates"}
            </EditableText>
            <EditableText
              mode={mode}
              as="span"
              className="text-xs text-muted-foreground hidden sm:block"
              value={section.subtitle ?? ""}
              placeholder="Subtitle"
              onCommit={(v) => patch({ subtitle: v })}
            />
          </div>

          {rooms.length === 0 ? (
            <div className="text-center py-12 rounded-2xl bg-card border border-dashed border-border">
              <BedDouble className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">
                Rooms for this hotel are being prepared. Check back soon.
              </p>
            </div>
          ) : (
            <div className={pick(section.columns, roomColumnsClass, "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4")}>
              {rooms.map((room) => {
                const cover = room.images[0];
                return (
                  <MaybeLink
                    key={room.id}
                    mode={mode}
                    to={`/property/${room.id}`}
                    className="group overflow-hidden rounded-2xl bg-card border border-border shadow-card hover:shadow-elevated transition-shadow"
                  >
                    <div className="relative aspect-[4/3] overflow-hidden">
                      {cover ? (
                        <img
                          src={cover}
                          alt={room.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${accent}44, transparent)` }}
                        >
                          <BedDouble className="w-10 h-10 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="font-medium text-foreground text-sm truncate">{room.title}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{room.location}</p>
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-foreground font-heading font-bold">
                          <span style={{ color: accent }}>{formatMoney(room.price)}</span>
                          <span className="text-xs font-normal text-muted-foreground">/night</span>
                        </p>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: accent }}>
                          Check availability <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  </MaybeLink>
                );
              })}
            </div>
          )}
        </section>
      );

    case "menu": {
      const items = section.items ?? [];
      return (
        <section
          className={cn(
            "container scroll-mt-20",
            pick(section.width, (w) => blockWidthClass(w), "max-w-5xl"),
            pick(section.pad, (p) => padClass(p), "py-10"),
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <EditableText
              mode={mode}
              as="h2"
              className="font-heading font-bold text-xl md:text-2xl text-foreground"
              value={section.title ?? ""}
              placeholder="Menu"
              onCommit={(v) => patch({ title: v })}
            >
              {section.title || "Menu"}
            </EditableText>
            <EditableText
              mode={mode}
              as="span"
              className="text-xs text-muted-foreground hidden sm:block"
              value={section.subtitle ?? ""}
              placeholder="Subtitle"
              onCommit={(v) => patch({ subtitle: v })}
            />
          </div>

          {items.length === 0 ? (
            <div className="text-center py-12 rounded-2xl bg-card border border-dashed border-border">
              <ImagePlus className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">
                No menu items yet — add some from the panel.
              </p>
            </div>
          ) : (
            <div className={pick(section.columns, roomColumnsClass, "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4")}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-2xl bg-card border border-border shadow-card hover:shadow-elevated transition-shadow"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        loading="lazy"
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, ${accent}44, transparent)` }}
                      >
                        <ImagePlus className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                    {item.category && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{item.category}</p>
                    )}
                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-2">{item.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-foreground font-heading font-bold">
                        <span style={{ color: accent }}>{formatMoney(item.price)}</span>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      );
    }

    case "cta":
      if (!isEdit && !section.heading && !section.buttonLabel) return null;
      return (
        <section className="my-2">
          <div
            className={cn(
              "container rounded-3xl px-6 text-white",
              pick(section.width, (w) => blockWidthClass(w), "max-w-5xl"),
              pick(section.pad, (p) => padClass(p), "py-12 md:py-16"),
              pick(section.align, (a) => alignClass(a), "text-center"),
            )}
            style={{ background: `linear-gradient(135deg, ${accent}, #0f172a 160%)` }}
          >
            {(isEdit || section.heading) && (
              <EditableText
                mode={mode}
                as="h2"
                className="font-heading font-bold text-2xl md:text-3xl mb-6 max-w-2xl mx-auto"
                value={section.heading ?? ""}
                placeholder="Book your stay today"
                onCommit={(v) => patch({ heading: v })}
              />
            )}
            {(isEdit || section.buttonLabel) && (
              <MaybeLink mode={mode} href={section.buttonHref || "#contact"}>
                <Button className="bg-white text-slate-900 hover:bg-white/90 font-semibold">
                  <EditableText
                    mode={mode}
                    as="span"
                    value={section.buttonLabel ?? ""}
                    placeholder="Button label"
                    onCommit={(v) => patch({ buttonLabel: v })}
                  />
                </Button>
              </MaybeLink>
            )}
          </div>
        </section>
      );

    case "contact":
      return (
        <ContactBlock
          brand={brand}
          accent={accent}
          heading={section.heading}
          mode={mode}
          onHeadingCommit={(v) => patch({ heading: v })}
          innerClassName={cn(
            pick(section.width, (w) => blockWidthClass(w), "max-w-5xl"),
            pick(section.pad, (p) => padClass(p), "py-12"),
            pick(section.align, (a) => alignClass(a), ""),
          )}
        />
      );
  }
}

/* ── Contact block + footer ────────────────────────────────────────────────── */

function ContactBlock({
  brand, accent, heading, mode, onHeadingCommit, innerClassName,
}: {
  brand: PageBrand;
  accent: string;
  heading?: string;
  mode: PageSectionMode;
  onHeadingCommit?: (next: string) => void;
  /** Width / spacing / alignment variants, resolved by the caller. */
  innerClassName?: string;
}) {
  return (
    <section id="contact" className="bg-card border-t border-border scroll-mt-20">
      <div className={cn("container grid grid-cols-1 md:grid-cols-2 gap-8", innerClassName)}>
        <div>
          <EditableText
            mode={mode}
            as="h2"
            className="font-heading font-bold text-xl md:text-2xl text-foreground mb-2"
            value={heading ?? ""}
            placeholder="Get in touch"
            onCommit={(v) => onHeadingCommit?.(v)}
          >
            {heading || "Get in touch"}
          </EditableText>
          <p className="text-sm text-muted-foreground mb-5">
            Questions, group bookings or special requests — reach {brand.name} directly.
          </p>
          <div className="space-y-3">
            {brand.contactPhone && (
              <MaybeLink
                mode={mode}
                href={`tel:${brand.contactPhone}`}
                className="flex items-center gap-3 text-sm text-foreground hover:text-primary"
              >
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                  <Phone className="w-4 h-4" />
                </span>
                {brand.contactPhone}
              </MaybeLink>
            )}
            {brand.contactWhatsapp && (
              <MaybeLink
                mode={mode}
                href={`https://wa.me/${brand.contactWhatsapp.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-sm text-foreground hover:text-primary"
              >
                <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-[#25D366]/15 text-[#1da851]">
                  <MessageCircle className="w-4 h-4" />
                </span>
                WhatsApp {brand.contactWhatsapp}
              </MaybeLink>
            )}
            {brand.contactEmail && (
              <MaybeLink
                mode={mode}
                href={`mailto:${brand.contactEmail}`}
                className="flex items-center gap-3 text-sm text-foreground hover:text-primary"
              >
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                  <Mail className="w-4 h-4" />
                </span>
                {brand.contactEmail}
              </MaybeLink>
            )}
            {brand.address && (
              <p className="flex items-center gap-3 text-sm text-foreground">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                  <MapPin className="w-4 h-4" />
                </span>
                {brand.address}
              </p>
            )}
            {brand.mapsUrl && (
              <MaybeLink
                mode={mode}
                href={brand.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: accent }}
              >
                <MapPin className="w-3.5 h-3.5" /> Open in maps
              </MaybeLink>
            )}
          </div>
        </div>

        <div>
          <h3 className="font-heading font-semibold text-foreground mb-4">Follow us</h3>
          <div className="flex flex-wrap gap-3">
            {brand.socials?.facebook && (
              <MaybeLink
                mode={mode}
                href={brand.socials.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                ariaLabel="Facebook"
              >
                <Facebook className="w-5 h-5" />
              </MaybeLink>
            )}
            {brand.socials?.instagram && (
              <MaybeLink
                mode={mode}
                href={brand.socials.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                ariaLabel="Instagram"
              >
                <Instagram className="w-5 h-5" />
              </MaybeLink>
            )}
            {brand.socials?.tiktok && (
              <MaybeLink
                mode={mode}
                href={brand.socials.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                ariaLabel="TikTok"
              >
                <Sparkles className="w-5 h-5" />
              </MaybeLink>
            )}
            {brand.socials?.twitter && (
              <MaybeLink
                mode={mode}
                href={brand.socials.twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="w-11 h-11 rounded-2xl border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                ariaLabel="Twitter / X"
              >
                <Building2 className="w-5 h-5" />
              </MaybeLink>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-background p-4 flex items-start gap-3">
            <CalendarCheck className="w-5 h-5 shrink-0 text-success mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Rooms on this page are bookable through{" "}
              <span className="text-foreground font-medium">Mogadishu Rents</span> — request a stay
              and the hotel confirms it from their desk.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="container max-w-5xl py-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>
            © {new Date().getFullYear()} {brand.name} · {brand.tagline || "Welcome"}
          </p>
          <MaybeLink mode={mode} href="/" className="hover:text-foreground transition-colors">
            Powered by Mogadishu Rents
          </MaybeLink>
        </div>
      </div>
    </section>
  );
}
