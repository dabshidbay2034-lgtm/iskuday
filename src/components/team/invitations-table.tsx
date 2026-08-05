import { Mail, X } from "lucide-react";
import type { useStaff } from "@/hooks/use-staff";

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "./role-badge";

type Staff = ReturnType<typeof useStaff>;

function formatDate(d?: Date): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Pending invitations. Revoke calls Clerk's revokeInvitation; no role change is
 * offered for pending invites because the role is set at invite time.
 */
export function InvitationsTable({ staff }: { staff: Staff }) {
  const { invitations, revokeInvitation } = staff;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-foreground">Pending invitations</h2>
        <span className="text-xs text-muted-foreground">{invitations.length} pending</span>
      </div>

      {invitations.length === 0 ? (
        <div className="text-center py-10 bg-card rounded-xl border border-border">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No pending invitations.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Sent</TableHead>
                <TableHead className="text-right w-20">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium text-sm text-foreground">{inv.email}</TableCell>
                  <TableCell><RoleBadge role={inv.role} /></TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {formatDate(inv.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive h-8"
                      disabled={revokeInvitation.isPending}
                      onClick={() => revokeInvitation.mutate(inv.id)}
                    >
                      <X className="w-4 h-4 md:mr-1.5" />
                      <span className="hidden md:inline">Revoke</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
