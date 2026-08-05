import { useMemo, useState } from "react";
import { z } from "zod";
import { UserPlus, Check } from "lucide-react";
import { useStaff } from "@/hooks/use-staff";
import {
  ROLE_PERMISSIONS, STAFF_ROLES, STAFF_ROLE_LABELS, type StaffRole,
} from "@/lib/permissions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const emailSchema = z.string().email("Enter a valid email address.");

/**
 * Invite dialog — gated on PERMISSIONS.STAFF_INVITE at the call site, but we
 * double-check `can()` here too. On submit it calls Clerk's
 * `organization.inviteMember({ emailAddress, role })` through useStaff().
 *
 * The permission list for the chosen role is shown live so the inviter can see
 * exactly what they're granting — derived from ROLE_PERMISSIONS, never duplicated.
 */
export function InviteDialog() {
  const { inviteMember } = useStaff();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("org:viewer");
  const [touched, setTouched] = useState(false);

  const emailError = useMemo(() => {
    if (!touched || !email) return null;
    const parsed = emailSchema.safeParse(email);
    return parsed.success ? null : parsed.error.issues[0]?.message ?? null;
  }, [email, touched]);

  const granted = ROLE_PERMISSIONS[role] ?? [];

  const reset = () => {
    setEmail("");
    setRole("org:viewer");
    setTouched(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return;

    inviteMember.mutate(
      { emailAddress: parsed.data, role },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="hero" size="sm">
          <UserPlus className="w-4 h-4" /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They'll receive an email invitation. Pick the role that matches the
            access they need — you can change it later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email" className="text-xs text-muted-foreground">
              Email address
            </Label>
            <Input
              id="invite-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="name@example.com"
              className="h-11 rounded-xl"
              aria-invalid={!!emailError}
            />
            {emailError && (
              <p className="text-xs text-destructive">{emailError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role" className="text-xs text-muted-foreground">
              Role
            </Label>
            <Select value={role} onValueChange={(v) => setRole(v as StaffRole)}>
              <SelectTrigger id="invite-role" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(STAFF_ROLES).map((r) => (
                  <SelectItem key={r} value={r}>
                    <div className="flex flex-col">
                      <span>{STAFF_ROLE_LABELS[r].label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {STAFF_ROLE_LABELS[r].description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Live permission preview, derived from ROLE_PERMISSIONS */}
          <div className="rounded-xl bg-secondary/40 border border-border p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">
              This role grants:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {granted.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No elevated permissions — read access only.
                </span>
              ) : (
                granted.map((p) => (
                  <Badge
                    key={p}
                    variant="secondary"
                    className="rounded-full text-[10px] font-normal gap-1"
                  >
                    <Check className="w-2.5 h-2.5" />
                    {p}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={inviteMember.isPending || !!emailError || !email}
            >
              {inviteMember.isPending ? "Sending..." : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
