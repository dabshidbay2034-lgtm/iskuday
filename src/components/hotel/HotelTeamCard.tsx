import { useMemo, useState } from "react";
import { z } from "zod";
import { Copy, Loader2, Mail, MessageCircle, Shield, ShieldAlert, Trash2, UserPlus, X } from "lucide-react";

import { toast } from "sonner";
import { useAppAuth } from "@/hooks/use-auth";
import {
  canChangeHotelRole,
  canRemoveHotelMember,
  countHotelAdmins,
  hotelRoleCanManageMembers,
  useHotelMembers,
  useMyHotelRole,
  useRemoveHotelMember,
  useUpdateHotelMemberRole,
  HOTEL_ROLES,
  HOTEL_ROLE_ORDER,
  HOTEL_TASKS,
  HOTEL_TASK_LABELS,
  HOTEL_ROLE_DEFAULT_TASKS,
  hotelMemberExtraTasks,
  type HotelMember,
  type HotelRole,
  type HotelTask,
} from "@/hooks/use-hotel-members";
import {
  useHotelInvites,
  useInviteToHotel,
  useRevokeHotelInvite,
  inviteJoinUrl,
} from "@/hooks/use-hotel-invites";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const emailSchema = z.string().email("Enter a valid email address.");

/**
 * The team panel for ONE hotel — members, pending invites, and the invite form.
 *
 * This is the native, per-hotel team. It is NOT the Clerk-organization agency
 * team in components/team/*: a hotelier inviting their night manager onto one
 * property must not thereby create an agency, and the manager must gain nothing
 * beyond that one hotel. The interaction and the last-admin guards are modelled
 * on members-table.tsx; the data comes from our own hooks.
 *
 * Rendered inside the builder's 384px inspector rail and, below md, inside a
 * bottom sheet — so everything here is a stacked, narrow-first layout rather
 * than a table.
 */
export function HotelTeamCard({
  hotelId,
  ownerId,
}: {
  hotelId?: string;
  /**
   * The hotel's owner, when the caller knows it.
   *
   * The owner passes `hotel_member_admin()` in the database WITHOUT a
   * membership row, so `useMyHotelRole` reports null for them. Without this the
   * one person who most needs to invite their first manager would be shown a
   * read-only roster on their own hotel.
   */
  ownerId?: string | null;
}) {
  const { userId } = useAppAuth();

  const members = useHotelMembers(hotelId);
  const invites = useHotelInvites(hotelId);
  const myRole = useMyHotelRole(hotelId);

  const updateRole = useUpdateHotelMemberRole(hotelId);
  const removeMember = useRemoveHotelMember(hotelId);
  const invite = useInviteToHotel(hotelId);
  const revokeInvite = useRevokeHotelInvite(hotelId);

  const isOwner = Boolean(ownerId && userId && ownerId === userId);
  const canManage = isOwner || hotelRoleCanManageMembers(myRole.data);

  const [removeTarget, setRemoveTarget] = useState<HotelMember | null>(null);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<HotelRole>("agent");
    const [permissions, setPermissions] = useState<string[]>([]);
    const [touched, setTouched] = useState(false);

    const emailError = useMemo(() => {
      if (!touched || !email) return null;
      const parsed = emailSchema.safeParse(email.trim());
      return parsed.success ? null : parsed.error.issues[0]?.message ?? null;
    }, [email, touched]);

    const rows = members.data ?? [];
    const pending = invites.data ?? [];
    const adminCount = countHotelAdmins(members.data);

    const allTasks: HotelTask[] = Object.values(HOTEL_TASKS);

    /** When role changes to/from admin, reset permissions. Admin gets every task by default. */
    const handleRoleChange = (r: HotelRole) => {
      setRole(r);
      if (r === "admin") {
        setPermissions([]); // admin role implies all tasks; no explicit list needed
      }
    };

    const togglePermission = (task: string) => {
      setPermissions((prev) =>
        prev.includes(task) ? prev.filter((t) => t !== task) : [...prev, task],
      );
    };

    const submitInvite = (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);
      const parsed = emailSchema.safeParse(email.trim());
      if (!parsed.success) return;
      invite.mutate(
        { email: parsed.data, role, permissions: role === "admin" ? [] : permissions },
        {
          onSuccess: () => {
            setEmail("");
            setRole("agent");
            setPermissions([]);
            setTouched(false);
          },
        },
      );
    };

  const confirmRemove = () => {
    if (!removeTarget) return;
    removeMember.mutate(removeTarget.userId);
    setRemoveTarget(null);
  };

  if (!hotelId) return null;

  if (members.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Members ────────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {rows.length === 0
              ? "No one else has access yet."
              : `${rows.length} ${rows.length === 1 ? "person" : "people"} with access`}
          </p>
          {!canManage && (
            <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
              Read only
            </Badge>
          )}
        </div>

        <ul className="space-y-1.5">
          {rows.map((m) => {
            const isSelf = m.userId === userId;
            return (
              <li
                key={m.userId}
                className="rounded-lg border border-border bg-background p-2 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate" title={m.userId}>
                      {isSelf ? "You" : m.userId}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Joined {formatDate(m.createdAt)}
                    </p>
                  </div>

                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${isSelf ? "yourself" : m.userId}`}
                      disabled={!canRemoveHotelMember(members.data, m, userId)}
                      onClick={() => setRemoveTarget(m)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>

                {canManage ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) => updateRole.mutate({ userId: m.userId, role: v as HotelRole })}
                    disabled={updateRole.isPending}
                  >
                    <SelectTrigger className="h-8 w-full rounded-lg text-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOTEL_ROLE_ORDER.map((r) => (
                        <SelectItem
                          key={r}
                          value={r}
                          className="text-xs"
                          disabled={!canChangeHotelRole(members.data, m, r, userId)}
                        >
                          {HOTEL_ROLES[r].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                                  <Badge variant="secondary" className="rounded-full text-[10px] font-normal">
                                    {HOTEL_ROLES[m.role].label}
                                  </Badge>
                                )}
                                {/* Show explicit task grants beyond role default */}
                                {m.permissions.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {m.permissions.map((t) => (
                                      <Badge key={t} variant="outline" className="rounded-full text-[9px] px-1.5 py-0">
                                        {HOTEL_TASK_LABELS[t as HotelTask] ?? t}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
              </li>
            );
          })}
        </ul>

        {canManage && adminCount <= 1 && rows.length > 0 && (
          <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
            <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
            At least one admin is required — the last admin can't be removed or
            demoted.
          </p>
        )}
      </div>

      {/* ── Pending invitations ────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Pending
          </p>
          <ul className="space-y-1.5">
            {pending.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2"
              >
                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate" title={inv.email}>
                    {inv.email}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                                      {HOTEL_ROLES[inv.role].label} · joins when they open the link
                                    </p>
                                    {inv.permissions.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-0.5">
                                        {inv.permissions.map((t) => (
                                          <Badge key={t} variant="outline" className="rounded-full text-[9px] px-1.5 py-0">
                                            {HOTEL_TASK_LABELS[t as HotelTask] ?? t}
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                </div>
                {canManage && (
                  <>
                    {/* The link IS the invitation. Email delivery needs the
                        send-notification function deployed and Resend
                        configured; copying the link works right now, and this
                        market shares over WhatsApp anyway. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={`Copy the invitation link for ${inv.email}`}
                      title="Copy invite link"
                      disabled={!inv.token}
                      onClick={async () => {
                        const url = inviteJoinUrl(inv.token);
                        if (!url) return;
                        try {
                          await navigator.clipboard.writeText(url);
                          toast.success("Invite link copied — send it to them");
                        } catch {
                          // Clipboard needs a secure context; surface the link
                          // rather than failing silently on http:// or old Safari.
                          window.prompt("Copy this invite link:", url);
                        }
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    {/* WhatsApp is the actual delivery channel in this market.
                        Email needs the send-notification function deployed;
                        this needs nothing, works from a phone, and is what the
                        hotel would have done with the copied link anyway. The
                        message carries the role so the recipient knows what
                        they are accepting before they click a token URL. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-success"
                      aria-label={`Send ${inv.email} their invitation on WhatsApp`}
                      title="Send on WhatsApp"
                      disabled={!inv.token}
                      onClick={() => {
                        const url = inviteJoinUrl(inv.token);
                        if (!url) return;
                        const role = HOTEL_ROLES[inv.role].label.toLowerCase();
                        const text =
                          `You have been invited to help manage our hotel on Mogadishu Rents as ${role}. ` +
                          `Open this link and sign in to accept: ${url}`;
                        window.open(
                          `https://wa.me/?text=${encodeURIComponent(text)}`,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Revoke the invitation to ${inv.email}`}
                      disabled={revokeInvite.isPending}
                      onClick={() => revokeInvite.mutate(inv.id)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Invite form ────────────────────────────────────────────────────── */}
      {canManage ? (
        <form onSubmit={submitInvite} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="hotel-invite-email" className="text-[11px] text-muted-foreground">
              Invite by email
            </Label>
            <Input
              id="hotel-invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="manager@example.com"
              className="h-9 rounded-lg text-sm bg-background"
              aria-invalid={!!emailError}
            />
            {emailError && <p className="text-[11px] text-destructive">{emailError}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="hotel-invite-role" className="text-[11px] text-muted-foreground">
              Role
            </Label>
            <Select value={role} onValueChange={handleRoleChange}>
              <SelectTrigger id="hotel-invite-role" className="h-9 rounded-lg text-sm bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOTEL_ROLE_ORDER.map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="flex flex-col">
                      <span className="text-xs">{HOTEL_ROLES[r].label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {HOTEL_ROLES[r].description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
                      </div>

                      {/* Specific-task grants. Admin implies every task, so the list is
                          surfaced only for non-admin roles. Selecting a task here grants
                          that permission explicitly via hotel_members.permissions; the role
                          default set (see HOTEL_ROLE_DEFAULT_TASKS) applies on top. */}
                      {role !== "admin" && (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            Allow these specific tasks
                          </p>
                          <div className="rounded-lg border border-border bg-background p-2 space-y-1">
                            {allTasks.map((task) => (
                              <label key={task} className="flex items-center gap-2 cursor-pointer">
                                <Checkbox
                                  checked={permissions.includes(task)}
                                  onCheckedChange={() => togglePermission(task)}
                                />
                                <span className="text-[11px] text-foreground">{HOTEL_TASK_LABELS[task]}</span>
                              </label>
                            ))}
                          </div>
                          <p className="text-[9px] text-muted-foreground">
                            {role === "manager" ? "Managers already get the default operations set — add extra tasks here only if needed." : "Tick the exact tasks they're allowed to do; leave unticked everything they must not."}
                          </p>
                        </div>
                      )}

                      <Button
            type="submit"
            variant="hero"
            size="sm"
            className="w-full"
            disabled={invite.isPending || !email || !!emailError}
          >
            {invite.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserPlus className="w-3.5 h-3.5" />
            )}
            {invite.isPending ? "Inviting…" : "Send invitation"}
          </Button>

          <p className="text-[10px] text-muted-foreground">
            They join this hotel only — nothing else in your account.
          </p>
        </form>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Only a hotel admin can invite people or change roles.
        </p>
      )}

      {/* Remove confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from this hotel?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this hotel's pages and front desk immediately.
              Their account and any other hotel they belong to are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              disabled={removeMember.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMember.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default HotelTeamCard;
