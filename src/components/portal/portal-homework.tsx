"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  submitHomeworkAction,
  uploadSubmissionAttachmentAction,
  deleteSubmissionAttachmentAction,
  getAssignmentAttachmentUrlAction,
} from "@/app/portal/actions";
import { saveFileForOffline, openOfflineFile, listOfflineFiles } from "@/lib/offline/downloads";

export interface PortalAttachmentRow {
  id: string;
  file_name: string;
  storage_path: string;
  file_size: number | null;
}

export interface PortalAssignmentRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  subject_name: string;
  attachments: PortalAttachmentRow[];
  submission: {
    id: string;
    submission_text: string;
    status: "submitted" | "graded";
    grade: string | null;
    feedback: string | null;
    attachments: PortalAttachmentRow[];
  } | null;
}

/**
 * OS-03: reopen a previously-downloaded file straight from IndexedDB
 * (works with no network at all) -- otherwise fall back to the existing
 * live signed-URL flow, same as before this change.
 */
async function openDownload(storagePath: string, setError: (e: string | null) => void) {
  const offlineUrl = await openOfflineFile(storagePath);
  if (offlineUrl) {
    window.open(offlineUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const res = await getAssignmentAttachmentUrlAction(storagePath);
  if ("error" in res) {
    setError(res.error);
    return;
  }
  window.open(res.url, "_blank", "noopener,noreferrer");
}

/** OS-03: fetch the file once now (while online) and store it for offline reopening later. */
async function saveOffline(
  storagePath: string,
  fileName: string,
  setError: (e: string | null) => void,
  setSavedPaths: (updater: (prev: Set<string>) => Set<string>) => void,
) {
  const res = await getAssignmentAttachmentUrlAction(storagePath);
  if ("error" in res) {
    setError(res.error);
    return;
  }
  const saveRes = await saveFileForOffline(storagePath, fileName, null, res.url);
  if ("error" in saveRes) {
    setError(saveRes.error);
    return;
  }
  setSavedPaths((prev) => new Set(prev).add(storagePath));
}

function AttachmentRow({
  att,
  savedPaths,
  saving,
  setError,
  onSave,
  trailing,
}: {
  att: PortalAttachmentRow;
  savedPaths: Set<string>;
  saving: string | null;
  setError: (e: string | null) => void;
  onSave: (storagePath: string, fileName: string) => void;
  trailing?: ReactNode;
}) {
  const isSaved = savedPaths.has(att.storage_path);
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <button
        type="button"
        className="truncate text-left text-primary underline"
        onClick={() => openDownload(att.storage_path, setError)}
      >
        {att.file_name}
      </button>
      <span className="flex shrink-0 items-center gap-1">
        {isSaved ? (
          <span className="text-xs text-muted-foreground">Saved offline</span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={saving === att.storage_path}
            onClick={() => onSave(att.storage_path, att.file_name)}
          >
            {saving === att.storage_path ? "Saving…" : "Save offline"}
          </Button>
        )}
        {trailing}
      </span>
    </li>
  );
}

export function PortalHomeworkSection({ studentId, assignments }: { studentId: string; assignments: PortalAssignmentRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [savingOffline, setSavingOffline] = useState<string | null>(null);
  const [savedPaths, setSavedPaths] = useState<Set<string>>(new Set());
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    listOfflineFiles()
      .then((files) => setSavedPaths(new Set(files.map((f) => f.storage_path))))
      .catch(() => undefined);
  }, []);

  async function handleSaveOffline(storagePath: string, fileName: string) {
    setSavingOffline(storagePath);
    setError(null);
    await saveOffline(storagePath, fileName, setError, setSavedPaths);
    setSavingOffline(null);
  }

  async function submit(a: PortalAssignmentRow) {
    const text = drafts[a.id] ?? a.submission?.submission_text ?? "";
    const files = pendingFiles[a.id] ?? [];
    setSaving(a.id);
    setError(null);
    const res = await submitHomeworkAction(a.id, studentId, text, files.length > 0);
    if ("error" in res) {
      setSaving(null);
      setError(res.error);
      return;
    }
    for (const file of files) {
      const fd = new FormData();
      fd.set("file", file);
      const uploadRes = await uploadSubmissionAttachmentAction(res.submissionId, a.id, fd);
      if ("error" in uploadRes) {
        setError(`Submitted, but "${file.name}" failed to upload: ${uploadRes.error}`);
      }
    }
    setSaving(null);
    setPendingFiles((prev) => ({ ...prev, [a.id]: [] }));
    router.refresh();
  }

  async function addFileToExistingSubmission(submissionId: string, assignmentId: string, file: File) {
    setUploadingFor(submissionId);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadSubmissionAttachmentAction(submissionId, assignmentId, fd);
    setUploadingFor(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function removeFile(attachmentId: string) {
    setError(null);
    const res = await deleteSubmissionAttachmentAction(attachmentId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  if (assignments.length === 0) {
    return <p className="text-sm text-muted-foreground">No homework assigned yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {assignments.map((a) => (
        <div key={a.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {a.title} <span className="text-xs text-muted-foreground">({a.subject_name})</span>
            </p>
            <span className="text-xs text-muted-foreground">Due {a.due_date}</span>
          </div>
          {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}

          {a.attachments.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Assignment files</p>
              <ul className="flex flex-col gap-1">
                {a.attachments.map((att) => (
                  <AttachmentRow
                    key={att.id}
                    att={att}
                    savedPaths={savedPaths}
                    saving={savingOffline}
                    setError={setError}
                    onSave={handleSaveOffline}
                  />
                ))}
              </ul>
            </div>
          )}

          {a.submission ? (
            <div className="mt-2">
              <StatusBadge
                tone={a.submission.status === "graded" ? "success" : "neutral"}
                label={a.submission.status === "graded" ? `Graded${a.submission.grade ? `: ${a.submission.grade}` : ""}` : "Submitted"}
              />
              {a.submission.submission_text && <p className="mt-1 text-sm">{a.submission.submission_text}</p>}
              {a.submission.feedback && (
                <p className="mt-1 text-xs text-muted-foreground">Feedback: {a.submission.feedback}</p>
              )}
              {a.submission.attachments.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Your submitted files</p>
                  <ul className="flex flex-col gap-1">
                    {a.submission.attachments.map((att) => (
                      <AttachmentRow
                        key={att.id}
                        att={att}
                        savedPaths={savedPaths}
                        saving={savingOffline}
                        setError={setError}
                        onSave={handleSaveOffline}
                        trailing={
                          a.submission!.status === "submitted" ? (
                            <button
                              type="button"
                              onClick={() => removeFile(att.id)}
                              className="px-1 text-xs text-muted-foreground hover:text-danger"
                              aria-label="Remove file"
                            >
                              ×
                            </button>
                          ) : undefined
                        }
                      />
                    ))}
                  </ul>
                </div>
              )}
              {a.submission.status === "submitted" && (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground">You can still edit this before it&apos;s graded.</p>
                  <Input
                    ref={(el) => {
                      fileInputRefs.current[a.submission!.id] = el;
                    }}
                    type="file"
                    className="h-8"
                    disabled={uploadingFor === a.submission.id}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) addFileToExistingSubmission(a.submission!.id, a.id, file);
                      const ref = fileInputRefs.current[a.submission!.id];
                      if (ref) ref.value = "";
                    }}
                  />
                </div>
              )}
            </div>
          ) : null}

          {(!a.submission || a.submission.status === "submitted") && (
            <div className="mt-2 flex flex-col gap-2">
              <Textarea
                placeholder="Write your answer…"
                defaultValue={a.submission?.submission_text ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
              />
              {!a.submission && (
                <Input
                  type="file"
                  multiple
                  onChange={(e) => setPendingFiles((prev) => ({ ...prev, [a.id]: Array.from(e.target.files ?? []) }))}
                />
              )}
              <Button size="sm" onClick={() => submit(a)} disabled={saving === a.id}>
                {saving === a.id ? "Submitting…" : a.submission ? "Update submission" : "Submit"}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
