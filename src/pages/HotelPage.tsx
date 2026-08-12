import { Link, useParams } from "react-router-dom";
import { Hotel as HotelIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { brandFromHotel, PageSectionView } from "@/components/hotel/PageSectionView";
import {
  usePublicHotelPage, useHotelRooms, type HotelRoomProperty,
} from "@/hooks/use-hotels";

const SAFE_SLUG = /^[a-z0-9-]{1,80}$/;

/** Raw row shape for the one-off room fallback query (when the join is empty). */
type RawFallbackRoom = {
  id: string;
  title: string;
  price: number | null;
  location: string | null;
  property_images: Array<{ image_url: string; sort_order: number | null }> | null;
};

function toFallbackRoom(row: RawFallbackRoom): HotelRoomProperty {
  const images = (row.property_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((img) => img.image_url);
  return {
    id: row.id,
    title: row.title,
    price: Number(row.price) || null,
    location: row.location ?? null,
    isDailyRate: null,
    type: "hotel",
    images,
  };
}

/**
 * A hotel's PUBLIC web page — /hotels/:slug (20260808000001).
 *
 * Renders the page's ordered BLOCKS (hero / text / gallery / rooms / button /
 * contact) exactly as the owner arranged them in the builder. The gallery
 * block is a sliding carousel. Draft pages 404 for visitors.
 */
const HotelPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const safeSlug = slug && SAFE_SLUG.test(slug) ? slug : null;

  const { data: hotel, isPending } = usePublicHotelPage(safeSlug ?? undefined);
  const { data: roomLinks } = useHotelRooms(hotel?.id);

  // Room images ride along with the embedded property row; fall back to a
  // public query for any room the join didn't carry over.
  const { data: roomImages } = useQuery({
    queryKey: ["hotel-page-room-images", hotel?.id],
    enabled: Boolean(hotel?.id && (roomLinks ?? []).some((r) => !r.property)),
    queryFn: async (): Promise<HotelRoomProperty[]> => {
      const ids = (roomLinks ?? []).filter((r) => !r.property).map((r) => r.propertyId);
      const { data, error } = await supabase
        .from("properties")
        .select("id, title, price, location, property_images(image_url, sort_order)")
        .in("id", ids);
      if (error) throw error;
      return ((data ?? []) as RawFallbackRoom[]).map(toFallbackRoom);
    },
  });

  if (isPending) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <Skeleton className="w-full h-[320px] md:h-[420px]" />
        <div className="container max-w-5xl py-8 space-y-6">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <BottomNav />
      </div>
    );
  }

  // Draft or unknown slug — the public never sees un-published pages.
  if (!hotel) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <div className="container max-w-2xl py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <HotelIcon className="w-7 h-7 text-primary" />
          </div>
          <h1 className="font-heading font-bold text-2xl text-foreground mb-2">
            This hotel page isn't live yet
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            The page doesn't exist or its owner hasn't published it. Check back soon.
          </p>
          <Button variant="hero" asChild>
            <Link to="/properties?type=hotel">Browse hotels</Link>
          </Button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const rooms: HotelRoomProperty[] = (roomLinks ?? [])
    .map((link) => link.property ?? roomImages?.find((r) => r.id === link.propertyId) ?? null)
    .filter((r): r is HotelRoomProperty => r !== null);

  const hasContact = hotel.sections.some((s) => s.type === "contact");
  const brand = brandFromHotel(hotel);

  return (
    // `pb-20 md:pb-0` matches the loading and not-published branches: BottomNav
    // is fixed at z-50 on mobile, and without the clearance it sits on top of
    // the footer — the copyright and the "Powered by Mogadishu Rents" link both
    // become untappable on a phone, which is most of this audience.
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      {/* ── Blocks, in the owner's order ─────────────────────────────────── */}
      {hotel.sections.map((section) => (
        <PageSectionView
          key={section.id}
          section={section}
          brand={brand}
          rooms={rooms}
        />
      ))}

      {!hasContact && (
        <div className="border-t border-border">
          <div className="container max-w-5xl py-5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} {hotel.name} · Powered by Mogadishu Rents</p>
            <a href="/" className="hover:text-foreground transition-colors">Mogadishu Rents</a>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
};

export default HotelPage;