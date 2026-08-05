import { AlertCircle } from "lucide-react";
import { useStaff } from "@/hooks/use-staff";
import { useAppAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/permissions";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AgencyHeader } from "@/components/team/agency-header";
import { CreateAgencyEmptyState } from "@/components/team/create-agency-empty-state";
import { MembersTable } from "@/components/team/members-table";
import { InvitationsTable } from "@/components/team/invitations-table";
import { InviteDialog } from "@/components/team/invite-dialog";
import { PermissionMatrix } from "@/components/team/permission-matrix";
import {
  MembersTableSkeleton,
  InviteCardSkeleton,
} from "@/components/team/team-skeletons";

/**
 * /team — agency (Clerk Organization) staff management.
 *
 * Layout:
 *   - agency header (org identity + counts)
 *   - empty state when the user has no active org
 *   - invite dialog (gated on STAFF_INVITE)
 *   - members table (gated on STAFF_MANAGE for row actions)
 *   - pending invitations
 *   - read-only permission matrix
 *
 * PWA/mobile-first: tables use horizontal scroll containers; the invite dialog
 * is the only fixed-width panel. Everything else stacks.
 */
const Team = () => {
  const staff = useStaff();
  const { can } = useAppAuth();
  const canInvite = can(PERMISSIONS.STAFF_INVITE);

  // Loading — show skeletons before the Clerk org resolves.
  if (!staff.isLoaded) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <div className="container max-w-4xl py-6 space-y-6">
          <InviteCardSkeleton />
          <MembersTableSkeleton />
        </div>
        <BottomNav />
      </div>
    );
  }

  // No active organization → create-agency empty state.
  if (!staff.hasOrg) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <Header />
        <div className="container max-w-4xl py-6">
          <CreateAgencyEmptyState />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <div className="container max-w-4xl py-6 space-y-6">
        <AgencyHeader staff={staff} />

        {/* Invite action lives next to the members section it affects. */}
        {canInvite && (
          <div className="flex justify-end">
            <InviteDialog />
          </div>
        )}

        <MembersTable staff={staff} />

        <InvitationsTable staff={staff} />

        <PermissionMatrix />

        {/* Soft hint when the viewer can't manage staff. */}
        {!can(PERMISSIONS.STAFF_MANAGE) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>
              You can view your agency's members and roles, but only admins and
              managers can manage staff.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Team;
