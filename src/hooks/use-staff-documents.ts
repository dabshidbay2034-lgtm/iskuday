import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppAuth } from "@/hooks/use-auth";
import { describeWriteError, pmsDb, useErrorToast } from "@/hooks/use-rent";
import { looseFrom } from "@/lib/supabase-loose";

/**
 * Staff document vault (migration 20260815000001).
 *
 * Each `hotel_staff` member gets a file: CV, passport, national ID, contract,
 * certificates, photo. Files live in the PRIVATE `staff-documents` bucket and
 * their metadata in `staff_documents`. Downloads go through a short-lived
 * signed URL — never a public URL — which storage RLS only issues to someone
 * who can already read the owning row.
 *
 * Authorization is entirely `public.hotel_staff_managed(staff_id)`: whoever may
 * manage the member may see and manage their paperwork. Staff members are
 * records kept by their employer, not accounts, so there is no self-service
 * path here (see the migration header for why nobody should add one).
 */

// ── Supabase access ──────────────────────────────────────────────────────────
// `staff_documents` post-dates the generated types (it only appears after
// `supabase gen types` runs against a database with 20260815000001 applied), so
// this module reads/writes through a loose accessor and narrows rows itself.
// Storage stays on the typed client — buckets don't need schema regeneration.

const BUCKET = "staff-documents";

/**
 * 10 MB. Enforced HERE as well as in the form, because a limit that only lives
 * in a label is not a limit — the user finds out it existed when a 60 MB scan
 * has finished uploading and the bucket rejects it with a raw error.
 */
export const MAX_STAFF_DOC_BYTES = 10 * 1024 * 1024;

// ── Domain types ─────────────────────────────────────────────────────────────

export type StaffDocType =
  | "cv"
  | "passport"
  | "national_id"
  | "contract"
  | "certificate"
  | "photo"
  | "other";

export const STAFF_DOC_TYPES: { value: StaffDocType; label: string }[] = [
  { value: "cv", label: "CV / Résumé" },
  { value: "passport", label: "Passport" },
  { value: "national_id", label: "National ID" },
  { value: "contract", label: "Contract" },
  { value: "certificate", label: "Certificate" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

export const STAFF_DOC_LABELS: Record<StaffDocType, string> = {
  cv: "CV / Résumé",
  passport: "Passport",
  national_id: "National ID",
  contract: "Contract",
  certificate: "Certificate",
  photo: "Photo",
  other: "Other",
};

export type StaffDocument = {
  id: string;
  staffId: string;
  title: string;
  docType: StaffDocType;
  fileName: string | null;
  filePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  issuedOn: string | null;
  expiresOn: string | null;
  uploadedBy: string | null;
  createdAt: string;
};

// ── Row mapper ───────────────────────────────────────────────────────────────

type RawStaffDoc = {
  id: string;
  staff_id: string;
  title?: string | null;
  doc_type?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  issued_on?: string | null;
  expires_on?: string | null;
  uploaded_by?: string | null;
  created_at?: string | null;
};

function toStaffDoc(row: RawStaffDoc): StaffDocument {
  return {
    id: row.id,
    staffId: row.staff_id,
    title: row.title ?? "Document",
    docType: (row.doc_type as StaffDocType) ?? "other",
    fileName: row.file_name ?? null,
    filePath: row.file_path ?? null,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes ?? null,
    // Postgres DATE can come back as a full timestamp depending on the driver;
    // slice to YYYY-MM-DD so `<input type="date">` and the expiry maths agree.
    issuedOn: row.issued_on ? String(row.issued_on).slice(0, 10) : null,
    expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
    uploadedBy: row.uploaded_by ?? null,
    createdAt: row.created_at ?? "",
  };
}

// ── Expiry ───────────────────────────────────────────────────────────────────
// Same shape as getLeaseStatus() in use-tenants.ts — an expiring passport is
// the same class of problem as an expiring lease, and the UI should read the
// same way.

/** An expiring document is worth chasing this far ahead. */
export const DOC_EXPIRY_WARNING_DAYS = 30;

export type DocExpiryState =
  | "none"      // no expiry recorded (a CV never expires)
  | "expired"   // the date has passed
  | "expiring"  // expires within DOC_EXPIRY_WARNING_DAYS
  | "valid";

export interface DocExpiryStatus {
  state: DocExpiryState;
  /** Negative once the document has lapsed. `null` when no expiry is set. */
  daysRemaining: number | null;
  label: string;
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days between today and an ISO date, both normalised to local midnight. */
function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function getDocExpiryStatus(
  doc: Pick<StaffDocument, "expiresOn"> | null | undefined,
): DocExpiryStatus {
  const expiresOn = doc?.expiresOn;
  if (!expiresOn || !ISO_DATE.test(expiresOn)) {
    return { state: "none", daysRemaining: null, label: "" };
  }

  const days = daysUntil(expiresOn);

  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      state: "expired",
      daysRemaining: days,
      label: overdue === 1 ? "Expired yesterday" : `Expired ${overdue} days ago`,
    };
  }
  if (days <= DOC_EXPIRY_WARNING_DAYS) {
    return {
      state: "expiring",
      daysRemaining: days,
      label:
        days === 0 ? "Expires today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`,
    };
  }
  return { state: "valid", daysRemaining: days, label: `Valid for ${days} days` };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Byte count as something a person reads. Blank for an unknown size. */
export function humanSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Called WITHOUT an argument this must return a 3-element PREFIX, not
 * `[..., undefined]`.
 *
 * TanStack matches partially by walking the filter array, so a 4-element
 * `["hotel-staff","documents","staff",undefined]` compares `undefined` against
 * the live key's staff id, mismatches, and invalidates NOTHING — the mutation
 * would toast success while the list kept showing stale rows. That exact bug
 * has shipped twice in this codebase (see payrollKey); don't make it three.
 */
export const staffDocumentsKey = (staffId?: string) =>
  staffId
    ? (["hotel-staff", "documents", "staff", staffId] as const)
    : (["hotel-staff", "documents", "staff"] as const);

/** Documents for one staff member, newest first. */
export function useStaffDocuments(staffId?: string) {
  const { isSignedIn } = useAppAuth();

  const query = useQuery({
    queryKey: staffDocumentsKey(staffId),
    enabled: Boolean(isSignedIn && staffId),
    queryFn: async (): Promise<StaffDocument[]> => {
      const { data, error } = await looseFrom("staff_documents")
        .select("*")
        .eq("staff_id", staffId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as RawStaffDoc[]) ?? []).map(toStaffDoc);
    },
  });

  useErrorToast(query.error, "Couldn't load staff documents");
  return query;
}

/**
 * A one-hour download URL for a document. NEVER a public URL — the bucket is
 * private precisely so a passport scan can't be reached by anyone holding the
 * path. Returns null when the caller has no access (storage RLS refuses to
 * sign) or when no file is stored, so callers can show a real message.
 */
export async function getStaffDocumentUrl(doc: StaffDocument): Promise<string | null> {
  if (!doc.filePath) return null;
  const { data, error } = await pmsDb.storage
    .from(BUCKET)
    .createSignedUrl(doc.filePath, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type UploadStaffDocInput = {
  file: File;
  title: string;
  docType: StaffDocType;
  issuedOn?: string | null;
  expiresOn?: string | null;
};

/** Upload a file to the private bucket and create its metadata row. */
export function useUploadStaffDocument(staffId?: string) {
  const { orgId, userId } = useAppAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UploadStaffDocInput): Promise<StaffDocument> => {
      if (!staffId) throw new Error("No staff member selected.");
      if (!userId) throw new Error("You must be signed in.");
      if (input.file.size > MAX_STAFF_DOC_BYTES) {
        throw new Error(
          `That file is ${humanSize(input.file.size)} — the limit is ${humanSize(MAX_STAFF_DOC_BYTES)}.`,
        );
      }

      // Unique object path inside the uploader's OWN folder. The first segment
      // must equal auth.sub or the storage INSERT policy rejects the upload.
      const safeName = input.file.name.replace(/[^\w.\- ]/g, "_");
      const objectPath = `${userId}/${crypto.randomUUID()}-${safeName}`;

      const { error: uploadError } = await pmsDb.storage
        .from(BUCKET)
        .upload(objectPath, input.file, {
          cacheControl: "3600",
          upsert: false,
          contentType: input.file.type || "application/octet-stream",
        });
      if (uploadError) throw uploadError;

      const { data, error } = await looseFrom("staff_documents")
        .insert({
          staff_id: staffId,
          owner_id: userId,
          org_id: orgId ?? null,
          title: input.title.trim(),
          doc_type: input.docType,
          file_name: input.file.name,
          file_path: objectPath,
          mime_type: input.file.type || null,
          size_bytes: input.file.size,
          issued_on: input.issuedOn || null,
          expires_on: input.expiresOn || null,
          uploaded_by: userId,
        })
        .select("*")
        .single();

      if (error) {
        // The object is already in the bucket but nothing points at it. Remove
        // it rather than leaking an unreachable — and unauditable — ID scan.
        await pmsDb.storage.from(BUCKET).remove([objectPath]);
        throw error;
      }

      return toStaffDoc(data as RawStaffDoc);
    },
    onSuccess: (doc) => {
      toast.success(`"${doc.title}" uploaded`);
      queryClient.invalidateQueries({ queryKey: staffDocumentsKey(staffId) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't upload the document")),
  });
}

/** Delete a document's metadata and (best-effort) its file. */
export function useDeleteStaffDocument(staffId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: StaffDocument) => {
      // Row first: if RLS refuses, the file is untouched and the vault is still
      // consistent. A stray object with no row is invisible; a row with no
      // object is a broken download.
      const { error } = await looseFrom("staff_documents").delete().eq("id", doc.id);
      if (error) throw error;
      if (doc.filePath) {
        await pmsDb.storage.from(BUCKET).remove([doc.filePath]);
      }
      return doc;
    },
    onSuccess: (doc) => {
      toast.success(`"${doc.title}" removed`);
      queryClient.invalidateQueries({ queryKey: staffDocumentsKey(staffId) });
    },
    onError: (error: unknown) =>
      toast.error(describeWriteError(error, "Couldn't delete the document")),
  });
}
