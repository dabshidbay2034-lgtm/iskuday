import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { AgencyHeader } from "@/components/agency/AgencyHeader";
import { AgencyProperties } from "@/components/agency/AgencyProperties";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { Property, PropertyType } from "@/lib/types";

interface RawPropertyRecord {
  id: string;
  title: string;
  description: string;
  type: string;
  price: number;
  deposit: number;
  location: string;
  owner_id?: string;
  org_id?: string;
  created_at: string;
  is_available?: boolean;
  is_listed?: boolean;
  occupancy_status?: string;
  is_daily_rate?: boolean;
  bedrooms?: number;
  living_rooms?: number;
  kitchens?: number;
  toilets?: number;
  has_cctv?: boolean;
  has_parking?: boolean;
  floor_number?: number;
  has_balcony?: boolean;
  is_furnished?: boolean;
  property_images?: Array<{ image_url: string; sort_order?: number }>;
}

/**
 * `:orgId` is raw URL input that gets interpolated into PostgREST `.or()` filter
 * strings below, where a comma, parenthesis or dot is grammar rather than data —
 * so a crafted id could rewrite the filter it lands in. Clerk org ids and UUIDs
 * are both covered by this character set; anything else is not a real id and is
 * rejected before it reaches a query.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const AgencyProfile = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  const safeOrgId = orgId && SAFE_ID.test(orgId) ? orgId : null;

  // Fetch agency or owner profile info
  const { data: profile } = useQuery({
    queryKey: ["agency-profile", safeOrgId],
    enabled: Boolean(safeOrgId),
    queryFn: async () => {
      if (!safeOrgId) return null;
      // This route serves both an agency (`org_…`, matching profiles.org_id) and
      // a solo owner (their user id, matching profiles.user_id), so both columns
      // have to be searched — matching only user_id left every agency falling
      // back to the generic "Real Estate Agency" placeholder.
      //
      // Not `.maybeSingle()`: an org has one profile row per member, and
      // maybeSingle throws on multiple rows instead of returning one.
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .or(`user_id.eq.${safeOrgId},org_id.eq.${safeOrgId}`)
        .limit(1);

      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  // Fetch properties belonging to this agency/orgId
  const { data: rawProperties, isLoading } = useQuery({
    queryKey: ["agency-properties", safeOrgId],
    enabled: Boolean(safeOrgId),
    queryFn: async () => {
      if (!safeOrgId) return [];

      const query = supabase
        .from("properties")
        .select("*, property_images(image_url, sort_order)")
        .or(`org_id.eq.${safeOrgId},owner_id.eq.${safeOrgId}`);

      const { data, error } = await query;
      if (error) throw error;
      return (data as unknown as RawPropertyRecord[]) || [];
    },
  });

  // Map and filter properties per requirement: is_listed = true AND occupancy_status = 'vacant'
  const properties: Property[] = (rawProperties || [])
    .filter((p) => {
      // If columns are not populated, default is_listed to true and occupancy_status to vacant
      const isListed = p.is_listed !== false;
      const isVacant = p.occupancy_status ? p.occupancy_status === "vacant" : p.is_available !== false;
      return isListed && isVacant;
    })
    .map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      type: (p.type === "villa" ? "house" : p.type) as PropertyType,
      price: p.price,
      deposit: p.deposit,
      location: p.location,
      images: (p.property_images || [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((img) => img.image_url),
      owner_id: p.owner_id || "",
      org_id: p.org_id,
      created_at: p.created_at,
      is_available: p.is_available ?? true,
      is_daily_rate: p.is_daily_rate,
      bedrooms: p.bedrooms,
      living_rooms: p.living_rooms,
      kitchens: p.kitchens,
      toilets: p.toilets,
      has_cctv: p.has_cctv,
      has_parking: p.has_parking,
      floor_number: p.floor_number,
      has_balcony: p.has_balcony,
      is_furnished: p.is_furnished,
    }));

  const agencyName = profile?.full_name || (properties[0]?.title ? `${properties[0].location} Agency` : "Real Estate Agency");
  const avatarUrl = profile?.avatar_url || null;

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <Header />

      <main className="container max-w-6xl py-8 space-y-8">
        {/* Back navigation */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="rounded-full gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Marketplace
        </Button>

        {/* Agency Profile Header */}
        <AgencyHeader
          title={agencyName}
          avatarUrl={avatarUrl}
          propertyCount={properties.length}
          location={properties[0]?.location || "Mogadishu"}
        />

        {/* Agency Properties List */}
        <AgencyProperties properties={properties} isLoading={isLoading} />
      </main>

      <BottomNav />
    </div>
  );
};

export default AgencyProfile;
