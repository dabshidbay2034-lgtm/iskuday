import { useRef, useState } from "react";
import {
  Award, BookUser, Download, File as FileIcon, FileSignature, FileText, FileUp,
  FolderLock, IdCard, Image as ImageIcon, Plus, Trash2, TriangleAlert, X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDay } from "@/hooks/use-rent";
import {
  getDocExpiryStatus,
  getStaffDocumentUrl,
  humanSize,
  useDeleteStaffDocument,
  useStaffDocuments,
  useUploadStaffDocument,
  MAX_STAFF_DOC_BYTES,
  STAFF_DOC_LABELS,
  STAFF_DOC_TYPES,
  type StaffDocType,
  type StaffDocument,
} from "@/hooks/use-staff-documents";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** One glyph per document kind, so the list is scannable without reading it. */
const DOC_ICONS: Record<StaffDocType, typeof FileText> = {
  cv: FileText,
  passport: BookUser,
  national_id: IdCard,
  contract: FileSignature,
  certificate: Award,
  photo: ImageIcon,
  other: FileIcon,
};

type StaffDocumentsCardProps = {
  staffId: string;
  staffName: string;
  /** False renders the vault read-only — no upload form, no delete. */
  canManage: boolean;
};

/**
 * The staff document vault (migration 20260815000001).
 *
 * CVs, passports, IDs and contracts for one team member. Files are private:
 * every "Open" fetches a fresh one-hour signed URL rather than linking a public
 * object. Documents carrying an expiry date are flagged the moment they fall
 * inside the warning window — an expired passport is the entire reason an
 * employer keeps this file at all.
 */
export function StaffDocumentsCard({ staffId, staffName, canManage }: StaffDocumentsCardProps) {
  const { data, isPending, isError } = useStaffDocuments(staffId);
  const deleteDoc = useDeleteStaffDocument(staffId);

  const docs = data ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const open = async (doc: StaffDocument) => {
    // Deliberately NOT cached: a signed URL lives an hour, and re-signing on
    // each click keeps a revoked user from re-opening a link they still hold.
    setDownloadingId(doc.id);
    setDownloadError(null);
    const url = await getStaffDocumentUrl(doc);
    setDownloadingId(null);
    if (!url) {
      setDownloadError("You don't have access to this document, or its file is missing.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // How many documents need attention — surfaced above the list so an employer
  // sees the problem without opening every row.
  const lapsed = docs.filter((d) => getDocExpiryStatus(d).state === "expired").length;
  const soon = docs.filter((d) => getDocExpiryStatus(d).state === "expiring").length;

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <FolderLock className="w-4 h-4 text-muted-foreground shrink-0" />
              Documents
            </CardTitle>
            <CardDescription className="text-xs">
              CV, passport, ID and contract for {staffName} — stored privately
            </CardDescription>
          </div>
          {canManage && !formOpen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFormOpen(true)}
              className="shrink-0"
            >
              <Plus className="w-4 h-4" /> Upload
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {(lapsed > 0 || soon > 0) && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-xl border p-3 text-xs",
              lapsed > 0
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-warning/40 bg-warning/10 text-foreground",
            )}
          >
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {lapsed > 0 && (
                <span className="font-medium">
                  {lapsed} document{lapsed === 1 ? " has" : "s have"} expired.
                </span>
              )}
              {lapsed > 0 && soon > 0 && " "}
              {soon > 0 && (
                <span>
                  {soon} expire{soon === 1 ? "s" : ""} within the next 30 days.
                </span>
              )}{" "}
              Ask {staffName} for an up-to-date copy.
            </p>
          </div>
        )}

        {canManage && formOpen && (
          <UploadForm
            staffId={staffId}
            onClose={() => setFormOpen(false)}
          />
        )}

        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">
            The documents couldn't be loaded. Refresh to try again.
          </p>
        ) : docs.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <FolderLock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No documents on file</p>
            <p className="text-xs text-muted-foreground mb-3 max-w-xs mx-auto">
              {canManage
                ? "Keep their CV, passport, ID and signed contract here so nothing goes missing."
                : "Only the employer can add documents for this member."}
            </p>
            {canManage && !formOpen && (
              <Button variant="hero" size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="w-4 h-4" /> Upload a document
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                canManage={canManage}
                busy={downloadingId === doc.id}
                onOpen={() => open(doc)}
                onDelete={() => setDeleteTarget(doc)}
              />
            ))}
          </ul>
        )}

        {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span> and its
              stored file are removed from {staffName}'s record. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteDoc.mutate(deleteTarget, {
                onSuccess: () => setDeleteTarget(null),
              })}
              disabled={deleteDoc.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDoc.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── One row ──────────────────────────────────────────────────────────────────

function DocumentRow({
  doc, canManage, busy, onOpen, onDelete,
}: {
  doc: StaffDocument;
  canManage: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const Icon = DOC_ICONS[doc.docType] ?? FileIcon;
  const expiry = getDocExpiryStatus(doc);
  const size = humanSize(doc.sizeBytes);

  return (
    <li className="rounded-xl border border-border p-3 flex items-start gap-3">
      <span
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          expiry.state === "expired"
            ? "bg-destructive/10 text-destructive"
            : expiry.state === "expiring"
              ? "bg-warning/15 text-warning"
              : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="w-4 h-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          <Badge variant="outline" className="rounded-full text-[10px] font-normal">
            {STAFF_DOC_LABELS[doc.docType]}
          </Badge>
          {doc.fileName && (
            <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
              {doc.fileName}{size ? ` · ${size}` : ""}
            </span>
          )}
        </div>

        {/* Expiry is the headline, so it gets its own line and a colour. */}
        {expiry.state !== "none" && (
          <p
            className={cn(
              "text-[11px] mt-1 font-medium",
              expiry.state === "expired"
                ? "text-destructive"
                : expiry.state === "expiring"
                  ? "text-warning"
                  : "text-muted-foreground font-normal",
            )}
          >
            {expiry.state === "valid"
              ? `Valid until ${formatDay(`${doc.expiresOn}T00:00:00`)}`
              : `${expiry.label} · ${formatDay(`${doc.expiresOn}T00:00:00`)}`}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground mt-1">
          {doc.issuedOn ? `Issued ${formatDay(`${doc.issuedOn}T00:00:00`)} · ` : ""}
          Added {formatDay(doc.createdAt)}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpen}
          disabled={busy}
          aria-label={`Open ${doc.title}`}
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">{busy ? "Loading…" : "Open"}</span>
        </Button>
        {canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete ${doc.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

// ── Upload form ──────────────────────────────────────────────────────────────

function UploadForm({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const upload = useUploadStaffDocument(staffId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<StaffDocType>("cv");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [touched, setTouched] = useState(false);

  const handleFile = (chosen: File | null) => {
    // Clear the native input's value on every change, or picking the same file
    // again after an error fires no change event and the form looks frozen.
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (!chosen) {
      setFile(null);
      setFileError(null);
      return;
    }
    if (chosen.size > MAX_STAFF_DOC_BYTES) {
      // A real message with real numbers — not a limit that only exists in a
      // label and surfaces as a raw storage error after a long upload.
      setFile(null);
      setFileError(
        `${chosen.name} is ${humanSize(chosen.size)}. The limit is ${humanSize(MAX_STAFF_DOC_BYTES)} — try a smaller scan or a compressed PDF.`,
      );
      return;
    }
    setFile(chosen);
    setFileError(null);
    // Default the title to the file's name so nobody has to type one twice.
    if (!title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
  };

  const titleInvalid = touched && title.trim().length < 2;
  const dateInvalid = Boolean(issuedOn && expiresOn && expiresOn < issuedOn);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!file || title.trim().length < 2 || dateInvalid) return;

    upload.mutate(
      {
        file,
        title,
        docType,
        issuedOn: issuedOn || null,
        expiresOn: expiresOn || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-border bg-muted/30 p-3 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Add a document</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Cancel upload"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="staff-doc-file" className="text-xs text-muted-foreground">
          File <span className="text-muted-foreground/70">(max {humanSize(MAX_STAFF_DOC_BYTES)})</span>
        </Label>
        <Input
          id="staff-doc-file"
          ref={fileInputRef}
          type="file"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          onBlur={() => setTouched(true)}
          className="h-11 rounded-xl file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:text-primary-foreground"
        />
        {file && (
          <p className="text-[11px] text-muted-foreground truncate">
            {file.name} · {humanSize(file.size)}
          </p>
        )}
        {fileError && <p className="text-xs text-destructive">{fileError}</p>}
        {touched && !file && !fileError && (
          <p className="text-xs text-destructive">Choose a file to upload.</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="staff-doc-type" className="text-xs text-muted-foreground">Type</Label>
          <Select value={docType} onValueChange={(v) => setDocType(v as StaffDocType)}>
            <SelectTrigger id="staff-doc-type" className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_DOC_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-doc-title" className="text-xs text-muted-foreground">Title</Label>
          <Input
            id="staff-doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Passport — Abdirahman Hassan"
            maxLength={160}
            className="h-11 rounded-xl"
            aria-invalid={titleInvalid}
          />
          {titleInvalid && <p className="text-xs text-destructive">Give the document a title.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="staff-doc-issued" className="text-xs text-muted-foreground">
            Issued <span className="text-muted-foreground/70">(optional)</span>
          </Label>
          <Input
            id="staff-doc-issued"
            type="date"
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
            className="h-11 rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staff-doc-expires" className="text-xs text-muted-foreground">
            Expires <span className="text-muted-foreground/70">(optional)</span>
          </Label>
          <Input
            id="staff-doc-expires"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className={cn("h-11 rounded-xl", dateInvalid && "border-destructive")}
          />
        </div>
      </div>
      {dateInvalid ? (
        <p className="text-xs text-destructive">"Expires" must be after "Issued".</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Set an expiry on passports and IDs — they're flagged here 30 days before they lapse.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="hero"
          size="sm"
          disabled={upload.isPending || !file || titleInvalid || dateInvalid}
        >
          <FileUp className="w-4 h-4" />
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
      </div>
    </form>
  );
}
