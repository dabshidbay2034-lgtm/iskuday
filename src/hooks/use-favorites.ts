import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppAuth } from "@/hooks/use-auth";
import { ANALYTICS_EVENTS, track } from "@/lib/analytics";

export const useFavorites = () => {
  const queryClient = useQueryClient();
  const { userId, isSignedIn } = useAppAuth();

  const { data: favoriteIds = [] } = useQuery({
    queryKey: ["favorites", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("favorites")
        .select("property_id")
        .eq("user_id", userId!);
      if (error) throw error;
      return data.map((f: { property_id: string }) => f.property_id);
    },
    enabled: !!userId,
  });

  const toggleFavorite = useMutation({
    mutationFn: async (propertyId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const isFav = favoriteIds.includes(propertyId);
      if (isFav) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", userId)
          .eq("property_id", propertyId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ user_id: userId, property_id: propertyId });
        if (error) throw error;
      }
      // Returned so onSuccess can report which direction the toggle went —
      // saves and un-saves mean opposite things and shouldn't share one number.
      return { propertyId, saved: !isFav };
    },
    onSuccess: ({ propertyId, saved }) => {
      track(ANALYTICS_EVENTS.FAVORITE_TOGGLED, { property_id: propertyId, saved });
      queryClient.invalidateQueries({ queryKey: ["favorites", userId] });
    },
  });

  return {
    favoriteIds,
    isFavorite: (id: string) => favoriteIds.includes(id),
    toggleFavorite: toggleFavorite.mutate,
    isAuthenticated: isSignedIn,
  };
};
