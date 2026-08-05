import { supabase } from '@/integrations/supabase/client';
import type { UserRole } from '@/lib/types';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Set a user's platform role without depending on which unique constraint
 * `public.user_roles` currently carries.
 *
 * Why this exists instead of a one-line upsert:
 *
 * The table shipped with `UNIQUE (user_id, role)` — several roles per user.
 * Migration 20260805000003 replaces that with `UNIQUE (user_id)` — one role per
 * user. Both are reasonable; the problem is that an `upsert(..., { onConflict })`
 * has to name one of them, and naming the wrong one fails hard with
 *
 *     there is no unique or exclusion constraint matching the ON CONFLICT
 *     specification
 *
 * That left two call sites disagreeing: CompleteProfile named "user_id" (valid
 * only after the migration) and ProfileSettings named "user_id,role" (valid only
 * before it). Whichever migration state the database was in, one of them was
 * broken — and since these run during signup, being broken meant a user could
 * not finish creating their account.
 *
 * Read-then-write costs one extra round trip on a page that runs once, and is
 * correct under both schemas.
 */
export async function setPlatformRole(
  userId: string,
  role: UserRole,
  isVerified: boolean,
): Promise<{ error: PostgrestError | null }> {
  const { data: existing, error: readError } = await supabase
    .from('user_roles')
    .select('id, role')
    .eq('user_id', userId);

  if (readError) return { error: readError };

  // No row yet — the Clerk webhook may not have provisioned one, or this is a
  // database that predates it.
  if (!existing || existing.length === 0) {
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role, is_verified: isVerified });
    return { error };
  }

  // Already holds the target role: only the verification flag can be stale.
  const alreadyHas = existing.find((r) => r.role === role);
  if (alreadyHas) {
    const { error } = await supabase
      .from('user_roles')
      .update({ is_verified: isVerified })
      .eq('id', alreadyHas.id);
    return { error };
  }

  // Move an existing row onto the new role, addressed by primary key so exactly
  // one row changes. Updating by user_id would rewrite every row the user has,
  // which under the composite constraint collapses two rows onto the same value
  // and fails with a 23505 duplicate key violation.
  const { error } = await supabase
    .from('user_roles')
    .update({ role, is_verified: isVerified })
    .eq('id', existing[0].id);

  return { error };
}
