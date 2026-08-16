"use client";

import { useState } from "react";
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
import { createAssignmentAction, gradeSubmissionAction, getSubmissionsAction } from "@/app/(app)/homework/actions";

export interface StreamOption {
  id: string;
  label: string;
}
export interface SubjectOption {
  id: string;
  name: string;
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
};

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

  const [gradingAssignment, setGradingAssignment] = useState<AssignmentRow | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, { grade: string; feedback: string }>>({});

  const visible = canWriteAny ? assignments : assignments.filter((a) => a.is_own || a.teacher_id === schoolUserId);

  async function handleCreate(formData: FormData) {
    setPending(true);
    setError(null);
    const res = await createAssignmentAction(formData);
    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setAddOpen(false);
    router.refresh();
  }

  async function openGrading(a: AssignmentRow) {
    setGradingAssignment(a);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                No assignments yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={!!gradingAssignment} onOpenChange={(open) => !open && setGradingAssignment(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{gradingAssignment?.title} — submissions</DialogTitle>
          </DialogHeader>
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
                <p className="mt-2 text-sm">{s.submission_text}</p>
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
