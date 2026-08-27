"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DocumentPreviewButton } from "@/components/document-preview-dialog";

export interface DocumentRow {
  id: string;
  category: string;
  file_name: string;
  storage_path: string;
  storage_bucket: string;
  created_at: string;
}

const STUDENT_CATEGORIES = [
  { value: "birth_certificate", label: "Birth certificate" },
  { value: "id_scan", label: "ID scan" },
  { value: "report_card", label: "Report card" },
  { value: "transfer_letter", label: "Transfer letter" },
  { value: "other", label: "Other" },
];

const STAFF_CATEGORIES = [
  { value: "contract", label: "Contract" },
  { value: "certificate", label: "Certificate" },
  { value: "qualification", label: "Qualification" },
  { value: "id_document", label: "ID document" },
  { value: "licence", label: "Licence" },
  { value: "other", label: "Other" },
];

interface DocumentsTabProps {
  ownerId: string;
  documents: DocumentRow[];
  canUpload: boolean;
  /** Which single-owner column this document set belongs to — matches the
   * documents table's "exactly one owner" constraint (student_id XOR staff_id). */
  ownerType: "student" | "staff";
}

export function DocumentsTab({ ownerId, documents, canUpload, ownerType }: DocumentsTabProps) {
  const router = useRouter();
  const categories = ownerType === "staff" ? STAFF_CATEGORIES : STUDENT_CATEGORIES;
  const bucket = ownerType === "staff" ? "staff-documents" : "student-documents";
  const ownerColumn = ownerType === "staff" ? "staff_id" : "student_id";

  const [category, setCategory] = useState(categories[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [{ data: schoolId }, { data: authData }] = await Promise.all([
        supabase.rpc("auth_school_id"),
        supabase.auth.getUser(),
      ]);
      const { data: me } = await supabase
        .from("school_users")
        .select("id")
        .eq("auth_user_id", authData.user!.id)
        .single();

      const path = `${schoolId}/${ownerId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("documents").insert({
        school_id: schoolId,
        [ownerColumn]: ownerId,
        category,
        file_name: file.name,
        storage_path: path,
        storage_bucket: bucket,
        uploaded_by: me!.id,
      });
      if (insertError) throw insertError;

      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the document.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{doc.category.replace("_", " ")}</Badge>
                <span>{doc.file_name}</span>
              </div>
              <DocumentPreviewButton
                bucket={doc.storage_bucket}
                storagePath={doc.storage_path}
                fileName={doc.file_name}
                variant="ghost"
              />
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <div className="flex items-end gap-2 border-t border-border pt-4">
          <div className="w-48">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button onClick={upload} disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
