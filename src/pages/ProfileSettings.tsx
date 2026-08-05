import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { setPlatformRole } from "@/lib/user-role";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Camera, Save, User, Home, Hotel, ShieldCheck, ArrowUpCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useAppAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/lib/types";

const roleInfo: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  user: { label: "Renter", icon: User, color: "bg-secondary text-foreground" },
  owner: { label: "Property Owner", icon: Home, color: "bg-success/10 text-success" },
  hotel_manager: { label: "Hotel Manager", icon: Hotel, color: "bg-accent/10 text-accent" },
  agent: { label: "Real Estate Agent", icon: ShieldCheck, color: "bg-primary/10 text-primary" },
};

const upgradeOptions: { value: UserRole; label: string; desc: string }[] = [
  { value: "owner", label: "Property Owner", desc: "List and rent out your properties" },
  { value: "hotel_manager", label: "Hotel Manager", desc: "Manage hotel room listings" },
];

const ProfileSettings = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isSignedIn, userId, user } = useAppAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole>("user");
  const [upgradingRole, setUpgradingRole] = useState(false);

  useEffect(() => {
    if (!isSignedIn) {
      navigate("/signin");
    }
  }, [isSignedIn, navigate]);

  useEffect(() => {
    if (!userId) return;
    const fetchData = async () => {
      setLoading(true);
      // Phone lives in profile_contacts, not profiles — profiles is
      // world-readable, profile_contacts is owner-or-platform-admin only.
      const [profileRes, roleRes, contactRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        // Read all role rows, not .maybeSingle(): user_id is UNIQUE now, but a
        // leftover pre-migration duplicate makes maybeSingle() throw (PostgREST
        // 406) and silently leave the role at "user". Same defensive read as
        // useAppAuth. Pick the most privileged to match the hook's precedence.
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profile_contacts").select("phone").eq("user_id", userId).maybeSingle(),
      ]);
      if (profileRes.data) {
        setFullName(profileRes.data.full_name || "");
        setAvatarUrl(profileRes.data.avatar_url);
      }
      setPhone(contactRes.data?.phone || "");
      if (roleRes.data && roleRes.data.length > 0) {
        const precedence: UserRole[] = ['admin', 'semi_admin', 'owner', 'hotel_manager', 'agent', 'user'];
        const resolved = precedence.find((r) =>
          roleRes.data!.some((row) => (row.role as UserRole) === r),
        ) ?? (roleRes.data[0].role as UserRole);
        setCurrentRole(resolved);
      }
      setLoading(false);
    };
    fetchData();
  }, [userId]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Image must be under 2MB"); return; }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const filePath = `${userId}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage.from("property-images").upload(filePath, file, { upsert: true });
    if (uploadError) { toast.error("Failed to upload avatar"); setUploading(false); return; }

    const { data: { publicUrl } } = supabase.storage.from("property-images").getPublicUrl(filePath);
    const url = `${publicUrl}?t=${Date.now()}`;
    const { error: updateError } = await supabase.from("profiles").update({ avatar_url: url }).eq("user_id", userId);
    if (updateError) { toast.error("Failed to update avatar"); } else { setAvatarUrl(url); toast.success("Avatar updated!"); }
    setUploading(false);
  };

  const handleSave = async () => {
    if (!userId) return;
    if (!fullName.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    // Two writes: the public-safe name on profiles, the phone on the private
    // profile_contacts row. Writing phone to profiles would silently do nothing
    // now that the column is gone — and would have leaked it if it still were.
    const [{ error: profileError }, { error: contactError }] = await Promise.all([
      supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("user_id", userId),
      supabase
        .from("profile_contacts")
        .upsert({ user_id: userId, phone: phone.trim() || null }, { onConflict: "user_id" }),
    ]);
    const error = profileError || contactError;
    if (error) { toast.error("Failed to save profile: " + error.message); } else { toast.success("Profile updated!"); }
    setSaving(false);
  };

  const handleUpgradeRole = async (newRole: UserRole) => {
    if (!userId) return;
    setUpgradingRole(true);

    // Same helper CompleteProfile uses. It addresses the row by primary key,
    // so it never rewrites every row for a user (which collapsed two rows onto
    // one value and failed with 23505), and it names no unique constraint, so
    // it survives 20260805000003 flipping user_roles from UNIQUE(user_id, role)
    // to UNIQUE(user_id).
    const { error } = await setPlatformRole(userId, newRole, true);

    if (error) {
      console.error("Failed to upgrade role", error);
      toast.error(`Failed to upgrade role: ${error.message}`);
    } else {
      setCurrentRole(newRole);
      // useAppAuth caches the role lookup for 5 minutes; without this the rest
      // of the app keeps gating on the old role until a reload.
      queryClient.invalidateQueries({ queryKey: ["user-role", userId] });
      toast.success(`You're now a ${roleInfo[newRole].label}! You can list properties.`);
    }
    setUpgradingRole(false);
  };

  const initials = fullName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const role = roleInfo[currentRole] || roleInfo.user;
  const canUpgrade = currentRole === "user";

  return (
    <div className="min-h-screen bg-background pb-24">
      <Header />
      <main className="container max-w-lg mx-auto px-4 pt-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="mb-4 -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Button>

          <h1 className="text-2xl font-bold text-foreground mb-6">Profile Settings</h1>

          {loading ? (
            <div className="space-y-6">
              <div className="flex justify-center"><Skeleton className="w-24 h-24 rounded-full" /></div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Avatar */}
              <Card className="border-border">
                <CardContent className="pt-6 flex flex-col items-center gap-4">
                  <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <Avatar className="w-24 h-24 ring-4 ring-primary/20">
                      {avatarUrl ? <AvatarImage src={avatarUrl} alt={fullName} /> : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
                        {initials || <User className="w-8 h-8" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute inset-0 rounded-full bg-foreground/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-6 h-6 text-primary-foreground" />
                    </div>
                    {uploading && (
                      <div className="absolute inset-0 rounded-full bg-background/60 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">Click to change photo</p>
                    <Badge className={`${role.color} mt-2 text-xs rounded-full`}>
                      <role.icon className="w-3 h-3 mr-1" /> {role.label}
                    </Badge>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </CardContent>
              </Card>

              {/* Info */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone Number</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+252 XX XXX XXXX" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input value={user?.primaryEmailAddress?.emailAddress || ""} disabled className="opacity-60" />
                    <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
                  </div>
                </CardContent>
              </Card>

              <Button onClick={handleSave} disabled={saving} className="w-full">
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save Changes"}
              </Button>

              {/* Role upgrade */}
              {canUpgrade && (
                <Card className="border-accent/20 bg-accent/5">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <ArrowUpCircle className="w-5 h-5 text-accent" /> Upgrade Your Role
                    </CardTitle>
                    <CardDescription>
                      Want to list properties? Upgrade from Renter to start earning.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {upgradeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        disabled={upgradingRole}
                        onClick={() => handleUpgradeRole(opt.value)}
                        className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-border hover:border-accent/40 transition-all text-left bg-card"
                      >
                        <div>
                          <p className="font-heading font-semibold text-foreground text-sm">{opt.label}</p>
                          <p className="text-muted-foreground text-xs">{opt.desc}</p>
                        </div>
                        <ArrowUpCircle className="w-5 h-5 text-accent shrink-0" />
                      </button>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </motion.div>
      </main>
      <BottomNav />
    </div>
  );
};

export default ProfileSettings;
