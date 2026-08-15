import { useEffect, useRef, useState } from "react";
import { Lock, Loader2, Check, Eye } from "lucide-react";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { usePropertyAccess, type ManagedProperty } from "@/hooks/use-rent";
import { usePropertyNotes, useSavePropertyNotes } from "@/hooks/use-property-notes";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Private notes for one property — the org-only scratchpad from R5.
 *
 * The content lives in `property_private`, never on `properties`, so it cannot
 * be picked up by a public `select('*')` (plan §2 R-2). Nothing in this file
 * may be reused on a public surface.
 *
 * Writing is gated on PERMISSIONS.NOTES_MANAGE (Admin, Manager, Agent).
 * Viewers get the same content read-only rather than an empty panel — they are
 * inside the agency, they just can't type.
 *
 * Saving is debounced: staff jot notes between calls and shouldn't have to
 * remember a button. The manual "Save now" is there for anyone who wants the
 * confirmation.
 */

const AUTOSAVE_DELAY_MS = 1200;

interface PrivateNotesCardProps {
  /** The unit. Taken whole (not just an id) so rights resolve the same way
   *  every other card on /manage/property/:id resolves them. */
  property: ManagedProperty;
  className?: string;
}

export function PrivateNotesCard({ property, className }: PrivateNotesCardProps) {
  const propertyId = property.id;
  const { orgId } = useAppAuth();
  // `usePropertyAccess`, not `can()` — the org matrix alone returns false for a
  // solo landlord, who would then be locked out of the notes on their own unit.
  const { canManageNotes: canManage } = usePropertyAccess(property);

  const { data, isPending, isError } = usePropertyNotes(propertyId);
  const saveNotes = useSavePropertyNotes();

  const [notes, setNotes] = useState("");
  const [internalRef, setInternalRef] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Hydrate once per property. Re-hydrating on every `data` change would fight
  // the user's cursor while they type.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (isPending) return;
    if (hydratedFor.current === propertyId) return;
    setNotes(data?.private_notes ?? "");
    setInternalRef(data?.internal_ref ?? "");
    setIsDirty(false);
    setSavedAt(null);
    hydratedFor.current = propertyId;
  }, [data, isPending, propertyId]);

  const flush = () => {
    if (!canManage || !isDirty) return;
    saveNotes.mutate(
      { propertyId, orgId, private_notes: notes, internal_ref: internalRef },
      {
        onSuccess: () => {
          setIsDirty(false);
          setSavedAt(new Date());
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Couldn't save your notes"),
      },
    );
  };

  // Debounced autosave. `flush` is intentionally not a dependency — the timer
  // should restart on keystrokes, not on every render.
  useEffect(() => {
    if (!canManage || !isDirty) return;
    const timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, internalRef, isDirty, canManage]);

  if (isPending) return <PrivateNotesCardSkeleton className={className} />;

  return (
    <Card className={className}>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
              Private notes
            </CardTitle>
            <CardDescription className="text-xs">
              Only your agency can see this. It never appears on the public listing.
            </CardDescription>
          </div>
          {canManage ? (
            <SaveStatus
              isDirty={isDirty}
              isSaving={saveNotes.isPending}
              savedAt={savedAt}
            />
          ) : (
            <Badge variant="outline" className="rounded-full text-[10px] gap-1 shrink-0">
              <Eye className="w-3 h-3" /> Read-only
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isError && (
          <p className="text-xs text-destructive">
            Couldn't load the private notes for this property.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="internal-ref" className="text-xs text-muted-foreground">
            Internal reference
          </Label>
          {canManage ? (
            <Input
              id="internal-ref"
              value={internalRef}
              onChange={(e) => {
                setInternalRef(e.target.value);
                setIsDirty(true);
              }}
              onBlur={flush}
              placeholder="e.g. BLK-C-04"
              maxLength={64}
              className="h-11 rounded-xl"
            />
          ) : (
            <ReadOnlyValue value={internalRef} empty="No reference recorded." />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="private-notes" className="text-xs text-muted-foreground">
            Notes
          </Label>
          {canManage ? (
            <Textarea
              id="private-notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setIsDirty(true);
              }}
              onBlur={flush}
              placeholder="Landlord prefers cash on the 1st. Spare keys with the caretaker…"
              className="rounded-xl min-h-[140px]"
            />
          ) : (
            <ReadOnlyValue
              value={notes}
              empty="No notes yet."
              className="min-h-[100px] whitespace-pre-wrap"
            />
          )}
        </div>

        {canManage && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Saves automatically as you type.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={flush}
              disabled={!isDirty || saveNotes.isPending}
            >
              {saveNotes.isPending ? "Saving..." : "Save now"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SaveStatus({
  isDirty,
  isSaving,
  savedAt,
}: {
  isDirty: boolean;
  isSaving: boolean;
  savedAt: Date | null;
}) {
  if (isSaving) {
    return (
      <span className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="text-[11px] text-muted-foreground shrink-0">Unsaved changes</span>
    );
  }
  if (savedAt) {
    return (
      <span className="text-[11px] text-success flex items-center gap-1 shrink-0">
        <Check className="w-3 h-3" />
        Saved {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
    );
  }
  return null;
}

function ReadOnlyValue({
  value,
  empty,
  className,
}: {
  value: string;
  empty: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm",
        value ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {value || empty}
    </div>
  );
}

export function PrivateNotesCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-[140px] w-full rounded-xl" />
        </div>
      </CardContent>
    </Card>
  );
}
