import { useState } from "react";
import { Download, FileText, Plus, Trash2 } from "lucide-react";

import {
  formatDay,
  usePropertyAccess,
  useStaffNameLookup,
  type ManagedProperty,
} from "@/hooks/use-rent";
import {
  usePropertyLeaseDocuments,
  useDeleteLeaseDocument,
  getLeaseDocumentUrl,
  LEASE_DOC_LABELS,
  type LeaseDocumentRow,
} from "@/hooks/use-lease-documents";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LeaseDocumentDialog } from "./lease-document-dialog";

export function LeaseDocumentsCard({ property }: { property: ManagedProperty }) {
  const { canManageLeases: canManage, canViewLeases } = usePropertyAccess(property);
  const nameOf = useStaffNameLookup();

  const { data, isPending, isError } = usePropertyLeaseDocuments(property);
  const deleteDoc = useDeleteLeaseDocument(property);

  const docs = data ?? [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeaseDocumentRow | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [openUrls, setOpenUrls] = useState<Record<string, string>>({});

  if (!canViewLeases) return null;

  const download = async (doc: LeaseDocumentRow) => {
    if (openUrls[doc.id]) {
      window.open(openUrls[doc.id], "_blank", "noopener,noreferrer");
      return;
    }
    setDownloadingId(doc.id);
    setDownloadError(null);
    const url = await getLeaseDocumentUrl(doc);
    setDownloadingId(null);
    if (!url) {
      setDownloadError("You don't have access to this document, or it has no file.");
      return;
    }
    setOpenUrls((prev) => ({ ...prev, [doc.id]: url }));
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const humanSize = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              Lease documents
            </CardTitle>
            <CardDescription className="text-xs">
              Agreements, renewals and permits — stored privately
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="shrink-0"
            >
              <Plus className="w-4 h-4" /> Upload
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">
            Lease documents couldn't be loaded. Refresh to try again.
          </p>
        ) : docs.length === 0 ? (
          <div className="text-center py-8 rounded-xl border border-dashed border-border">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">No documents</p>
            <p className="text-xs text-muted-foreground mb-3">
              {canManage
                ? "Upload the signed lease to keep it on record."
                : "Only a manager or the assigned staff can upload."}
            </p>
            {canManage && (
              <Button variant="hero" size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="w-4 h-4" /> Upload a document
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="rounded-xl border border-border p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{doc.title}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <Badge variant="outline" className="rounded-full text-[10px] font-normal">
                      {LEASE_DOC_LABELS[doc.docType]}
                    </Badge>
                    {doc.fileName && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                        {doc.fileName}
                        {humanSize(doc.sizeBytes) ? ` · ${humanSize(doc.sizeBytes)}` : ""}
                      </span>
                    )}
                  </div>
                  {doc.startDate && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatDay(doc.startDate)}
                      {doc.endDate ? ` – ${formatDay(doc.endDate)}` : ""}
                      {" · "}{doc.uploadedBy ? nameOf(doc.uploadedBy) : "—"}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => download(doc)}
                    disabled={downloadingId === doc.id}
                    aria-label={`Download ${doc.title}`}
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">
                      {downloadingId === doc.id ? "Loading..." : "Open"}
                    </span>
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteTarget(doc)}
                      aria-label={`Delete ${doc.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
      </CardContent>

      {canManage && (
        <LeaseDocumentDialog
          property={property}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.title}</span> and its
              stored file will be removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteDoc.mutate(deleteTarget)}
              disabled={deleteDoc.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDoc.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}