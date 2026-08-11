"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { uploadStatusDocument } from "./actions";
import type { ApplicationStatusData } from "./actions";

export function StatusUploadSection({
  token,
  requirements,
}: {
  token: string;
  requirements: ApplicationStatusData["requirements"];
}) {
  const router = useRouter();
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(category: string) {
    const file = files[category];
    if (!file) return;
    setPendingCategory(category);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadStatusDocument(token, category, formData);
    setPendingCategory(null);
    if ("error" in result) return setError(result.error);
    setFiles((prev) => ({ ...prev, [category]: null }));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {requirements.map((req) => (
        <div key={req.category} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-medium">
              {req.label} {req.required && <span className="text-danger">*</span>}
            </p>
            {req.document ? (
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge
                  tone={req.document.verification_status === "verified" ? "success" : req.document.verification_status === "rejected" ? "danger" : "neutral"}
                  label={req.document.verification_status}
                />
                <span className="truncate text-[0.75rem] text-muted-foreground">{req.document.file_name}</span>
              </div>
            ) : (
              <p className="text-[0.75rem] text-muted-foreground">Not uploaded yet</p>
            )}
            {req.document?.verification_comment && req.document.verification_status === "rejected" && (
              <p className="mt-1 text-[0.75rem] text-danger">{req.document.verification_comment}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="w-40 text-[0.75rem]"
              onChange={(e) => setFiles((prev) => ({ ...prev, [req.category]: e.target.files?.[0] ?? null }))}
            />
            <Button size="sm" variant="outline" disabled={!files[req.category] || pendingCategory === req.category} onClick={() => handleUpload(req.category)}>
              {pendingCategory === req.category ? "Uploading…" : req.document ? "Replace" : "Upload"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
