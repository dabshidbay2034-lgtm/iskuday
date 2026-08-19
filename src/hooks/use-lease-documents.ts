import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { looseFrom } from "@/lib/supabase-loose";
import {
  describeWriteError,
  pmsDb,
  useErrorToast,
  useManageScope,
  type ManagedProperty,
} from "@/hooks/use-rent";

/**
 * Lease-document management for a property (20260806000001).
 *
 * Files are uploaded to the private `lease-documents` storage bucket and their
 * metadata lives in `lease_documents`. Downloads go through a short-lived signed
 * URL, which the storage read policy only issues to someone who can view the row
 * (org member / assigned staff / owner via is_assigned_staff()).
 *
 * Managing documents is manager-level for org staff (contracts are sensitive);
 * an assigned caretaker may still upload to the unit they manage.
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `lease_documents` isn't in the generated types until `supabase gen types`
// runs against a database with the 20260806000001 migration applied, so this
// module reads/writes it through a loose accessor and narrows rows itself.
// Storage stays on the typed client — buckets don't need schema regeneration.

// ── Domain types ─────────────────────────────────────────────────────────────

export type LeaseDocType =
  | "lease_agreement"
  | "renewal"
  | "identification"
  | "permit"
  | "other";

export const LEASE_DOC_TYPES: { value: LeaseDocType; label: string }[] = [
  { value: "lease_agreement", label: "Lease agreement" },
  { value: "renewal", label: "Renewal" },
  { value: "identification", label: "Tenant ID" },
  { value: "permit", label: "Permit/Licence" },
  { value: "other", label: "Other" },
];

export const LEASE_DOC_LABELS: Record<LeaseDocType, string> = {
  lease_agreement: "Lease agreement",
  renewal: "Renewal",
  identification: "Tenant ID",
  permit: "Permit/Licence",
  other: "Other",
};

export type LeaseDocumentRow = {
  id: string;
  propertyId: string;
  tenantId: string | null;
  title: string;
  docType: LeaseDocType;
  fileName: string | null;
  filePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  startDate: string | null;
  endDate: string | null;
  uploadedBy: string | null;
  createdAt: string;
};

// ── Row mapper ───────────────────────────────────────────────────────────────

type RawLeaseDoc = {
  id: string;
  property_id: string;
  tenant_id?: string | null;
  title?: string | null;
  doc_type?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  uploaded_by?: string | null;
  created_at?: string | null;
};

function toLeaseDoc(row: RawLeaseDoc): LeaseDocumentRow {
  return {
    id: row.id,
    propertyId: row.property_id,
    tenantId: row.tenant_id ?? null,
    title: row.title ?? "Document",
    docType: (row.doc_type as LeaseDocType) ?? "other",
    fileName: row.file_name ?? null,
    filePath: row.file_path ?? null,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes ?? null,
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : null,
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    uploadedBy: row.uploaded_by ?? null,
    createdAt: row.created_at ?? "",
  };
}

const BUCKET = "lease-documents";

// ── Query ────────────────────────────────────────────────────────────────────

export const leaseDocsKey = (propertyId?: string) =>
  ["manage", "lease-documents", "property", propertyId] as const;

/** Documents for one property, newest first. */
export function usePropertyLeaseDocuments(property?: ManagedProperty | null) {
  const scope = useManageScope();
  const propertyId = property?.id;

  const query = useQuery({
    queryKey: leaseDocsKey(propertyId),
    enabled: Boolean(scope.ready && propertyId),
    queryFn: async (): Promise<LeaseDocumentRow[]> => {
      const { data, error } = await looseFrom("lease_documents")
        .select("*")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toLeaseDoc);
    },
  });

  useErrorToast(query.error, "Couldn't load lease documents");
  return query;
}

/**
 * A short-lived download URL for a document. Returns null when the caller has no
 * access (storage RLS refuses the signed URL) or when no file is stored.
 * Callers should render a lightweight link/button that fetches this on demand.
 */
export async function getLeaseDocumentUrl(doc: LeaseDocumentRow): Promise<string | null> {
  if (!doc.filePath) return null;
  const { data, error } = await pmsDb.storage
    .from(BUCKET)
    .createSignedUrl(doc.filePath, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type UploadLeaseInput = {
  file: File;
  title: string;
  docType: LeaseDocType;
  tenantId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

/** Upload a file to storage and create its metadata row. */
export function useUploadLeaseDocument(property?: ManagedProperty | null) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();
  const propertyId = property?.id;

  return useMutation({
    mutationFn: async (input: UploadLeaseInput): Promise<LeaseDocumentRow> => {
      if (!propertyId) throw new Error("No property selected.");
      if (!userId) throw new Error("You must be signed in.");

      // Unique object path inside the uploader's own folder (matches the
      // storage INSERT policy: first folder = auth.sub).
      const safeGamename = input.file.name.replace(/[^\w.\- ]/g, "_");
      const objectPath = `${userId}/${crypto.randomUUID()}-${safeGamename}`;

      const { error: uploadError } = await pmsDb.storage
        .from(BUCKET)
        .upload(objectPath, input.file, {
          cacheControl: "3600",
          upsert: false,
          contentType: input.file.type || "application/octet-stream",
        });
      if (uploadError) throw uploadError;

      const { data, error } = await looseFrom("lease_documents")
        .insert({
          property_id: propertyId,
          org_id: orgId ?? null,
          tenant_id: input.tenantId || null,
          title: input.title.trim(),
          doc_type: input.docType,
          file_name: input.file.name,
          file_path: objectPath,
          mime_type: input.file.type || null,
          size_bytes: input.file.size,
          start_date: input.startDate || null,
          end_date: input.endDate || null,
          uploaded_by: userId,
        })
        .select("*")
        .single();

      if (error) {
        // Best-effort cleanup of the orphaned object so we don't leak files.
        await pmsDb.storage.from(BUCKET).remove([objectPath]);
        throw error;
      }

      return toLeaseDoc(data as RawLeaseDoc);
    },
    onSuccess: (doc) => {
      toast.success(`"${doc.title}" uploaded`);
      queryClient.invalidateQueries({ queryKey: leaseDocsKey(propertyId) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't upload the document")),
  });
}

/** Delete a document's metadata and (best-effort) its file. */
export function useDeleteLeaseDocument(property?: ManagedProperty | null) {
  const queryClient = useQueryClient();
  const propertyId = property?.id;

  return useMutation({
    mutationFn: async (doc: LeaseDocumentRow) => {
      const { error } = await looseFrom("lease_documents").delete().eq("id", doc.id);
      if (error) throw error;
      if (doc.filePath) {
        await pmsDb.storage.from(BUCKET).remove([doc.filePath]);
      }
      return doc;
    },
    onSuccess: (doc) => {
      toast.success(`"${doc.title}" removed`);
      queryClient.invalidateQueries({ queryKey: leaseDocsKey(propertyId) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't delete the document")),
  });
}