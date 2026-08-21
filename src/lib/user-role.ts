import { supabase } from '@/integrations/supabase/client';
import type { UserRole } from '@/lib/types';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Choose this account's type.
 *
 * ── WHY THIS IS AN RPC AND NOT A WRITE ──────────────────────────────────────
 * It used to read `user_roles` and then INSERT or UPDATE the row from the
 * browser, which worked because the table's RLS let a signed-in user write
 * their own row.
 *
 * To be accurate about the severity — an earlier version of this comment was
 * not: that write was NOT an escalation path to 'admin'. 20260812000001 already
 * pinned the role column to the four business values in both USING and WITH
 * CHECK. What it did leave open was `is_verified`, which that migration
 * deliberately did not constrain and which this module used to pass as `true`,
 * and free movement between business roles, which is how one account could farm
 * a second free trial.
 *
 * 20260908000001 removed the policies entirely, so no client write path to a
 * privilege table remains. The rules now live in `set_my_role()`:
 *
 *   - only the three business roles, never 'admin' or 'semi_admin'
 *   - only from renter, or from having no role yet
 *   - refused once any subscription exists, trialing or otherwise
 *
 * The last two are what the product asks for: you pick once, and taking the
 * trial is the commitment. Enforced in the database because a rule enforced in
 * a component is a rule that holds until somebody opens devtools.
 *
 * `is_verified` is gone from this signature on purpose. It used to be passed
 * as `true` from the settings page, which made the verified badge something a
 * user awarded themselves. It is granted by an admin now, and by nothing else.
 */
export async function setPlatformRole(
  role: UserRole,
): Promise<{ error: PostgrestError | null }> {
  const { error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: PostgrestError | null }>;
  }).rpc('set_my_role', { _role: role });

  return { error };
}

/**
 * Turn the database's refusal into something a person can act on.
 *
 * `set_my_role` raises with `check_violation` and a sentence already written
 * for the reader, so the message is passed through when it is one of ours. The
 * generic fallbacks are for the cases where Postgres speaks first — a lost
 * connection, a policy denial from somewhere else.
 */
export function describeRoleError(error: PostgrestError | null): string | null {
  if (!error) return null;
  const message = error.message ?? '';

  // Ours: already set up, plan already started, bad role value.
  if (/already set up|already started|Choose one of/i.test(message)) return message;

  if (/permission denied|row-level security|42501/i.test(message)) {
    return 'You are not signed in, or your session expired. Sign in and try again.';
  }
  return 'Could not change your account type. Try again in a moment.';
}
