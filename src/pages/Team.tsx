import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Users } from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Seo from "@/components/Seo";
import { buildTitle, absoluteUrl } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HotelTeamCard } from "@/components/hotel/HotelTeamCard";
import { useMyHotelIds } from "@/hooks/use-hotel-invites";
import { useHotel } from "@/hooks/use-hotels";

/**
 * `/team` — the hotel's own team.
 *
 * ── WHY THIS PAGE WAS REPLACED ──────────────────────────────────────────────
 * It used to manage a CLERK ORGANIZATION: agency members, Clerk invitations,
 * and a permission matrix describing agency roles. That is a different team
 * from the one that actually does the work. The people a hotel needs to add
 * are the people who edit its pages, add rooms and press publish — and those
 * live in `hotel_members` (20260813000001), with per-task grants added by
 * 20260830000001. A hotel owner inviting their receptionist through the Clerk
 * org gave that person an agency seat and no ability to touch the hotel.
 *
 * So this route now renders the SAME team surface the page editor shows, on its
 * own page. One team, one invite flow, one set of roles — `HotelTeamCard` is
 * the single implementation and both places mount it rather than keeping two
 * that drift.
 *
 * ── WHY IT PICKS A HOTEL RATHER THAN ASSUMING ONE ───────────────────────────
 * `my_hotel_ids()` is the only thing that knows where an INVITED member can go:
 * they own no properties, so the portfolio queries find them nothing. An owner
 * with several hotels gets a switcher; everyone else lands straight on theirs.
 */
const Team = () => {
  const { data: hotelIds, isPending } = useMyHotelIds();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first hotel once the list arrives. Kept in an effect rather
  // than derived during render so an owner who switches hotels is not snapped
  // back to the first one on the next refetch.
  useEffect(() => {
    if (!selectedId && hotelIds && hotelIds.length > 0) setSelectedId(hotelIds[0]);
  }, [hotelIds, selectedId]);

  const { data: hotel } = useHotel(selectedId ?? undefined);

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      {/* Signed-in-only surface: nothing here is meant for search results. */}
      <Seo
        title={buildTitle("Team")}
        description="Invite the people who run your hotel and choose what each of them can do."
        canonical={absoluteUrl("/team")}
        noindex
      />
      <Header />

      <div className="container max-w-4xl py-8 space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-heading font-extrabold text-2xl text-foreground tracking-tight">
              Team
            </h1>
            <p className="text-sm text-muted-foreground">
              Invite the people who run your hotel and choose what each of them can do.
            </p>
          </div>
        </div>

        {isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-56 rounded-lg" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : !hotelIds || hotelIds.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Building2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <h2 className="font-heading font-bold text-foreground mb-1">No hotel yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
              A team belongs to a hotel. Create one first, then come back and invite the
              people who help you run it.
            </p>
            <Button asChild variant="hero" className="rounded-full">
              <Link to="/manage/hotels">Create a hotel</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Only shown when there is a genuine choice to make. */}
            {hotelIds.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {hotelIds.map((id) => (
                  <HotelSwitchButton
                    key={id}
                    hotelId={id}
                    active={id === selectedId}
                    onSelect={() => setSelectedId(id)}
                  />
                ))}
              </div>
            )}

            {hotel && (
              <p className="text-sm text-muted-foreground">
                Managing the team for <span className="font-medium text-foreground">{hotel.name}</span>.
              </p>
            )}

            <HotelTeamCard hotelId={selectedId ?? undefined} ownerId={hotel?.ownerId} />
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

/**
 * One hotel in the switcher.
 *
 * Its own component because each button needs its own `useHotel` query — a
 * member may be able to reach a hotel they do not own, so the name is not
 * available from any list the parent already holds.
 */
function HotelSwitchButton({
  hotelId,
  active,
  onSelect,
}: {
  hotelId: string;
  active: boolean;
  onSelect: () => void;
}) {
  const { data: hotel } = useHotel(hotelId);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground font-medium"
          : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
      }`}
    >
      {hotel?.name ?? "Hotel"}
    </button>
  );
}

export default Team;
