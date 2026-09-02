"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  createAssignmentAction,
  gradeSubmissionAction,
  getSubmissionsAction,
  uploadAssignmentAttachmentAction,
  deleteAssignmentAttachmentAction,
  getAssignmentAttachmentUrlAction,
} from "@/app/(app)/homework/actions";

export interface StreamOption {
  id: string;
  label: string;
}
export interface SubjectOption {
  id: string;
  name: string;
}
export interface AttachmentRow {
  id: string;
  file_name: string;
  storage_path: string;
  file_size: number | null;
}
export interface AssignmentRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  stream_id: string;
  stream_label: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string | null;
  is_own: boolean;
  submitted_count: number;
  graded_count: number;
  attachments: AttachmentRow[];
}

type SubmissionRow = {
  id: string;
  submission_text: string;
  status: "submitted" | "graded";
  grade: string | null;
  feedback: string | null;
  submitted_at: string;
  student_name: string;
  admission_number: string;
  attachments: AttachmentRow[];
};

async function openDownload(storagePath: string, setError: (e: string | null) => void) {
  const res = await getAssignmentAttachmentUrlAction(storagePath);
  if ("error" in res) {
    setError(res.error);
    return;
  }
  window.open(res.url, "_blank", "noopener,noreferrer");
}

function AttachmentList({
  attachments,
  onDownload,
  onDelete,
  canManage,
}: {
  attachments: AttachmentRow[];
  onDownload: (path: string) => void;
  onDelete?: (id: string) => void;
  canManage?: boolean;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {attachments.map((att) => (
        <li key={att.id} className="flex items-center justify-between gap-2 text-sm">
          <button type="button" className="truncate text-left text-primary underline" onClick={() => onDownload(att.storage_path)}>
            {att.file_name}
          </button>
          {canManage && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(att.id)}
              className="px-1 text-xs text-muted-foreground hover:text-danger"
              aria-label="Remove file"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function HomeworkSection({
  assignments,
  streams,
  subjects,
  schoolUserId,
  canWriteAny,
}: {
  assignments: AssignmentRow[];
  streams: StreamOption[];
  subjects: SubjectOption[];
  schoolUserId: string | null;
  canWriteAny: boolean;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const newFilesInputRef = useRef<HTMLInputElement>(null);

  const [gradingAssignmentId, setGradingAssignmentId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, { grade: string; feedback: string }>>({});
  const [taskUploadPending, setTaskUploadPending] = useState(false);
  const taskFileInputRef = useRef<HTMLInputElement>(null);

  const visible = canWriteAny ? assignments : assignments.filter((a) => a.is_own || a.teacher_id === schoolUserId);
  const gradingAssignment = assignments.find((a) => a.id === gradingAssignmentId) ?? null;
  const canManageGrading = !!gradingAssignment && (canWriteAny || gradingAssignment.teacher_id === schoolUserId);

  async function handleCreate(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await createAssignmentAction({
      stream_id: String(formData.get("stream_id") ?? ""),
      subject_id: String(formData.get("subject_id") ?? ""),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      due_date: String(formData.get("due_date") ?? ""),
    });
    if ("error" in res) {
      setPending(false);
      setError(res.error);
      return;
    }
    for (const file of newFiles) {
      const fd = new FormData();
      fd.set("file", file);
      const uploadRes = await uploadAssignmentAttachmentAction(res.id, fd);
      if ("error" in uploadRes) {
        setError(`Assignment created, but "${file.name}" failed to upload: ${uploadRes.error}`);
      }
    }
    setPending(false);
    setNewFiles([]);
    setAddOpen(false);
    router.refresh();
  }

  async function openGrading(a: AssignmentRow) {
    setGradingAssignmentId(a.id);
    setLoadingSubmissions(true);
    const res = await getSubmissionsAction(a.id);
    setLoadingSubmissions(false);
    if ("error" in res) {
      setError(res.error ?? "Could not load submissions.");
      return;
    }
    setSubmissions(res.rows);
    const drafts: Record<string, { grade: string; feedback: string }> = {};
    for (const s of res.rows) drafts[s.id] = { grade: s.grade ?? "", feedback: s.feedback ?? "" };
    setGradeDrafts(drafts);
  }

  async function saveGrade(submissionId: string) {
    const draft = gradeDrafts[submissionId] ?? { grade: "", feedback: "" };
    const res = await gradeSubmissionAction(submissionId, draft.grade, draft.feedback);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? { ...s, status: "graded", grade: draft.grade, feedback: draft.feedback } : s)));
    router.refresh();
  }

  async function addTaskFile(file: File) {
    if (!gradingAssignmentId) return;
    setTaskUploadPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadAssignmentAttachmentAction(gradingAssignmentId, fd);
    setTaskUploadPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function removeTaskFile(attachmentId: string) {
    setError(null);
    const res = await deleteAssignmentAttachmentAction(attachmentId);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex justify-end">
        <Dialog
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o);
            if (!o) setNewFiles([]);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">New assignment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New assignment</DialogTitle>
            </DialogHeader>
            <form action={handleCreate} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select name="stream_id">
                  <SelectTrigger>
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {streams.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Select name="subject_id">
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea id="description" name="description" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due_date">Due date</Label>
                <Input id="due_date" name="due_date" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label>Task files (optional)</Label>
                <Input
                  ref={newFilesInputRef}
                  type="file"
                  multiple
                  onChange={(e) => setNewFiles(Array.from(e.target.files ?? []))}
                />
                {newFiles.length > 0 && (
                  <ul className="text-xs text-muted-foreground">
                    {newFiles.map((f) => (
                      <li key={f.name}>{f.name}</li>
                    ))}
                  </ul>
                )}
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Files</TableHead>
            <TableHead>Submissions</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.title}</TableCell>
              <TableCell>{a.stream_label}</TableCell>
              <TableCell>{a.subject_name}</TableCell>
              <TableCell>{a.due_date}</TableCell>
              <TableCell>
                {a.attachments.length > 0 ? (
                  <Badge variant="secondary">{a.attachments.length} file{a.attachments.length === 1 ? "" : "s"}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {a.graded_count}/{a.submitted_count} graded
                </Badge>
              </TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => openGrading(a)}>
                  View submissions
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                No assignments yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!gradingAssignmentId} onOpenChange={(open) => !open && setGradingAssignmentId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{gradingAssignment?.title} — submissions</DialogTitle>
          </DialogHeader>

          {gradingAssignment && (
            <div className="rounded-md border border-border/60 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Task files</p>
              <AttachmentList
                attachments={gradingAssignment.attachments}
                onDownload={(p) => openDownload(p, setError)}
                onDelete={canManageGrading ? removeTaskFile : undefined}
                canManage={canManageGrading}
              />
              {gradingAssignment.attachments.length === 0 && <p className="text-xs text-muted-foreground">No files attached.</p>}
              {canManageGrading && (
                <div className="mt-2">
                  <Input
                    ref={taskFileInputRef}
                    type="file"
                    className="h-8"
                    disabled={taskUploadPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) addTaskFile(file);
                      if (taskFileInputRef.current) taskFileInputRef.current.value = "";
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {loadingSubmissions && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loadingSubmissions && submissions.length === 0 && (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          )}
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            {submissions.map((s) => (
              <div key={s.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {s.student_name} <span className="text-xs text-muted-foreground">({s.admission_number})</span>
                  </p>
                  <StatusBadge tone={s.status === "graded" ? "success" : "neutral"} label={s.status} />
                </div>
                {s.submission_text && <p className="mt-2 text-sm">{s.submission_text}</p>}
                {s.attachments.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Submitted files</p>
                    <AttachmentList attachments={s.attachments} onDownload={(p) => openDownload(p, setError)} />
                  </div>
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Grade"
                    value={gradeDrafts[s.id]?.grade ?? ""}
                    onChange={(e) => setGradeDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], grade: e.target.value, feedback: prev[s.id]?.feedback ?? "" } }))}
                  />
                  <Input
                    placeholder="Feedback"
                    value={gradeDrafts[s.id]?.feedback ?? ""}
                    onChange={(e) => setGradeDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], feedback: e.target.value, grade: prev[s.id]?.grade ?? "" } }))}
                  />
                </div>
                <Button size="sm" className="mt-2" onClick={() => saveGrade(s.id)}>
                  Save grade
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
