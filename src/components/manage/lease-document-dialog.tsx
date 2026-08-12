import { useEffect, useState } from "react";
import { FileUp } from "lucide-react";

import { type ManagedProperty } from "@/hooks/use-rent";
import {
  useUploadLeaseDocument,
  LEASE_DOC_TYPES,
  type LeaseDocType,
} from "@/hooks/use-lease-documents";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type LeaseDocumentDialogProps = {
  property: ManagedProperty;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Uploads a file to the private bucket and creates its metadata row. */
export function LeaseDocumentDialog({
  property, open, onOpenChange,
}: LeaseDocumentDialogProps) {
  const upload = useUploadLeaseDocument(property);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<LeaseDocType>("lease_agreement");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle("");
    setDocType("lease_agreement");
    setStartDate("");
    setEndDate("");
    setTouched(false);
  }, [open]);

  const handleFile = (chosen: File | null) => {
    setFile(chosen);
    // Default the title to the file's name so staff rarely have to type one.
    if (chosen && !title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
  };

  const titleInvalid = touched && title.trim().length < 2;
  const dateInvalid =
    Boolean(startDate && endDate && endDate < startDate);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!file) return;
    if (title.trim().length < 2) return;
    if (dateInvalid) return;

    upload.mutate(
      {
        file,
        title,
        docType,
        startDate: startDate || null,
        endDate: endDate || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload a lease document</DialogTitle>
          <DialogDescription>
            {property.title} — stored privately for your team.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lease-file" className="text-xs text-muted-foreground">
              File
            </Label>
            <Input
              id="lease-file"
              type="file"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              onBlur={() => setTouched(true)}
              className="h-11 rounded-xl file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:text-primary-foreground"
            />
            {touched && !file && (
              <p className="text-xs text-destructive">Choose a file to upload.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lease-title" className="text-xs text-muted-foreground">
              Title
            </Label>
            <Input
              id="lease-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="2026 lease — Mohamed Farah"
              maxLength={160}
              className="h-11 rounded-xl"
              aria-invalid={titleInvalid}
            />
            {titleInvalid && <p className="text-xs text-destructive">Give the document a title.</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lease-doc-type" className="text-xs text-muted-foreground">
              Type
            </Label>
            <Select
              value={docType}
              onValueChange={(v) => setDocType(v as LeaseDocType)}
            >
              <SelectTrigger id="lease-doc-type" className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEASE_DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lease-start" className="text-xs text-muted-foreground">
                From <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="lease-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lease-end" className="text-xs text-muted-foreground">
                To <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <Input
                id="lease-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={dateInvalid ? "h-11 rounded-xl border-destructive" : "h-11 rounded-xl"}
              />
            </div>
          </div>
          {dateInvalid && (
            <p className="text-xs text-destructive">"To" must be after "From".</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="hero"
              disabled={upload.isPending || !file || titleInvalid || dateInvalid}
            >
              <FileUp className="w-4 h-4" />
              {upload.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}