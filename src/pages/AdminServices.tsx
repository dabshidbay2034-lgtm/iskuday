import { useState } from "react";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { useAppAuth } from "@/hooks/use-auth";
import {
  useAllServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useServiceInquiries,
  useUpdateInquiryStatus,
  type Service,
  type ServiceInquiry,
} from "@/hooks/use-services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Wrench,
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Inbox,
  ShieldAlert,
  ArrowUpDown,
  Tag,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const DEFAULT_FORM_DATA = {
  title: "",
  slug: "",
  description: "",
  icon: "wrench",
  image_url: "",
  price_from: "",
  price_note: "",
  sort_order: "0",
  is_published: true,
};

const AdminServices = () => {
  const { platformRole, isLoaded, userId } = useAppAuth();
  const isAdmin = platformRole === "admin";

  const { data: services, isLoading: servicesLoading } = useAllServices();
  const { data: inquiries, isLoading: inquiriesLoading } = useServiceInquiries();

  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();
  const updateInquiryStatus = useUpdateInquiryStatus();

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);
  const [autoSlug, setAutoSlug] = useState(true);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <Header />
        <div className="container py-20 max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/15 text-destructive flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-heading font-extrabold text-foreground">Access Restricted</h1>
          <p className="text-muted-foreground text-sm">
            Only platform administrators can manage the services catalog.
          </p>
        </div>
        <BottomNav />
      </div>
    );
  }

  const handleOpenCreate = () => {
    setEditingService(null);
    setFormData(DEFAULT_FORM_DATA);
    setAutoSlug(true);
    setDialogOpen(true);
  };

  const handleOpenEdit = (service: Service) => {
    setEditingService(service);
    setFormData({
      title: service.title,
      slug: service.slug,
      description: service.description || "",
      icon: service.icon || "wrench",
      image_url: service.image_url || "",
      price_from: service.price_from != null ? String(service.price_from) : "",
      price_note: service.price_note || "",
      sort_order: String(service.sort_order ?? 0),
      is_published: service.is_published,
    });
    setAutoSlug(false);
    setDialogOpen(true);
  };

  const handleTitleChange = (val: string) => {
    setFormData((prev) => ({
      ...prev,
      title: val,
      slug: autoSlug ? slugify(val) : prev.slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error("Service title is required");
      return;
    }
    const finalSlug = formData.slug.trim() || slugify(formData.title);

    try {
      const payload = {
        title: formData.title.trim(),
        slug: finalSlug,
        description: formData.description.trim() || null,
        icon: formData.icon.trim() || null,
        image_url: formData.image_url.trim() || null,
        price_from: formData.price_from ? Number(formData.price_from) : null,
        price_note: formData.price_note.trim() || null,
        sort_order: Number(formData.sort_order) || 0,
        is_published: formData.is_published,
        created_by: userId ?? undefined,
      };

      if (editingService) {
        await updateService.mutateAsync({ id: editingService.id, ...payload });
        toast.success("Service updated successfully");
      } else {
        await createService.mutateAsync(payload);
        toast.success("Service created successfully");
      }

      setDialogOpen(false);
    } catch (err: unknown) {
      toast.error((err as Error)?.message || "Failed to save service");
    }
  };

  const handleTogglePublish = async (service: Service) => {
    try {
      await updateService.mutateAsync({
        id: service.id,
        is_published: !service.is_published,
      });
      toast.success(
        `Service ${!service.is_published ? "published" : "unpublished"}`
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  const ConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteService.mutateAsync(deleteTarget.id);
      toast.success("Service deleted");
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error((err as Error)?.message || "Failed to delete service");
    }
  };

  const handleStatusChange = async (inquiryId: string, status: "new" | "contacted" | "closed") => {
    try {
      await updateInquiryStatus.mutateAsync({ id: inquiryId, status });
      toast.success(`Inquiry marked as ${status}`);
    } catch {
      toast.error("Failed to update inquiry status");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <main className="container py-8 max-w-6xl space-y-8">
        {/* Header Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-heading font-extrabold text-foreground flex items-center gap-2">
              <Wrench className="w-7 h-7 text-primary" />
              Services Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage public service catalog items and respond to incoming inquiries
            </p>
          </div>

          <Button
            onClick={handleOpenCreate}
            className="rounded-full font-bold shadow-card gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" /> Add New Service
          </Button>
        </div>

        {/* Tabs for Services & Inquiries */}
        <Tabs defaultValue="services" className="space-y-6">
          <TabsList className="rounded-2xl p-1 bg-muted">
            <TabsTrigger value="services" className="rounded-xl px-4 py-2 font-semibold">
              <Wrench className="w-4 h-4 mr-2" /> Catalog Services ({(services || []).length})
            </TabsTrigger>
            <TabsTrigger value="inquiries" className="rounded-xl px-4 py-2 font-semibold relative">
              <Inbox className="w-4 h-4 mr-2" /> Inquiries ({(inquiries || []).length})
              {(inquiries || []).some((i) => i.status === "new") && (
                <span className="ml-2 w-2 h-2 rounded-full bg-destructive inline-block" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Services Tab */}
          <TabsContent value="services" className="space-y-4">
            <Card className="rounded-3xl border-border/70 shadow-card overflow-hidden">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="text-lg font-heading font-bold">
                  All Catalog Services
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {servicesLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading services...</div>
                ) : (services || []).length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground space-y-2">
                    <Wrench className="w-8 h-8 mx-auto opacity-50" />
                    <p>No services found in catalog.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 border-b border-border/50 text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-4">Service</th>
                          <th className="p-4">Slug</th>
                          <th className="p-4">Price</th>
                          <th className="p-4">Order</th>
                          <th className="p-4">Status</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {services!.map((item) => (
                          <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                {item.image_url ? (
                                  <img
                                    src={item.image_url}
                                    alt={item.title}
                                    className="w-10 h-10 rounded-xl object-cover"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                    {item.title.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div>
                                  <p className="font-bold text-foreground">{item.title}</p>
                                  <p className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                                    {item.description || "No description"}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 font-mono text-xs text-muted-foreground">
                              {item.slug}
                            </td>
                            <td className="p-4 font-medium">
                              {item.price_from != null ? `$${item.price_from}` : "—"}
                              {item.price_note && (
                                <span className="text-xs text-muted-foreground ml-1">
                                  ({item.price_note})
                                </span>
                              )}
                            </td>
                            <td className="p-4 font-mono text-xs">{item.sort_order}</td>
                            <td className="p-4">
                              <Badge
                                variant={item.is_published ? "default" : "secondary"}
                                className="rounded-full text-[11px]"
                              >
                                {item.is_published ? "Published" : "Draft"}
                              </Badge>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full"
                                  onClick={() => handleTogglePublish(item)}
                                  title={item.is_published ? "Unpublish" : "Publish"}
                                >
                                  {item.is_published ? (
                                    <EyeOff className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <Eye className="w-4 h-4 text-primary" />
                                  )}
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full"
                                  onClick={() => handleOpenEdit(item)}
                                  title="Edit"
                                >
                                  <Edit2 className="w-4 h-4 text-muted-foreground" />
                                </Button>

                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(item)}
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Inquiries Tab */}
          <TabsContent value="inquiries" className="space-y-4">
            <Card className="rounded-3xl border-border/70 shadow-card overflow-hidden">
              <CardHeader className="border-b border-border/50 pb-4">
                <CardTitle className="text-lg font-heading font-bold">
                  Service Inquiries ({inquiries?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {inquiriesLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading inquiries...</div>
                ) : (inquiries || []).length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground space-y-2">
                    <Inbox className="w-8 h-8 mx-auto opacity-50" />
                    <p>No service inquiries received yet.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/50 border-b border-border/50 text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-4">Sender</th>
                          <th className="p-4">Service / Ref</th>
                          <th className="p-4">Message</th>
                          <th className="p-4">Date</th>
                          <th className="p-4">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {inquiries!.map((inquiry) => (
                          <tr key={inquiry.id} className="hover:bg-muted/30 transition-colors">
                            <td className="p-4">
                              <div className="space-y-0.5">
                                <p className="font-bold text-foreground">{inquiry.sender_name}</p>
                                <p className="text-xs text-muted-foreground">{inquiry.sender_email}</p>
                                {inquiry.sender_phone && (
                                  <p className="text-xs text-muted-foreground font-mono">
                                    {inquiry.sender_phone}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="space-y-0.5">
                                <p className="font-semibold text-foreground">
                                  {inquiry.service?.title || "General Service"}
                                </p>
                                {inquiry.property?.title && (
                                  <p className="text-xs text-muted-foreground">
                                    Prop: {inquiry.property.title}
                                  </p>
                                )}
                                {inquiry.property_ref && (
                                  <p className="text-xs text-muted-foreground">
                                    Ref: {inquiry.property_ref}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="p-4 max-w-xs">
                              <p className="text-xs text-foreground leading-relaxed line-clamp-3">
                                {inquiry.message}
                              </p>
                            </td>
                            <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(inquiry.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </td>
                            <td className="p-4">
                              <Select
                                value={inquiry.status}
                                onValueChange={(val: "new" | "contacted" | "closed") =>
                                  handleStatusChange(inquiry.id, val)
                                }
                              >
                                <SelectTrigger className="h-8 w-32 rounded-xl text-xs font-semibold">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">New</SelectItem>
                                  <SelectItem value="contacted">Contacted</SelectItem>
                                  <SelectItem value="closed">Closed</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create / Edit Service Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[560px] rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-heading font-extrabold">
              {editingService ? "Edit Service" : "Create New Service"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Title *</Label>
              <Input
                placeholder="e.g. Property Plumbing & Repair"
                value={formData.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="h-11 rounded-xl"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Slug *</Label>
                <button
                  type="button"
                  onClick={() => setAutoSlug(!autoSlug)}
                  className="text-[11px] text-primary hover:underline"
                >
                  {autoSlug ? "Manual Slug" : "Auto Slug"}
                </button>
              </div>
              <Input
                placeholder="e.g. property-plumbing-repair"
                value={formData.slug}
                onChange={(e) => setFormData((prev) => ({ ...prev, slug: e.target.value }))}
                className="h-11 rounded-xl font-mono text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Description</Label>
              <Textarea
                placeholder="Describe what this service includes..."
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
                className="rounded-xl resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Icon Identifier</Label>
                <Input
                  placeholder="e.g. wrench, shield, truck, zap"
                  value={formData.icon}
                  onChange={(e) => setFormData((prev) => ({ ...prev, icon: e.target.value }))}
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Sort Order</Label>
                <Input
                  type="number"
                  placeholder="0"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, sort_order: e.target.value }))
                  }
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Image URL (Optional)</Label>
              <Input
                placeholder="https://..."
                value={formData.image_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, image_url: e.target.value }))}
                className="h-11 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Price From ($)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 50"
                  value={formData.price_from}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, price_from: e.target.value }))
                  }
                  className="h-11 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Price Note</Label>
                <Input
                  placeholder="e.g. / visit or starting at"
                  value={formData.price_note}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, price_note: e.target.value }))
                  }
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-border/50">
              <div>
                <p className="text-sm font-semibold text-foreground">Publish Status</p>
                <p className="text-xs text-muted-foreground">
                  Visible to public marketplace visitors
                </p>
              </div>
              <Switch
                checked={formData.is_published}
                onCheckedChange={(val) =>
                  setFormData((prev) => ({ ...prev, is_published: val }))
                }
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createService.isPending || updateService.isPending}
                className="rounded-full font-bold shadow-card"
              >
                {editingService ? "Update Service" : "Create Service"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-3xl p-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading font-extrabold text-lg">
              Delete "{deleteTarget?.title}"?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Are you sure you want to delete this service? All related inquiries will also be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={ConfirmDelete}
              className="bg-destructive hover:bg-destructive/90 rounded-full font-bold"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
};

export default AdminServices;
