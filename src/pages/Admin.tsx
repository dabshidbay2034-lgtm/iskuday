import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { toast } from "sonner";
import {
  Edit, Trash2, EyeOff, Shield, AlertTriangle, Users, CheckCircle, XCircle, Building,
  Search, UserCheck, UserX, Phone, Filter, Wallet
} from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { useAppAuth } from "@/hooks/use-auth";
import { BillingAdminPanel } from "@/components/admin/BillingAdminPanel";
import type { UserRole } from "@/lib/types";

type PropertyWithDetails = Tables<"properties"> & {
  profiles: Tables<"profiles"> | null;
  property_images: Tables<"property_images">[];
};

type UserWithRole = {
  user_id: string;
  // Use the shared UserRole rather than re-spelling the union here — an inline
  // copy silently drifted out of sync with the app_role enum once already
  // (it was missing 'semi_admin').
  role: UserRole;
  is_verified: boolean;
  id: string;
  profile: Tables<"profiles"> | null;
  // Phone numbers no longer live on profiles. profile_contacts is readable
  // only by the row's owner or a platform admin — this admin panel is the one
  // place in the app where other users' numbers may legitimately appear.
  contact: Tables<"profile_contacts"> | null;
};

const Admin = () => {
  const [properties, setProperties] = useState<PropertyWithDetails[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState<PropertyWithDetails | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userVerifiedFilter, setUserVerifiedFilter] = useState("all");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isLoaded, platformRole, isSignedIn } = useAppAuth();
  const isAdmin = isLoaded && isSignedIn && platformRole === "admin";

  // Load properties — single query with a batch profile fetch instead of
  // N+1 per-property profile lookups (old code fired one SELECT per property).
  useEffect(() => {
    if (!isAdmin) return;
    const loadProperties = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("properties")
        .select(`*, property_images(*)`)
        .order("created_at", { ascending: false });

      if (error) {
        toast({ title: "Error loading properties", description: error.message, variant: "destructive" });
      } else if (data) {
        // Batch: collect all distinct owner_ids, fetch their profiles in one
        // query, then attach. Two queries total regardless of property count.
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
  }, [isAdmin, toast]);

  // Load users with roles — single batch fetch for profiles instead of N+1.
  useEffect(() => {
    if (!isAdmin) return;
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
        // Batch: one query for every contact row (platform admin sees all via
        // RLS) and one for every profile, instead of one per user.
        const userIds = roles.map((r) => r.user_id);
        const [contactsRes, profilesRes] = await Promise.all([
          supabase.from("profile_contacts").select("*"),
          userIds.length > 0
            ? supabase.from("profiles").select("*").in("user_id", userIds)
            : Promise.resolve({ data: [] }),
        ]);
        const contactsByUser = new Map((contactsRes.data ?? []).map((c) => [c.user_id, c]));
        const profileMap = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p]));

        setUsers(
          roles.map((role) => ({
            ...role,
            profile: profileMap.get(role.user_id) ?? null,
            contact: contactsByUser.get(role.user_id) ?? null,
          })),
        );
      }
    };
    loadUsers();
  }, [isAdmin, toast]);

  // Property actions
  const togglePropertyVisibility = async (propertyId: string, currentHiddenState: boolean) => {
    const { error } = await supabase.from("properties").update({ is_hidden: !currentHiddenState }).eq("id", propertyId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: `Property ${!currentHiddenState ? "hidden" : "shown"}` });
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, is_hidden: !currentHiddenState } : p));
    }
  };

  const togglePropertyAvailability = async (propertyId: string, currentAvailableState: boolean) => {
    const { error } = await supabase.from("properties").update({ is_available: !currentAvailableState }).eq("id", propertyId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: `Property marked as ${!currentAvailableState ? "available" : "unavailable"}` });
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, is_available: !currentAvailableState } : p));
    }
  };

  const deleteProperty = async (propertyId: string) => {
    if (!window.confirm("Are you sure you want to hide this property? It will be hidden from all users and marked unavailable.")) return;
    const { error } = await supabase.from("properties").update({ is_hidden: true, is_available: false }).eq("id", propertyId);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: "Property hidden" });
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, is_hidden: true, is_available: false } : p));
    }
  };

  const updateProperty = async (updatedProperty: Partial<PropertyWithDetails>) => {
    if (!editingProperty) return;
    const { error } = await supabase.from("properties").update(updatedProperty).eq("id", editingProperty.id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: "Property updated" });
      setProperties(prev => prev.map(p => p.id === editingProperty.id ? { ...p, ...updatedProperty } : p));
      setEditingProperty(null);
    }
  };

  // User management actions
  const updateUserRole = async (roleId: string, userId: string, newRole: UserRole) => {
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("id", roleId);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: `Role updated to ${newRole}` });
      setUsers(prev => prev.map(u => u.id === roleId ? { ...u, role: newRole } : u));
    }
  };

  const toggleVerification = async (roleId: string, currentVerified: boolean) => {
    const { error } = await supabase
      .from("user_roles")
      .update({ is_verified: !currentVerified })
      .eq("id", roleId);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      toast({ title: "Success", description: `User ${!currentVerified ? "verified" : "unverified"}` });
      setUsers(prev => prev.map(u => u.id === roleId ? { ...u, is_verified: !currentVerified } : u));
    }
  };

  const filteredProperties = properties.filter(property =>
    property.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
    property.profiles?.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.profile?.full_name.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      user.role.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      user.contact?.phone?.toLowerCase().includes(userSearchTerm.toLowerCase());
    const matchesRole = userRoleFilter === "all" || user.role === userRoleFilter;
    const matchesVerified =
      userVerifiedFilter === "all" ||
      (userVerifiedFilter === "verified" && user.is_verified) ||
      (userVerifiedFilter === "unverified" && !user.is_verified);
    return matchesSearch && matchesRole && matchesVerified;
  });

  const pendingUsers = users.filter(u => !u.is_verified);

  const roleLabels: Record<string, string> = {
    user: "Renter",
    owner: "Owner",
    hotel_manager: "Hotel Mgr",
    agent: "Agent",
    semi_admin: "Semi Admin",
    admin: "Admin",
  };

  const roleBadgeVariant = (role: string): "default" | "secondary" | "destructive" | "outline" => {
    if (role === "admin") return "destructive";
    if (role === "semi_admin") return "outline";
    if (role === "owner" || role === "hotel_manager") return "default";
    if (role === "agent") return "outline";
    return "secondary";
  };

  // Show spinner while auth resolves. Only show "restricted" once we know
  // the role and it doesn't match — avoids flashing the card to admins.
  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
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
                This area requires administrator privileges. Please contact support if you need access.
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
            <Shield className="h-8 w-8 text-primary" />
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground">Manage properties and users on the platform</p>
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
            <TabsTrigger value="billing" className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Billing
            </TabsTrigger>
          </TabsList>

          {/* Properties Tab */}
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
                        <th className="p-4">Status</th>
                        <th className="p-4">Actions</th>
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
                            <div className="flex flex-col gap-1">
                              <Badge variant={property.is_available ? "default" : "secondary"}>{property.is_available ? "Available" : "Unavailable"}</Badge>
                              <Badge variant={property.is_hidden ? "destructive" : "default"}>{property.is_hidden ? "Hidden" : "Visible"}</Badge>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => togglePropertyAvailability(property.id, property.is_available)}>
                                {property.is_available ? "Available" : "Unavailable"}
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => togglePropertyVisibility(property.id, property.is_hidden)}>
                                {property.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                              </Button>
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" onClick={() => setEditingProperty(property)}><Edit className="h-4 w-4" /></Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                                  <DialogHeader><DialogTitle>Edit Property</DialogTitle></DialogHeader>
                                  {editingProperty && <PropertyEditForm property={editingProperty} onSave={updateProperty} onCancel={() => setEditingProperty(null)} />}
                                </DialogContent>
                              </Dialog>
                              <Button variant="destructive" size="sm" onClick={() => deleteProperty(property.id)}><Trash2 className="h-4 w-4" /></Button>
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

          {/* Users Tab - Improved */}
          <TabsContent value="users" className="space-y-4">
            {/* Search + Filters row */}
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
                  <SelectItem value="semi_admin">Semi Admins</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
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
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold">{users.length}</div>
                  <p className="text-muted-foreground text-xs">Total</p>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-success">{users.filter(u => u.is_verified).length}</div>
                  <p className="text-muted-foreground text-xs">Verified</p>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-warning">{pendingUsers.length}</div>
                  <p className="text-muted-foreground text-xs">Pending</p>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-primary">{users.filter(u => u.role === "owner").length}</div>
                  <p className="text-muted-foreground text-xs">Owners</p>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold text-info">{users.filter(u => u.role === "agent").length}</div>
                  <p className="text-muted-foreground text-xs">Agents</p>
                </CardContent>
              </Card>
              <Card className="col-span-1">
                <CardContent className="p-3 text-center">
                  <div className="text-xl font-bold">{users.filter(u => u.role === "hotel_manager").length}</div>
                  <p className="text-muted-foreground text-xs">Hotel Mgrs</p>
                </CardContent>
              </Card>
            </div>

            {/* Pending Verifications Alert */}
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

            {/* User Cards Grid */}
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
                      {/* Header: Avatar + name + verification badge */}
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
                            {user.contact?.phone ? (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="w-3 h-3" /> {user.contact.phone}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">No phone</span>
                            )}
                          </div>
                        </div>
                        <Badge variant={roleBadgeVariant(user.role)} className="text-[10px] shrink-0">
                          {roleLabels[user.role] || user.role}
                        </Badge>
                      </div>

                      {/* Verification status */}
                      <div className="flex items-center justify-between mb-3 py-2 px-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2">
                          {user.is_verified ? (
                            <UserCheck className="w-4 h-4 text-success" />
                          ) : (
                            <UserX className="w-4 h-4 text-warning" />
                          )}
                          <span className={`text-xs font-medium ${user.is_verified ? "text-success" : "text-warning"}`}>
                            {user.is_verified ? "Verified" : "Unverified"}
                          </span>
                          {user.is_verified && user.role === "agent" && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 border-success/40 text-success">
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant={user.is_verified ? "outline" : "default"}
                          className="h-7 text-xs"
                          onClick={() => toggleVerification(user.id, user.is_verified)}
                        >
                          {user.is_verified ? "Revoke" : "Verify"}
                        </Button>
                      </div>

                      {/* Role selector */}
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground shrink-0">Role:</Label>
                        <Select
                          value={user.role}
                          onValueChange={(value: UserRole) => updateUserRole(user.id, user.user_id, value)}
                        >
                          <SelectTrigger className="h-8 text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">Renter</SelectItem>
                            <SelectItem value="owner">Owner</SelectItem>
                            <SelectItem value="hotel_manager">Hotel Manager</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="semi_admin">Semi Admin</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* User ID */}
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

          {/* Billing Tab — subscriptions, payments and manual activation.
              With no payment processor this is the only way a customer who has
              paid by EVC/Zaad/Sifalo gets unlocked without hand-written SQL. */}
          <TabsContent value="billing" className="space-y-4">
            <BillingAdminPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// Property Edit Form Component
const PropertyEditForm = ({ 
  property, onSave, onCancel 
}: { 
  property: PropertyWithDetails;
  onSave: (updatedProperty: Partial<PropertyWithDetails>) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    title: property.title,
    description: property.description || "",
    location: property.location,
    type: property.type,
    price: property.price,
    deposit: property.deposit,
    is_available: property.is_available,
    is_daily_rate: property.is_daily_rate,
    is_hidden: property.is_hidden,
    bedrooms: property.bedrooms || 0,
    living_rooms: property.living_rooms || 0,
    kitchens: property.kitchens || 0,
    toilets: property.toilets || 0,
    floor_number: property.floor_number || 0,
    has_balcony: property.has_balcony || false,
    has_cctv: property.has_cctv || false,
    has_parking: property.has_parking || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} />
        </div>
        <div>
          <Label htmlFor="type">Type</Label>
          <Select value={formData.type} onValueChange={(value) => setFormData(prev => ({ ...prev, type: value as "villa" | "apartment" | "hotel" | "bnb" | "commercial" }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="villa">House</SelectItem>
              <SelectItem value="apartment">Apartment</SelectItem>
              <SelectItem value="hotel">Hotel</SelectItem>
              <SelectItem value="bnb">BnB</SelectItem>
              <SelectItem value="commercial">Commercial</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="price">Price</Label>
          <Input id="price" type="number" value={formData.price} onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) }))} />
        </div>
        <div>
          <Label htmlFor="deposit">Deposit</Label>
          <Input id="deposit" type="number" value={formData.deposit} onChange={(e) => setFormData(prev => ({ ...prev, deposit: parseFloat(e.target.value) }))} />
        </div>
      </div>

      <div>
        <Label htmlFor="location">Location</Label>
        <Input id="location" value={formData.location} onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))} />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => {
            const value = e.target.value;
            if (/\d{7,}/.test(value)) {
              toast("Phone numbers are not allowed in property descriptions.");
              return;
            }
            setFormData(prev => ({ ...prev, description: value }));
          }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><Label htmlFor="bedrooms">Bedrooms</Label><Input id="bedrooms" type="number" min="0" value={formData.bedrooms} onChange={(e) => setFormData(prev => ({ ...prev, bedrooms: parseInt(e.target.value) }))} /></div>
        <div><Label htmlFor="living_rooms">Living Rooms</Label><Input id="living_rooms" type="number" min="0" value={formData.living_rooms} onChange={(e) => setFormData(prev => ({ ...prev, living_rooms: parseInt(e.target.value) }))} /></div>
        <div><Label htmlFor="kitchens">Kitchens</Label><Input id="kitchens" type="number" min="0" value={formData.kitchens} onChange={(e) => setFormData(prev => ({ ...prev, kitchens: parseInt(e.target.value) }))} /></div>
        <div><Label htmlFor="toilets">Toilets</Label><Input id="toilets" type="number" min="0" value={formData.toilets} onChange={(e) => setFormData(prev => ({ ...prev, toilets: parseInt(e.target.value) }))} /></div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex items-center space-x-2"><Switch id="is_available" checked={formData.is_available} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_available: checked }))} /><Label htmlFor="is_available">Available</Label></div>
        <div className="flex items-center space-x-2"><Switch id="is_daily_rate" checked={formData.is_daily_rate} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_daily_rate: checked }))} /><Label htmlFor="is_daily_rate">Daily Rate</Label></div>
        <div className="flex items-center space-x-2"><Switch id="is_hidden" checked={formData.is_hidden} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_hidden: checked }))} /><Label htmlFor="is_hidden">Hidden</Label></div>
        <div className="flex items-center space-x-2"><Switch id="has_balcony" checked={formData.has_balcony} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, has_balcony: checked }))} /><Label htmlFor="has_balcony">Balcony</Label></div>
        <div className="flex items-center space-x-2"><Switch id="has_cctv" checked={formData.has_cctv} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, has_cctv: checked }))} /><Label htmlFor="has_cctv">CCTV</Label></div>
        <div className="flex items-center space-x-2"><Switch id="has_parking" checked={formData.has_parking} onCheckedChange={(checked) => setFormData(prev => ({ ...prev, has_parking: checked }))} /><Label htmlFor="has_parking">Parking</Label></div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Save Changes</Button>
      </div>
    </form>
  );
};

export default Admin;
