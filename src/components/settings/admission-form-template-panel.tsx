"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  uploadAdmissionFormTemplate,
  deleteAdmissionFormTemplate,
  type AdmissionFormTemplateInfo,
} from "@/app/(app)/settings/admission-form/actions";

const PLACEHOLDER_TAGS = [
  "{{student_name}}",
  "{{guardian_name}}",
  "{{class_name}}",
  "{{term_name}}",
  "{{academic_year}}",
  "{{school_name}}",
  "{{application_number}}",
  "{{date}}",
  "{{fee_items}}",
  "{{fee_total}}",
];

export function AdmissionFormTemplatePanel({ initial, canWrite }: { initial: AdmissionFormTemplateInfo | null; canWrite: boolean }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return setError("Choose a file first — click \"Choose file\" above, then \"Upload template\".");
    setPending(true);
    setError(null);
    setSaved(false);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadAdmissionFormTemplate(formData);
    setPending(false);
    if ("error" in result) return setError(result.error);
    setSaved(true);
    setSelectedFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    const result = await deleteAdmissionFormTemplate();
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="panel max-w-xl space-y-4 p-5">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Admission form template</p>
        <p className="text-[0.8125rem] text-muted-foreground">
          Upload your own admission-form Word document, in your school&apos;s own layout and branding. When an online
          application is accepted, the system fills in that applicant&apos;s details and fee structure wherever these
          tags appear in your document, then emails it to the parent:
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {PLACEHOLDER_TAGS.map((tag) => (
            <code key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem]">
              {tag}
            </code>
          ))}
        </div>
      </div>

      {initial ? (
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <p className="text-[0.8125rem] font-medium">{initial.original_filename}</p>
            <p className="text-[0.75rem] text-muted-foreground">Uploaded {new Date(initial.uploaded_at).toLocaleDateString()}</p>
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={pending}>
              Remove
            </Button>
          )}
        </div>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">No template uploaded yet — acceptance emails won&apos;t include a form until one is set.</p>
      )}

      {canWrite && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <p className="text-[0.75rem] font-medium text-muted-foreground">Step 1 — choose a file</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => {
              setError(null);
              setSaved(false);
              setSelectedFileName(e.target.files?.[0]?.name ?? null);
            }}
          />
          <p className="text-[0.8125rem]">{selectedFileName ? `Selected: ${selectedFileName}` : "No file chosen yet."}</p>

          <p className="pt-1 text-[0.75rem] font-medium text-muted-foreground">Step 2 — upload it</p>
          {error && <p className="text-sm text-danger">{error}</p>}
          {saved && !error && <p className="text-sm text-success">Saved.</p>}
          <Button size="sm" onClick={handleUpload} disabled={pending || !selectedFileName}>
            {pending ? "Uploading…" : initial ? "Replace template" : "Upload template"}
          </Button>
        </div>
      )}
    </div>
  );
}
