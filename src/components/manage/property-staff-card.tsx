import { useState } from "react";
import { UserRound, UserPlus, X } from "lucide-react";

import { PERMISSIONS } from "@/lib/permissions";
import { useAppAuth } from "@/hooks/use-auth";
import { useStaff } from "@/hooks/use-staff";
import { usePropertyAccess, type ManagedProperty } from "@/hooks/use-rent";
import {
  usePropertyStaff,
  useAddPropertyStaff,
  useRemovePropertyStaff,
} from "@/hooks/use-property-staff";

import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Who manages THIS unit. Assigning someone here is what lets them open the
 * unit's profile even when they aren't the owner and belong to no agency —
 * exactly the "a staff member logs in to this property's profile" flow.
 *
 * Assignment is org admin/manager or the unit owner only (RLS enforces it too).
 */
export function PropertyStaffCard({ property }: { property: ManagedProperty }) {
  const { can } = useAppAuth();
  const { isSoloOwner } = usePropertyAccess(property);
  const { members, isLoaded: staffLoaded, hasOrg } = useStaff();
  const { data, isPending } = usePropertyStaff(property);
  const addStaff = useAddPropertyStaff(property);
  const removeStaff = useRemovePropertyStaff(property);

  const assignments = data ?? [];
  // Assigning is the org admin/manager's job, or the solo owner's on their own
  // unit (RLS enforces the same two branches).
  const canAssign = isSoloOwner || can(PERMISSIONS.STAFF_MANAGE);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [role, setRole] = useState("");

  const assignedIds = new Set(assignments.map((a) => a.userId));

  const availableMembers = members.filter((m) => !assignedIds.has(m.userId));

  const nameOf = (userId: string): string => {
    if (userId === "you") return "You";
    const match = members.find((m) => m.userId === userId);
    return match?.fullName ?? match?.identifier ?? userId;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = hasOrg ? selectedUserId : manualUserId.trim();
    if (!target) return;
    addStaff.mutate(
      { userId: target, role: role || undefined },
      {
        onSuccess: () => {
          setSelectedUserId("");
          setManualUserId("");
          setRole("");
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
              Property staff
            </CardTitle>
            <CardDescription className="text-xs">
              The caretaker / supervisor for this unit. They can open this
              property's profile and manage it even without an agency account.
            </CardDescription>
          </div>
          {assignments.length > 0 && (
            <Badge variant="outline" className="rounded-full text-[10px] shrink-0">
              {assignments.length} assigned
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isPending || !staffLoaded ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="text-center py-6 rounded-xl border border-dashed border-border">
            <UserRound className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No staff assigned</p>
            <p className="text-xs text-muted-foreground">
              Add a member below to give them access to this unit.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li
                key={a.userId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {nameOf(a.userId)}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {a.userId}
                    {a.role ? ` · ${a.role}` : ""}
                  </p>
                </div>
                {canAssign && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => removeStaff.mutate(a.userId)}
                    aria-label={`Unassign ${nameOf(a.userId)}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canAssign && (
          <form onSubmit={submit} className="space-y-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Assign a staff member to this unit.
            </p>

            {hasOrg ? (
              <div className="space-y-2">
                <Label htmlFor="pick-staff" className="text-xs text-muted-foreground">
                  Team member
                </Label>
                <Select
                  value={selectedUserId}
                  onValueChange={setSelectedUserId}
                >
                  <SelectTrigger id="pick-staff" className="h-11 rounded-xl">
                    <SelectValue placeholder="Choose from your team" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMembers.length === 0 && (
                      <SelectItem value="__none__" disabled>
                        Everyone is already assigned
                      </SelectItem>
                    )}
                    {availableMembers.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="manual-user" className="text-xs text-muted-foreground">
                  Staff user id (Clerk id, e.g. user_2abc…)
                </Label>
                <Input
                  id="manual-user"
                  value={manualUserId}
                  onChange={(e) => setManualUserId(e.target.value)}
                  placeholder="user_2abc123..."
                  className="h-11 rounded-xl"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="staff-role" className="text-xs text-muted-foreground">
                Role label <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Caretaker, Supervisor…"
                maxLength={60}
                className="h-11 rounded-xl"
              />
            </div>

            <Button
              type="submit"
              variant="hero"
              size="sm"
              disabled={
                addStaff.isPending ||
                (hasOrg ? !selectedUserId : !manualUserId.trim())
              }
            >
              <UserPlus className="w-4 h-4" />
              {addStaff.isPending ? "Assigning..." : "Assign"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}