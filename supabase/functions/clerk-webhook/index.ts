// Clerk → Supabase webhook.
// Verifies the Svix signature, then mirrors Clerk users + organization
// memberships into public.profiles, public.user_roles and
// public.staff_permissions using the service-role key (which bypasses RLS).
// Follows the style of supabase/functions/increment-view/index.ts.
//
// THIS FUNCTION IS AUTHORITATIVE FOR REGISTRATION (plan §2 R-7).
// `user.created` provisions BOTH the public.profiles row AND the default
// public.user_roles row ('user'). The browser must not be relied on to do it:
// a client-side insert depends on RLS being exactly right, races the Clerk
// session, and fails silently if the tab is closed. CompleteProfile.tsx should
// only ever UPDATE what the user chose (their role, their contact details) —
// the rows it used to create already exist by the time it renders.
//
// Required env (set under Edge Function secrets):
//   CLERK_WEBHOOK_SECRET     — Svix signing secret from Clerk dashboard
//   SUPABASE_URL             — project URL
//   SUPABASE_SERVICE_ROLE_KEY— service role key (server only, never shipped to client)
//
// Configure the webhook in Clerk (Users + Organizations → Webhooks) for events:
//   user.created, user.updated, user.deleted,
//   organizationMembership.created, organizationMembership.updated,
//   organizationMembership.deleted

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/svix@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── 1. Verify the Svix signature BEFORE trusting anything in the payload ──
  const WEBHOOK_SECRET = Deno.env.get("CLERK_WEBHOOK_SECRET");
  if (!WEBHOOK_SECRET) {
    return json({ error: "Webhook secret not configured." }, 500);
  }

  const payload = await req.json();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: {
    type: string;
    data: {
      object: string;
      id: string;
      // user fields
      email_addresses?: { id: string; email_address: string }[];
      primary_email_address_id?: string;
      first_name?: string | null;
      last_name?: string | null;
      image_url?: string;
      // present on user.* when the account already belongs to an org
      organization_memberships?: { organization?: { id?: string } }[];
      // membership fields
      role?: string;
      public_user_data?: { user_id: string };
      organization?: string | { id?: string };
    };
  };

  try {
    evt = wh.verify(JSON.stringify(payload), headers) as typeof evt;
  } catch (err) {
    // Signature mismatch / replay — reject hard.
    return json({ error: `Invalid signature: ${String(err)}` }, 400);
  }

  // ── 2. Service-role client (bypasses RLS) ─────────────────────────────────
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const data = evt.data;
  const SUPPORTED_ORG_ROLES = new Set([
    "org:admin",
    "org:manager",
    "org:agent",
    "org:viewer",
  ]);

  // Clerk sends `organization` as a bare id string on some payload versions and
  // as an object on others. Accept both so the membership handlers keep working
  // either way.
  const resolveOrgId = (org: string | { id?: string } | undefined) =>
    typeof org === "string" ? org : org?.id ?? null;

  try {
    switch (evt.type) {
      // ── USER EVENTS ────────────────────────────────────────────────────────
      case "user.created":
      case "user.updated": {
        const userId = data.id;
        if (!userId) break;

        // Resolve the primary email (Clerk ships an array; pick the active one).
        const emails = data.email_addresses ?? [];
        const primary = emails.find((e) => e.id === data.primary_email_address_id);
        const email = primary?.email_address ?? emails[0]?.email_address ?? null;

        const fullName = [data.first_name, data.last_name]
          .filter(Boolean)
          .join(" ");

        // Clerk's active organization for this user, when the payload carries
        // one. Absent on a plain signup — organizationMembership.* keeps
        // profiles.org_id fresh from then on.
        const orgId =
          data.organization_memberships?.[0]?.organization?.id ??
          resolveOrgId(data.organization);

        // 1. profiles — public-safe fields only. Phone numbers deliberately do
        //    NOT live here (see 20260805000001_pms_foundation.sql); they belong
        //    to public.profile_contacts, which the user writes themselves.
        const profileRow: Record<string, unknown> = {
          user_id: userId,
          full_name: fullName || email || "User",
          avatar_url: data.image_url ?? null,
          updated_at: new Date().toISOString(),
        };
        // Only touch org_id when Clerk actually told us one, so a plain
        // user.updated can't wipe an org set by a membership event.
        if (orgId) profileRow.org_id = orgId;

        const { error: profileError } = await adminClient
          .from("profiles")
          .upsert(profileRow, { onConflict: "user_id" });
        if (profileError) throw profileError;

        // 2. user_roles — every account starts as 'user'. user_roles.user_id is
        //    UNIQUE (migration 20260805000003), one role per user, so onConflict
        //    "user_id" makes this idempotent and non-destructive: a user who has
        //    since chosen 'owner' / 'agent' / 'admin' in CompleteProfile (which
        //    also targets "user_id") keeps that upgraded role — ignoreDuplicates
        //    stops the webhook's default from clobbering it on every user.updated.
        //
        //    Bootstrap exception: list Clerk user ids in the BOOTSTRAP_ADMIN_IDS
        //    edge-function secret (comma-separated) to make them admins on first
        //    signup. This is the supported way to create the FIRST admin without
        //    touching the database — set the secret, sign up, done. Without it
        //    the only path to the first admin is supabase/bootstrap_admin.sql,
        //    because the Admin panel is itself behind the admin RLS policy.
        const bootstrapAdminIds = (Deno.env.get("BOOTSTRAP_ADMIN_IDS") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const isBootstrapAdmin = bootstrapAdminIds.includes(userId);
        const defaultRole = isBootstrapAdmin ? "admin" : "user";

        const { error: roleError } = await adminClient
          .from("user_roles")
          .upsert(
            { user_id: userId, role: defaultRole, is_verified: true },
            { onConflict: "user_id", ignoreDuplicates: true },
          );
        if (roleError) throw roleError;

        break;
      }

      case "user.deleted": {
        const userId = data.id;
        if (!userId) break;
        // profiles.user_id is unique; nothing here is FK-backed to profiles, so
        // every mirror table is cleaned explicitly. profile_contacts holds the
        // user's phone numbers — deleting it with the account is the point.
        await adminClient
          .from("staff_permissions")
          .delete()
          .eq("user_id", userId);
        await adminClient
          .from("profile_contacts")
          .delete()
          .eq("user_id", userId);
        await adminClient
          .from("user_roles")
          .delete()
          .eq("user_id", userId);
        const { error } = await adminClient
          .from("profiles")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
        break;
      }

      // ── ORGANIZATION MEMBERSHIP EVENTS ───────────────────────────────────
      case "organizationMembership.created":
      case "organizationMembership.updated": {
        const orgId = resolveOrgId(data.organization);
        const userId = data.public_user_data?.user_id;
        const role = data.role;
        if (!orgId || !userId || !role) break;

        if (!SUPPORTED_ORG_ROLES.has(role)) {
          // Unknown custom role — log & ignore rather than 500, so a stray
          // Clerk dashboard role can't wedge the whole webhook.
          console.warn(`Unsupported org role "${role}" ignored for ${userId}.`);
          break;
        }

        const { error } = await adminClient
          .from("staff_permissions")
          .upsert(
            {
              org_id: orgId,
              user_id: userId,
              role,
              // permissions[] is intentionally left to the app/migration that
              // mirrors ROLE_PERMISSIONS; the DB only needs to know the role.
            },
            { onConflict: "org_id,user_id" },
          );
        if (error) throw error;

        // Keep profiles.org_id (the denormalized "primary agency" the RLS
        // policies and dashboards read) in step with the membership.
        const { error: orgSyncError } = await adminClient
          .from("profiles")
          .update({ org_id: orgId, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (orgSyncError) throw orgSyncError;
        break;
      }

      case "organizationMembership.deleted": {
        const orgId = resolveOrgId(data.organization);
        const userId = data.public_user_data?.user_id;
        if (!orgId || !userId) break;
        const { error } = await adminClient
          .from("staff_permissions")
          .delete()
          .eq("org_id", orgId)
          .eq("user_id", userId);
        if (error) throw error;

        // Clear the denormalized org only if it still points at the org the
        // user just left.
        const { error: orgClearError } = await adminClient
          .from("profiles")
          .update({ org_id: null, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("org_id", orgId);
        if (orgClearError) throw orgClearError;
        break;
      }

      default:
        // Acknowledge unsupported events so Clerk doesn't retry.
        return json({ ok: true, ignored: evt.type });
    }

    return json({ ok: true });
  } catch (err) {
    console.error("clerk-webhook error:", err);
    return json({ error: String(err) }, 500);
  }
});
