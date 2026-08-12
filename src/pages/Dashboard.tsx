import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Home, Building2, Hotel, MapPin, Trash2,
  Pencil, User, LogOut, Eye, DollarSign, AlertCircle, Clock,
  ImageIcon, ChevronLeft, ChevronRight, X, Store,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { MOGADISHU_DISTRICTS } from "@/lib/districts";
import { useAppAuth } from "@/hooks/use-auth";
import { useClerk } from "@clerk/clerk-react";
import type { Database } from "@/integrations/supabase/types";
import { propertyTypeClass, propertyTypeLabel } from "@/lib/property-display";

/** A properties row exactly as the database returns it. */
type EditableProperty = Database["public"]["Tables"]["properties"]["Row"];

// Colours and labels come from lib/property-display so this page cannot drift
// from the cards again — the private copy that used to live here was missing
// `commercial` entirely, which rendered those badges with no colour classes.
const typeIcons: Record<string, React.ElementType> = {
  villa: Home, house: Home, apartment: Building2, hotel: Hotel, commercial: Store,
};

type TabType = "listings";

const Dashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId, isSignedIn, user } = useAppAuth();
  const { signOut } = useClerk();
  const [tab, setTab] = useState<TabType>("listings");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editProperty, setEditProperty] = useState<EditableProperty | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", price: "", deposit: "", location: "", has_cctv: false, has_parking: false, is_available: true });
  const [saving, setSaving] = useState(false);
  const [editImages, setEditImages] = useState<{ id: string; image_url: string; sort_order: number }[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      navigate("/signin");
    }
  }, [isSignedIn, navigate]);

  const { data: profile } = useQuery({
    queryKey: ["my-profile", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", userId!).single();
      return data;
    },
    enabled: !!userId,
  });

  const { data: userRole } = useQuery({
    queryKey: ["my-role", userId],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role, is_verified").eq("user_id", userId!).single();
      return data;
    },
    enabled: !!userId,
  });

  const isPendingVerification = !userRole?.is_verified;

  const { data: properties, isLoading: propsLoading } = useQuery({
    queryKey: ["my-properties", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*, property_images(image_url, sort_order)")
        .eq("owner_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });


  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("properties").delete().eq("id", deleteId);
    if (error) { toast.error(error.message); } else {
      toast.success("Property deleted");
      queryClient.invalidateQueries({ queryKey: ["my-properties"] });
    }
    setDeleteId(null);
  };

  // Takes the database row straight from the properties query, not the richer
  // `Property` view-model — the two have drifted (Property has `images`, the row
  // has `property_images`), and forcing a cast here is what hid that.
  const openEdit = async (p: EditableProperty) => {
    setEditProperty(p);
    setEditForm({
      title: p.title, description: p.description || "", price: String(p.price),
      deposit: String(p.deposit), location: p.location,
      has_cctv: p.has_cctv || false, has_parking: p.has_parking || false,
      is_available: p.is_available,
    });
    // Fetch current photos for this property
    setEditImages([]);
    setImagesLoading(true);
    const { data } = await supabase
      .from("property_images")
      .select("id, image_url, sort_order")
      .eq("property_id", p.id)
      .order("sort_order");
    setEditImages(data || []);
    setImagesLoading(false);
  };

  const handleDeleteImage = async (img: { id: string; image_url: string }) => {
    setDeletingImageId(img.id);
    // Extract the storage object path from the public URL
    try {
      const url = new URL(img.image_url);
      const marker = "/property-images/";
      const idx = url.pathname.indexOf(marker);
      const storagePath = idx !== -1 ? url.pathname.slice(idx + marker.length) : null;

      const { error: dbErr } = await supabase
        .from("property_images")
        .delete()
        .eq("id", img.id);
      if (dbErr) { toast.error(dbErr.message); setDeletingImageId(null); return; }

      if (storagePath) {
        await supabase.storage.from("property-images").remove([storagePath]);
      }

      setEditImages((prev) => prev.filter((i) => i.id !== img.id));
      queryClient.invalidateQueries({ queryKey: ["my-properties"] });
      toast.success("Photo removed");
    } catch {
      toast.error("Failed to remove photo");
    }
    setDeletingImageId(null);
  };

  const handleReorderImage = async (index: number, direction: "left" | "right") => {
    const swapIdx = direction === "left" ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= editImages.length) return;

    const imgA = editImages[index];
    const imgB = editImages[swapIdx];

    const [resA, resB] = await Promise.all([
      supabase.from("property_images").update({ sort_order: imgB.sort_order }).eq("id", imgA.id),
      supabase.from("property_images").update({ sort_order: imgA.sort_order }).eq("id", imgB.id),
    ]);
    if (resA.error || resB.error) { toast.error("Failed to reorder photos"); return; }

    const next = [...editImages];
    next[index] = { ...imgA, sort_order: imgB.sort_order };
    next[swapIdx] = { ...imgB, sort_order: imgA.sort_order };
    setEditImages(next.sort((a, b) => a.sort_order - b.sort_order));
    queryClient.invalidateQueries({ queryKey: ["my-properties"] });
  };

  const handleSaveEdit = async () => {
    if (!editProperty) return;
    setSaving(true);
    const { error } = await supabase.from("properties").update({
      title: editForm.title.trim(),
      description: editForm.description.trim() || null,
      price: Number(editForm.price),
      deposit: Number(editForm.deposit) || 0,
      location: editForm.location.trim(),
      has_cctv: editForm.has_cctv,
      has_parking: editForm.has_parking,
      is_available: editForm.is_available,
    }).eq("id", editProperty.id);
    setSaving(false);
    if (error) { toast.error(error.message); } else {
      toast.success("Property updated");
      queryClient.invalidateQueries({ queryKey: ["my-properties"] });
      setEditProperty(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  if (!isSignedIn) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <div className="container max-w-4xl py-6">
        {/* Profile header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
              ) : (
                <User className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">
                {profile?.full_name || "My Dashboard"}
              </h1>
              <p className="text-muted-foreground text-sm">{user?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/profile")}>
              <Pencil className="w-4 h-4" /> Edit Profile
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4" /> Sign Out
            </Button>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Listings", value: properties?.length ?? 0, color: "text-accent" },
            { label: "Active", value: properties?.filter((p: { is_available: boolean }) => p.is_available).length ?? 0, color: "text-primary" },
            { label: "Views", value: properties?.reduce((sum: number, p: { views?: number }) => sum + (p.views || 0), 0) ?? 0, color: "text-info" },
          ].map((s) => (
            <div key={s.label} className="p-4 rounded-xl bg-card border border-border shadow-card text-center">
              <p className={`text-2xl font-heading font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>


        {/* Listings tab */}
        {tab === "listings" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-semibold text-foreground">Your Properties</h2>
              <Button size="sm" onClick={() => navigate("/add-property")}>
                <Plus className="w-4 h-4" /> Add New
              </Button>
            </div>

            {propsLoading && [1,2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}

            {!propsLoading && properties?.length === 0 && (
              <div className="text-center py-16 bg-card rounded-2xl border border-border">
                <Home className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-4">You haven't listed any properties yet.</p>
                <Button variant="hero" onClick={() => navigate("/add-property")}>
                  <Plus className="w-4 h-4" /> List Your First Property
                </Button>
              </div>
            )}

            {/* No hand-written annotation here: the row shape comes from the
                select("*") above. Re-declaring it by hand is what silently
                dropped is_daily_rate and views from the type. */}
            {properties?.map((p, i: number) => {
              const TypeIcon = typeIcons[p.type] || Home;
              const coverImage = p.property_images
                ?.sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)?.[0]?.image_url;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex gap-4 p-4 bg-card rounded-xl border border-border shadow-card"
                >
                  {/* Thumbnail */}
                  <div className="w-24 h-20 md:w-32 md:h-24 rounded-lg overflow-hidden shrink-0 bg-secondary">
                    {coverImage ? (
                      <img src={coverImage} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <TypeIcon className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${propertyTypeClass(p.type)} text-[9px] uppercase tracking-wider font-semibold rounded-full px-2`}>
                        {propertyTypeLabel(p.type)}
                      </Badge>
                      {p.is_available ? (
                        <Badge className="bg-success/10 text-success border-success/20 text-[9px] rounded-full">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[9px] rounded-full">Inactive</Badge>
                      )}
                    </div>
                    <h3 className="font-heading font-semibold text-foreground text-sm truncate">{p.title}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" /> {p.location}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-sm font-heading font-bold text-accent">
                        ${p.price.toLocaleString()}<span className="text-[10px] text-muted-foreground font-normal">/{p.is_daily_rate ? "night" : "mo"}</span>
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Eye className="w-3 h-3" /> {p.views || 0}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/property/${p.id}`)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Property</DialogTitle>
            <DialogDescription>This will permanently remove the listing and all its photos. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editProperty} onOpenChange={() => setEditProperty(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Property</DialogTitle>
            <DialogDescription>Update your listing details below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="h-11 rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">District</Label>
              <Select value={editForm.location} onValueChange={(v) => setEditForm({ ...editForm, location: v })}>
                <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Select district" /></SelectTrigger>
                <SelectContent>
                  {MOGADISHU_DISTRICTS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Price</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input type="number" value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} className="pl-10 h-11 rounded-xl" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Deposit</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input type="number" value={editForm.deposit} onChange={(e) => setEditForm({ ...editForm, deposit: e.target.value })} className="pl-10 h-11 rounded-xl" />
                </div>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">CCTV Camera</Label>
                <Switch checked={editForm.has_cctv} onCheckedChange={(v) => setEditForm({ ...editForm, has_cctv: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Parking</Label>
                <Switch checked={editForm.has_parking} onCheckedChange={(v) => setEditForm({ ...editForm, has_parking: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Available for rent</Label>
                <Switch checked={editForm.is_available} onCheckedChange={(v) => setEditForm({ ...editForm, is_available: v })} />
              </div>
            </div>

            {/* ── Photo management ── */}
            <div className="space-y-2 pt-3 border-t border-border/50">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                Photos
                {!imagesLoading && (
                  <span className="ml-1 text-foreground font-semibold">
                    ({editImages.length})
                  </span>
                )}
              </Label>

              {imagesLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="aspect-square rounded-xl" />
                  ))}
                </div>
              ) : editImages.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  No photos uploaded for this property.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {editImages.map((img, index) => (
                    <div
                      key={img.id}
                      className="relative group aspect-square rounded-xl overflow-hidden bg-secondary border border-border"
                    >
                      <img
                        src={img.image_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />

                      {/* Cover badge */}
                      {index === 0 && (
                        <div className="absolute top-1.5 left-1.5 bg-primary/90 text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded-full pointer-events-none">
                          Cover
                        </div>
                      )}

                      {/* Hover overlay with controls */}
                      <div className="absolute inset-0 bg-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
                        {/* Reorder row */}
                        <div className="flex items-center gap-1">
                          {index > 0 && (
                            <button
                              onClick={() => handleReorderImage(index, "left")}
                              className="w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center hover:bg-card transition-colors"
                              title="Move left"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {index < editImages.length - 1 && (
                            <button
                              onClick={() => handleReorderImage(index, "right")}
                              className="w-7 h-7 rounded-full bg-card/90 text-foreground flex items-center justify-center hover:bg-card transition-colors"
                              title="Move right"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteImage(img)}
                          disabled={deletingImageId === img.id}
                          className="w-7 h-7 rounded-full bg-destructive/90 text-destructive-foreground flex items-center justify-center hover:bg-destructive transition-colors disabled:opacity-60"
                          title="Delete photo"
                        >
                          {deletingImageId === img.id ? (
                            <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Hover a photo to reorder or delete it. The first photo is used as the cover.
              </p>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEditProperty(null)}>Cancel</Button>
            <Button variant="hero" onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
};

export default Dashboard;
