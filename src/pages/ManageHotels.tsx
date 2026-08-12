import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, Globe, Pencil, Plus, Trash2,
} from "lucide-react";

import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMyHotels, useCreateHotel, useDeleteHotel, type Hotel } from "@/hooks/use-hotels";
import { PAGE_TEMPLATES } from "@/components/hotel/page-templates";

/**
 * /manage/hotels — the hotelielier's page builder: list every hotel web page
 * you manage, create a new one, and jump into the editor (20260808000001).
 */
const ManageHotels = () => {
  const navigate = useNavigate();
  const { data: hotels, isPending, isError } = useMyHotels();
  const createHotel = useCreateHotel();
  const deleteHotel = useDeleteHotel();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [templateId, setTemplateId] = useState(PAGE_TEMPLATES[0].id);
  const [deleteTarget, setDeleteTarget] = useState<Hotel | null>(null);

  const nameError = nameTouched && name.trim().length < 2 ? "Enter the hotel's name." : null;

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setNameTouched(true);
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    // Fall back to the first template so a stale id can never create a blank page.
    const template = PAGE_TEMPLATES.find((t) => t.id === templateId) ?? PAGE_TEMPLATES[0];
    createHotel.mutate(
      {
        name: trimmed,
        sections: template.build(trimmed),
        accentColor: template.accentColor,
      },
      {
        onSuccess: (hotel) => {
          setCreateOpen(false);
          setName("");
          setNameTouched(false);
          setTemplateId(PAGE_TEMPLATES[0].id);
          navigate(`/manage/hotels/${hotel.id}`);
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <Header />

      <div className="container max-w-4xl py-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading font-bold text-xl md:text-2xl text-foreground">
              Hotel pages
            </h1>
            <p className="text-sm text-muted-foreground">
              Build, brand and publish a web page for each hotel you run.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/manage">
                <ArrowLeft className="w-4 h-4" /> Portfolio
              </Link>
            </Button>
            <Button variant="hero" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New page
            </Button>
          </div>
        </div>

        {isPending ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-border">
            <p className="text-sm text-destructive">Hotel pages couldn't be loaded.</p>
          </div>
        ) : hotels.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-dashed border-border">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Globe className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-semibold text-foreground mb-1">
              No hotel pages yet
            </h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Give a hotel its own web page — hero image, photo gallery, rooms and
              a contact section, all at its own link.
            </p>
            <Button variant="hero" onClick={() => { setName(""); setCreateOpen(true); }}>
              <Plus className="w-4 h-4" /> Create your first page
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {hotels.map((hotel) => {
              const heroImage = hotel.sections.find((s) => s.type === "hero")?.imageUrl;
              return (
              <div key={hotel.id} className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className="relative h-28">
                  {heroImage ? (
                    <img src={heroImage} alt={hotel.name} className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ background: `linear-gradient(135deg, ${hotel.accentColor}55, transparent)` }}
                    >
                      <Globe className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute top-2 right-2">
                    <Badge
                      className="rounded-full text-[10px] font-semibold"
                      variant={hotel.isPublished ? "default" : "secondary"}
                    >
                      {hotel.isPublished ? "Published" : "Draft"}
                    </Badge>
                  </div>
                </div>
                <div className="p-4">
                  <p className="font-heading font-semibold text-foreground">{hotel.name}</p>
                  {hotel.tagline && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{hotel.tagline}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">
                    <Globe className="w-3 h-3 inline mr-1" />
                    /hotels/{hotel.slug}
                  </p>

                  <div className="flex items-center gap-2 mt-4">
                    <Button size="sm" variant="hero" className="h-8 px-3 text-xs" asChild>
                      <Link to={`/manage/hotels/${hotel.id}`}>
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </Link>
                    </Button>
                    {hotel.isPublished && (
                      <Button size="sm" variant="outline" className="h-8 px-3 text-xs" asChild>
                        <Link to={`/hotels/${hotel.slug}`}>
                          <ExternalLink className="w-3.5 h-3.5" /> View
                        </Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs text-destructive ml-auto"
                      onClick={() => setDeleteTarget(hotel)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New hotel page</DialogTitle>
            <DialogDescription>
              Pick a starting look, then name the hotel — the page's address (/hotels/…) is
              created from the name and can be seen on the page.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Start from</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {PAGE_TEMPLATES.map((tpl) => {
                  const selected = tpl.id === templateId;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setTemplateId(tpl.id)}
                      aria-pressed={selected}
                      className={`text-left rounded-xl border p-3 transition-colors ${
                        selected
                          ? "border-primary ring-2 ring-primary/60 bg-primary/5"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      {/* The accent is the owner's data, not a theme token — inline. */}
                      <span
                        className="block h-6 w-full rounded-md mb-2"
                        style={{ background: `linear-gradient(135deg, ${tpl.accentColor}, ${tpl.accentColor}55)` }}
                      />
                      <span className="block text-sm font-semibold text-foreground">{tpl.label}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground mt-0.5">
                        {tpl.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Every block, photo and colour stays editable afterwards.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hotel-name" className="text-xs text-muted-foreground">Hotel name</Label>
              <Input
                id="hotel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="e.g. Maandeeq Beach Hotel"
                className="h-11 rounded-xl"
                autoFocus
              />
              {nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" variant="hero" disabled={createHotel.isPending || !!nameError}>
                {createHotel.isPending ? "Creating…" : "Create page"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this hotel page?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>'s page and
              its photos will be removed. Your rooms are untouched — they just stop appearing
              on this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteHotel.mutate(deleteTarget)}
              disabled={deleteHotel.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteHotel.isPending ? "Deleting…" : "Delete page"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
};

export default ManageHotels;