import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Eye, Shield, AlertTriangle, Users, Building,
  Search, UserCheck, UserX, Phone, Filter, EyeIcon
} from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { useAppAuth } from "@/hooks/use-auth";
import type { UserRole } from "@/lib/types";

type PropertyWithDetails = Tables<"properties"> & {
  profiles: Tables<"profiles"> | null;
  property_images: Tables<"property_images">[];
};

type UserWithRole = {
  user_id: string;
  // Shared UserRole, not a bare string and not an inline union — the same field
  // in Admin.tsx drifted out of sync with the app_role enum by being re-spelled
  // locally.
  role: UserRole;
  is_verified: boolean;
  id: string;
  profile: Tables<"profiles"> | null;
};

const SemiAdmin = () => {
  const [properties, setProperties] = useState<PropertyWithDetails[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userVerifiedFilter, setUserVerifiedFilter] = useState("all");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isLoaded, isSignedIn, platformRole } = useAppAuth();
  // Access is already gated by ProtectedRoute in App.tsx; no need for a
  // redundant RPC. When the route guard + auth resolve we trust the role.
  const hasAccess = isLoaded && isSignedIn && (platformRole === "admin" || platformRole === "semi_admin");

  // Load properties — single query with a batch profile fetch instead of
  // N+1 per-property profile lookups.
  useEffect(() => {
    if (!hasAccess) return;
    const loadProperties = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("properties")
        .select(`*, property_images(*)`)
        .order("created_at", { ascending: false });

      if (error) {
        toast({ title: "Error loading properties", description: error.message, variant: "destructive" });
      } else if (data) {
        const ownerIds = [...new Set(data.map((p) => p.owner_id).filter(Boolean))];
        const { data: profiles } = ownerIds.length > 0
          ? await supabase.from("profiles").select("*").in("user_id", ownerIds)
          : { data: [] };
        const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

        setProperties(
          data.map((property) => ({
            ...property,
            profiles: profileMap.get(property.owner_id) ?? null,
          })),
        );
      }
      setLoading(false);
    };
    loadProperties();
  }, [hasAccess, toast]);

  // Load users with roles — single batch fetch for profiles instead of N+1.
  useEffect(() => {
    if (!hasAccess) return;
    const loadUsers = async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("*")
        .order("role");

      if (error) {
        toast({ title: "Error loading users", description: error.message, variant: "destructive" });
        return;
      }

      if (roles) {
        const userIds = roles.map((r) => r.user_id);
        // Fetch profiles in a single batch (no N+1). An empty user list short-
        // circuits so .in() never receives an empty array.
        let profiles: Tables<"profiles">[] = [];
        if (userIds.length > 0) {
          const profilesRes = await supabase
            .from("profiles")
            .select("*")
            .in("user_id", userIds);
          profiles = (profilesRes.data as Tables<"profiles">[]) ?? [];
        }
        const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

        setUsers(
          roles.map((role) => ({
            ...role,
            profile: profileMap.get(role.user_id) ?? null,
          })) as UserWithRole[],
        );
      }
    };
    loadUsers();
  }, [hasAccess, toast]);

  const filteredProperties = properties.filter(property =>
    property.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.profiles?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredUsers = users.filter(user => {
    // Phone is deliberately not searchable here: numbers live in
    // profile_contacts, which only the owning user or a PLATFORM admin can
    // read. A semi_admin is neither, so it would always match nothing.
    const matchesSearch =
      user.profile?.full_name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      user.role.toLowerCase().includes(userSearchTerm.toLowerCase());
    const matchesRole = userRoleFilter === "all" || user.role === userRoleFilter;
    const matchesVerified =
      userVerifiedFilter === "all" ||
      (userVerifiedFilter === "verified" && user.is_verified) ||
      (userVerifiedFilter === "unverified" && !user.is_verified);
    return matchesSearch && matchesRole && matchesVerified;
  });

  const pendingUsers = users.filter(u => !u.is_verified);

  const roleLabels: Record<string, string> = {
    user: "Renter", owner: "Owner", hotel_manager: "Hotel Mgr",
    agent: "Agent", admin: "Admin", semi_admin: "Semi Admin",
  };

  const roleBadgeVariant = (role: string): "default" | "secondary" | "destructive" | "outline" => {
    if (role === "admin") return "destructive";
    if (role === "owner" || role === "hotel_manager") return "default";
    if (role === "agent" || role === "semi_admin") return "outline";
    return "secondary";
  };

  // Show spinner while auth resolves. Only show "restricted" once we know the
  // role and it doesn't match — avoids flashing the card to legitimate admins.
  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-destructive" />
              Access Restricted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This area requires viewing privileges. Please contact an admin if you need access.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <EyeIcon className="h-8 w-8 text-primary" />
            Overview Dashboard
          </h1>
          <p className="text-muted-foreground">View-only access — properties and users on the platform</p>
          <Badge variant="outline" className="mt-2">Read Only</Badge>
        </div>

        <Tabs defaultValue="properties" className="space-y-6">
          <TabsList>
            <TabsTrigger value="properties" className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              Properties
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Users
              {pendingUsers.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                  {pendingUsers.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Properties Tab — READ ONLY */}
          <TabsContent value="properties" className="space-y-4">
            <Input
              placeholder="Search properties by title, location, or owner..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-md"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="p-4"><div className="text-2xl font-bold">{properties.length}</div><p className="text-muted-foreground text-sm">Total Properties</p></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold text-success">{properties.filter(p => !p.is_hidden).length}</div><p className="text-muted-foreground text-sm">Visible</p></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold text-warning">{properties.filter(p => p.is_hidden).length}</div><p className="text-muted-foreground text-sm">Hidden</p></CardContent></Card>
              <Card><CardContent className="p-4"><div className="text-2xl font-bold text-info">{properties.filter(p => p.is_available).length}</div><p className="text-muted-foreground text-sm">Available</p></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Property Listings ({filteredProperties.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b">
                      <tr className="text-left">
                        <th className="p-4">Property</th>
                        <th className="p-4">Owner</th>
                        <th className="p-4">Type</th>
                        <th className="p-4">Price</th>
                        <th className="p-4">Views</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProperties.map((property) => (
                        <tr key={property.id} className="border-b hover:bg-muted/50">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              {property.property_images?.[0] && (
                                <img src={property.property_images[0].image_url} alt={property.title} className="w-12 h-12 rounded-lg object-cover" />
                              )}
                              <div>
                                <div className="font-medium">{property.title}</div>
                                <div className="text-sm text-muted-foreground">{property.location}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4"><div className="font-medium">{property.profiles?.full_name || "Unknown"}</div></td>
                          <td className="p-4"><Badge variant="outline">{property.type}</Badge></td>
                          <td className="p-4">
                            <div className="font-medium">${property.price?.toLocaleString()}{property.is_daily_rate ? "/day" : "/month"}</div>
                            <div className="text-sm text-muted-foreground">Deposit: ${property.deposit?.toLocaleString()}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5">
                              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium">{property.views || 0}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col gap-1">
                              <Badge variant={property.is_available ? "default" : "secondary"}>{property.is_available ? "Available" : "Unavailable"}</Badge>
                              <Badge variant={property.is_hidden ? "destructive" : "default"}>{property.is_hidden ? "Hidden" : "Visible"}</Badge>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab — READ ONLY */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search users by name or phone..."
                  value={userSearchTerm}
                  onChange={(e) => setUserSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={userRoleFilter} onValueChange={setUserRoleFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="user">Renters</SelectItem>
                  <SelectItem value="owner">Owners</SelectItem>
                  <SelectItem value="hotel_manager">Hotel Managers</SelectItem>
                  <SelectItem value="agent">Agents</SelectItem>
                </SelectContent>
              </Select>
              <Select value={userVerifiedFilter} onValueChange={setUserVerifiedFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Verification" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="unverified">Unverified</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold">{users.length}</div><p className="text-muted-foreground text-xs">Total</p></CardContent></Card>
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-success">{users.filter(u => u.is_verified).length}</div><p className="text-muted-foreground text-xs">Verified</p></CardContent></Card>
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-warning">{pendingUsers.length}</div><p className="text-muted-foreground text-xs">Pending</p></CardContent></Card>
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-primary">{users.filter(u => u.role === "owner").length}</div><p className="text-muted-foreground text-xs">Owners</p></CardContent></Card>
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold text-info">{users.filter(u => u.role === "agent").length}</div><p className="text-muted-foreground text-xs">Agents</p></CardContent></Card>
              <Card className="col-span-1"><CardContent className="p-3 text-center"><div className="text-xl font-bold">{users.filter(u => u.role === "hotel_manager").length}</div><p className="text-muted-foreground text-xs">Hotel Mgrs</p></CardContent></Card>
            </div>

            {pendingUsers.length > 0 && (
              <Alert className="border-warning bg-warning/5">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertDescription className="flex items-center justify-between">
                  <span className="font-medium">{pendingUsers.length} users pending verification</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-4"
                    onClick={() => { setUserVerifiedFilter("unverified"); setUserRoleFilter("all"); }}
                  >
                    Show pending
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* User Cards Grid — NO actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredUsers.map((user) => {
                const initials = user.profile?.full_name
                  ?.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) || "?";

                return (
                  <Card
                    key={user.id}
                    className={`transition-all ${!user.is_verified ? "border-warning/40 bg-warning/[0.02]" : ""}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <Avatar className="w-10 h-10">
                          {user.profile?.avatar_url && <AvatarImage src={user.profile.avatar_url} />}
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-foreground truncate">
                            {user.profile?.full_name || "Unknown"}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {/* Phone numbers are platform-admin only (plan R4).
                                A semi_admin gets no rows back from
                                profile_contacts under its RLS policy, so this
                                shows the hidden state rather than an error. */}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" /> Hidden
                            </span>
                          </div>
                        </div>
                        <Badge variant={roleBadgeVariant(user.role)} className="text-[10px] shrink-0">
                          {roleLabels[user.role] || user.role}
                        </Badge>
                      </div>

                      {/* Verification status — view only */}
                      <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/50">
                        {user.is_verified ? (
                          <UserCheck className="w-4 h-4 text-success" />
                        ) : (
                          <UserX className="w-4 h-4 text-warning" />
                        )}
                        <span className={`text-xs font-medium ${user.is_verified ? "text-success" : "text-warning"}`}>
                          {user.is_verified ? "Verified" : "Unverified"}
                        </span>
                      </div>

                      {/* Role display — no selector */}
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">Role:</span>
                        <Badge variant="secondary" className="text-xs">
                          {roleLabels[user.role] || user.role}
                        </Badge>
                      </div>

                      <p className="text-[10px] text-muted-foreground font-mono mt-2 truncate">
                        ID: {user.user_id}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {filteredUsers.length === 0 && (
              <div className="text-center py-12 bg-card rounded-2xl border border-border">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No users match your filters</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SemiAdmin;
