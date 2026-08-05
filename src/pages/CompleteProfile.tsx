import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, User } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import type { UserRole } from "@/lib/types";
import { setPlatformRole } from "@/lib/user-role";

const CompleteProfile = () => {
  const navigate = useNavigate();
  const { user, isLoaded } = useUser();
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isLoaded && !user) {
      navigate("/signin");
      return;
    }

    if (isLoaded && user) {
      // Phone numbers live in profile_contacts, never in profiles — that table
      // is world-readable. A user can always read their own contacts row.
      supabase
        .from("profile_contacts")
        .select("phone")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.phone) {
            navigate("/");
          }
        });
    }
  }, [isLoaded, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast.error("Phone number is required");
      return;
    }
    if (!user) return;
    setSaving(true);

    // NOTE: the profiles row and the default user_roles row are created by the
    // clerk-webhook edge function on user.created (plan §2 R-7) — it runs with
    // the service-role key, so it can't be defeated by RLS or by the tab being
    // closed. This page only records what the user actually chose here.

    // 1. Phone goes to profile_contacts. It must NEVER be written to profiles:
    //    profiles is world-readable ("Profiles viewable by everyone"), while
    //    profile_contacts is readable only by its owner or a platform admin.
    const { error: contactError } = await supabase
      .from("profile_contacts")
      .upsert(
        {
          user_id: user.id,
          phone: phone.trim(),
        },
        { onConflict: "user_id" },
      );

    // 2. Ensure user_roles reflects the chosen role.
    //
    // Deliberately not an upsert: onConflict has to name a unique constraint,
    // and which one exists depends on whether 20260805000003 has run. Naming
    // the wrong one fails signup outright with "no unique or exclusion
    // constraint matching the ON CONFLICT specification". setPlatformRole()
    // reads first and is correct under both schemas — see src/lib/user-role.ts.
    const { error: roleError } = await setPlatformRole(
      user.id,
      role,
      role === "user" || role === "agent", // Auto-verify renters and agents
    );

    // NOTE: do not try to write the role into Clerk's publicMetadata here.
    // publicMetadata is read-only from the frontend — user.update() rejects it
    // with 422 "public_metadata is not a valid parameter for this request", and
    // it is only writable through the Backend API. It is also unnecessary:
    // public.user_roles is the single source of truth for the platform role,
    // which is what useAppAuth and the has_role() RLS helper both read.

    setSaving(false);
    const failure = contactError || roleError;
    if (failure) {
      console.error("Failed to save profile", { contactError, roleError });
      toast.error(`Failed to save profile: ${failure.message}`);
    } else {
      toast.success("Profile completed!");
      navigate("/");
    }
  };

  if (!isLoaded || !user) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mx-auto mb-4">
            <User className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground mb-1">
            Complete Your Profile
          </h1>
          <p className="text-muted-foreground text-sm">
            Please add your details to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="role" className="text-xs font-medium text-muted-foreground">
              I want to use Mogadishu Rents as a:
            </Label>
            <Select value={role} onValueChange={(val: UserRole) => setRole(val)}>
              <SelectTrigger className="h-12 rounded-xl">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Renter</SelectItem>
                <SelectItem value="owner">Property Owner</SelectItem>
                <SelectItem value="agent">Real Estate Agent</SelectItem>
                <SelectItem value="hotel_manager">Hotel Manager</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="text-xs font-medium text-muted-foreground">
              Phone Number *
            </Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="phone"
                type="tel"
                placeholder="+252 XX XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-10 h-12 rounded-xl"
                required
              />
            </div>
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={saving}>
            {saving ? "Saving..." : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default CompleteProfile;
