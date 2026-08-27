"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Reviewers must be able to actually inspect an uploaded document — not just see a filename
// with a download button — before verifying, rejecting, or requesting a replacement. This
// renders images and PDFs inline via a short-lived signed URL (bucket is private; never a
// public link) instead of just handing back a bare link.
//
// storage_bucket must match wherever the file actually lives — see the storage_bucket column
// on `documents` (admission-origin documents live in 'application-documents' even after being
// reassigned to a student on enrollment; direct student/staff-portal uploads use
// 'student-documents' / 'staff-documents').
function isImage(fileName: string) {
  return /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName);
}
function isPdf(fileName: string) {
  return /\.pdf$/i.test(fileName);
}

export function DocumentPreviewButton({
  bucket,
  storagePath,
  fileName,
  size = "sm",
  variant = "outline",
  label = "View",
}: {
  bucket: string;
  storagePath: string;
  fileName: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function openPreview() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setUrl(null);
    try {
      const supabase = createClient();
      const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error("Could not generate a preview link.");
      setUrl(data.signedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this document.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" size={size} variant={variant} onClick={openPreview}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setUrl(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{fileName}</DialogTitle>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          {url && isImage(fileName) && (
            // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not a static asset next/image can optimize
            <img src={url} alt={fileName} className="max-h-[75vh] w-full rounded-md border border-border object-contain" />
          )}
          {url && isPdf(fileName) && (
            <iframe src={url} title={fileName} className="h-[75vh] w-full rounded-md border border-border" />
          )}
          {url && !isImage(fileName) && !isPdf(fileName) && (
            <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              This file type can&apos;t be previewed inline.{" "}
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                Open in a new tab
              </a>
              .
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
