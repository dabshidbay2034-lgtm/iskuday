import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Private notes for a single property.
 *
 * WHY A SEPARATE TABLE (plan §2 R-2): notes must never leak into the public
 * property feed. Keeping them as a column on `properties` means one careless
 * `select('*')` publishes an owner's internal remarks to every anonymous
 * visitor. `property_private` is org-scoped with no public SELECT policy at
 * all, which makes that leak structurally impossible.
 *
 * Rules for anyone extending this file:
 *   - NEVER join `property_private` into a public-facing query.
 *   - NEVER widen a `properties` select to pull these columns in.
 *   - Only management surfaces (`/manage`, `/manage/property/:id`) read it.
 *
 * The row shape comes straight from the generated Supabase types, so a schema
 * change surfaces here as a type error rather than as a runtime surprise.
 */

export type PropertyPrivate = Database["public"]["Tables"]["property_private"]["Row"];

export interface SavePropertyNotesInput {
  propertyId: string;
  /** Clerk organization id — only sent on the first write for a property. */
  orgId?: string | null;
  private_notes?: string | null;
  internal_ref?: string | null;
}

/** Query key factory so callers can invalidate without guessing the shape. */
export const propertyNotesKey = (propertyId?: string) =>
  ["property-notes", propertyId] as const;

/** Explicit column list — never `select('*')` here, see the note above. */
const NOTES_COLUMNS = "property_id, org_id, private_notes, internal_ref, updated_at" as const;

/** Trim to a value or null so empty strings don't linger in the database. */
function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads the private record for one property. Returns `null` (not an error) when
 * no notes have ever been written — the row is created lazily on first save.
 */
export function usePropertyNotes(propertyId?: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: propertyNotesKey(propertyId),
    enabled: Boolean(propertyId) && (options?.enabled ?? true),
    queryFn: async (): Promise<PropertyPrivate | null> => {
      const { data, error } = await supabase
        .from("property_private")
        .select(NOTES_COLUMNS)
        .eq("property_id", propertyId)
        .maybeSingle();

      if (error) throw error;
      return (data as PropertyPrivate) ?? null;
    },
  });
}

/**
 * Upserts the private record. Callers must gate this on
 * `can(PERMISSIONS.NOTES_MANAGE)`; RLS is the real enforcement, this is UX.
 *
 * The cache is updated in place rather than invalidated so an autosaving
 * textarea doesn't get its value yanked out from under the user mid-typing.
 */
export function useSavePropertyNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SavePropertyNotesInput): Promise<PropertyPrivate> => {
      const { data, error } = await supabase
        .from("property_private")
        .upsert(
          {
            property_id: input.propertyId,
            private_notes: nullIfBlank(input.private_notes),
            internal_ref: nullIfBlank(input.internal_ref),
            updated_at: new Date().toISOString(),
            // org_id is only meaningful for staff acting inside an agency;
            // personal owners leave the existing value alone and are scoped by
            // property ownership instead.
            ...(input.orgId ? { org_id: input.orgId } : {}),
          },
          { onConflict: "property_id" },
        )
        .select(NOTES_COLUMNS)
        .single();

      if (error) throw error;
      return data as PropertyPrivate;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(propertyNotesKey(saved.property_id), saved);
    },
  });
}
