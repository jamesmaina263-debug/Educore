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

export interface DocumentRow {
  id: string;
  category: string;
  file_name: string;
  storage_path: string;
  created_at: string;
}

export function DocumentsTab({
  studentId,
  documents,
  canUpload,
}: {
  studentId: string;
  documents: DocumentRow[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState("other");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

      const path = `${schoolId}/${studentId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("student-documents")
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("documents").insert({
        school_id: schoolId,
        student_id: studentId,
        category,
        file_name: file.name,
        storage_path: path,
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

  async function download(doc: DocumentRow) {
    setDownloadingId(doc.id);
    try {
      const supabase = createClient();
      // Signed, short-expiry URL — never a public bucket link (Part I).
      const { data, error: signError } = await supabase.storage
        .from("student-documents")
        .createSignedUrl(doc.storage_path, 60);
      if (signError || !data) throw signError ?? new Error("Could not generate a link.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the document.");
    } finally {
      setDownloadingId(null);
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => download(doc)}
                disabled={downloadingId === doc.id}
              >
                {downloadingId === doc.id ? "Opening…" : "View"}
              </Button>
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
                <SelectItem value="birth_certificate">Birth certificate</SelectItem>
                <SelectItem value="id_scan">ID scan</SelectItem>
                <SelectItem value="report_card">Report card</SelectItem>
                <SelectItem value="transfer_letter">Transfer letter</SelectItem>
                <SelectItem value="other">Other</SelectItem>
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
