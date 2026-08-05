import { useState } from "react";
import { Trash2, MoreHorizontal, ShieldAlert } from "lucide-react";
import type { useStaff, StaffMember } from "@/hooks/use-staff";
import { useAppAuth } from "@/hooks/use-auth";
import { PERMISSIONS, STAFF_ROLES, STAFF_ROLE_LABELS, type StaffRole } from "@/lib/permissions";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "./role-badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Staff = ReturnType<typeof useStaff>;

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function formatDate(d?: Date): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function MembersTable({ staff }: { staff: Staff }) {
  const { can } = useAppAuth();
  const canManage = can(PERMISSIONS.STAFF_MANAGE);

  const { members, adminCount, updateMemberRole, removeMember, currentUserId } = staff;
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);

  /** Guards: never demote your own admin role, never remove the last admin. */
  const canChangeTo = (member: StaffMember, target: StaffRole): boolean => {
    if (member.role === "org:admin" && target !== "org:admin") {
      if (member.isCurrentUser) return false;
      if (adminCount <= 1) return false;
    }
    return true;
  };

  const canRemove = (member: StaffMember): boolean => {
    if (member.isCurrentUser) return false; // never let a user remove themselves here
    if (member.role === "org:admin" && adminCount <= 1) return false;
    return true;
  };

  const onRoleChange = (member: StaffMember, role: StaffRole) => {
    if (!canChangeTo(member, role)) return;
    updateMemberRole.mutate({ userId: member.userId, role });
  };

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeMember.mutate(removeTarget.userId);
    setRemoveTarget(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground">Members</h2>
        <span className="text-xs text-muted-foreground">{members.length} total</span>
      </div>

      {members.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <p className="text-muted-foreground text-sm">No members yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
                {canManage && <TableHead className="text-right w-12">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.userId === currentUserId;
                return (
                  <TableRow key={m.id}>
                    {/* Member identity */}
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-[180px]">
                        <Avatar className="w-9 h-9">
                          {m.imageUrl ? <AvatarImage src={m.imageUrl} /> : null}
                          <AvatarFallback>{initials(m.fullName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-foreground truncate flex items-center gap-1.5">
                            {m.fullName}
                            {isSelf && (
                              <span className="text-[10px] text-muted-foreground">(you)</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">{m.identifier}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role — inline Select when manager, else a badge */}
                    <TableCell>
                      {canManage ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => onRoleChange(m, v as StaffRole)}
                          disabled={updateMemberRole.isPending}
                        >
                          <SelectTrigger className="h-8 w-[130px] rounded-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.values(STAFF_ROLES).map((r) => (
                              <SelectItem
                                key={r}
                                value={r}
                                disabled={!canChangeTo(m, r)}
                              >
                                {STAFF_ROLE_LABELS[r].label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </TableCell>

                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {formatDate(m.createdAt)}
                    </TableCell>

                    {canManage && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={!canRemove(m) && !isSelf}
                              aria-label="Member actions"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={!canRemove(m)}
                              onClick={() => setRemoveTarget(m)}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {adminCount <= 1 && canManage && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5" />
          At least one admin is required — the last admin can't be removed or demoted.
        </p>
      )}

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.fullName} will lose access to{" "}
              {staff.organization?.name ?? "this agency"} and all shared properties.
              They keep their individual Clerk account. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              disabled={removeMember.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMember.isPending ? "Removing..." : "Remove member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
