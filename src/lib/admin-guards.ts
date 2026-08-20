import type { UserRole } from "@/lib/types";

/**
 * The rules that stop the platform admin panel locking its operator out.
 *
 * ── WHY THIS IS A SEPARATE FILE ─────────────────────────────────────────────
 * These two rules already existed twice in this codebase — in
 * src/components/team/members-table.tsx for Clerk org staff, and in
 * HotelTeamCard for per-hotel members — and the PLATFORM panel, which outranks
 * both, had neither. Three inline copies of a rule is how the third one ends up
 * subtly different from the other two, so this one is pure, exported and
 * tested, and Admin.tsx calls it.
 *
 * The database enforces the last-admin case independently in
 * 20260909000001_last_admin_guard.sql. That is what actually makes the
 * invariant hold — the SQL editor and any future script bypass everything here.
 * This exists so the operator sees a disabled option rather than discovering
 * the rule through a red toast.
 */

export type RoleChangeSubject = {
  /** Clerk user id of the row being edited. */
  userId: string;
  role: UserRole;
};

/**
 * Why this role change is refused, or `null` when it is allowed.
 *
 * The message is shown to the operator as-is, so it says what to do next
 * rather than merely what went wrong.
 */
export function roleChangeBlockedReason(
  subject: RoleChangeSubject,
  target: UserRole,
  context: { adminCount: number; currentUserId: string | null | undefined },
): string | null {
  // Only ever restricts taking admin AWAY. Promoting to admin is always fine —
  // and is the documented way out of both refusals below.
  if (subject.role !== "admin" || target === "admin") return null;

  // Unrecoverable, so it is refused for everyone including the operator: there
  // is no admin INSERT policy on user_roles, set_my_role() will not grant
  // 'admin', and BOOTSTRAP_ADMIN_IDS only fires on a Clerk user.created event.
  // Once the last admin is gone the only way back is the SQL editor.
  if (context.adminCount <= 1) {
    return "This is the last admin. Promote someone else first.";
  }

  // Recoverable — another admin can restore it — but never something a person
  // means to do from a list of cards where their own looks like everyone
  // else's. Deliberately NOT enforced in the database: an operator stepping
  // down is legitimate, it just should not happen by mis-click.
  if (subject.userId === context.currentUserId) {
    return "You cannot remove your own admin access here.";
  }

  return null;
}
