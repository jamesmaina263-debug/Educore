"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveSubjectEnrolment,
  makeSubjectUniversal,
  previewCopyFromLastYear,
  applyCopyFromLastYear,
  type CopyPreviewSubject,
} from "@/app/(app)/academics/subject-enrolment-actions";
import type { EnrolmentStudent, EnrolmentSubject } from "@/app/(app)/academics/subject-enrolment/_data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function SubjectEnrolmentSection({
  classId,
  students,
  subjects,
  canEdit,
}: {
  classId: string;
  students: EnrolmentStudent[];
  subjects: EnrolmentSubject[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EnrolmentSubject | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyPreview, setCopyPreview] = useState<{ previousYearName: string; subjects: CopyPreviewSubject[] } | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? students.filter((s) => s.fullName.toLowerCase().includes(q) || (s.admissionNumber ?? "").toLowerCase().includes(q)) : students;
  }, [students, search]);

  function open(subject: EnrolmentSubject) {
    setEditing(subject);
    setPicked(new Set(subject.takingIds));
    setSearch("");
    setError(null);
  }

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function run(fn: () => ReturnType<typeof saveSubjectEnrolment>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function openCopy() {
    setCopyOpen(true);
    setCopyBusy(true);
    setCopyError(null);
    setCopyPreview(null);
    const res = await previewCopyFromLastYear({ classId });
    setCopyBusy(false);
    if ("error" in res) setCopyError(res.error);
    else setCopyPreview(res);
  }

  async function applyCopy() {
    if (!copyPreview) return;
    setCopyBusy(true);
    setCopyError(null);
    const res = await applyCopyFromLastYear({
      classId,
      subjectIds: copyPreview.subjects.filter((s) => s.status === "copy").map((s) => s.subjectId),
    });
    setCopyBusy(false);
    if ("error" in res) {
      setCopyError(res.error);
      return;
    }
    setCopyOpen(false);
    router.refresh();
  }

  if (students.length === 0) {
    return <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">This class has no active students yet.</div>;
  }
  if (subjects.length === 0) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        No subjects are assigned to this class yet — set them up under Teacher Allocation first.
      </div>
    );
  }

  return (
    <>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={openCopy}>
            Copy from last year
          </Button>
        </div>
      )}
      <div className="panel divide-y">
        {subjects.map((s) => (
          <div key={s.subjectId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.selective ? `${s.takingIds.length} of ${students.length} students take this` : `All ${students.length} students take this`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {s.selective ? <Badge variant="secondary">Selected students</Badge> : <Badge variant="outline">Everyone</Badge>}
              {s.selective && s.notSetIds.length > 0 && <Badge variant="outline">{s.notSetIds.length} not set</Badge>}
              {canEdit && (
                <Button size="sm" variant="outline" onClick={() => open(s)}>
                  Choose students
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && !busy && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.name} — who takes it?</DialogTitle>
            <DialogDescription>
              Tick the students who take this subject. Existing marks are never removed. Ticking everyone makes it a subject for the whole class again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input placeholder="Search name or admission no." value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(students.map((s) => s.id)))}>
              All
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              None
            </Button>
          </div>
          <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
            {visible.map((st) => {
              const notSet = editing?.selective && editing.notSetIds.includes(st.id);
              return (
                <label key={st.id} className="flex cursor-pointer items-center gap-3 p-2 text-sm">
                  <Checkbox checked={picked.has(st.id)} onCheckedChange={(v) => toggle(st.id, v === true)} />
                  <span className="flex-1">
                    {st.fullName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[st.admissionNumber, st.streamName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {notSet && <Badge variant="outline">Not set</Badge>}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{picked.size} of {students.length} selected</p>
          {picked.size === 0 && <p className="text-xs text-destructive">Nobody is selected: no student will be listed for mark entry in this subject.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:justify-between">
            {editing?.selective ? (
              <Button variant="ghost" disabled={busy} onClick={() => editing && run(() => makeSubjectUniversal({ classId, subjectId: editing.subjectId }))}>
                Make everyone take it
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={busy} onClick={() => editing && run(() => saveSubjectEnrolment({ classId, subjectId: editing.subjectId, takingStudentIds: [...picked] }))}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={(o) => !o && !copyBusy && setCopyOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy from last year</DialogTitle>
            <DialogDescription>
              Carries each student&apos;s subject choices over from the previous academic year. Subjects you have already set up for this class are never changed, and nothing is saved until you confirm.
            </DialogDescription>
          </DialogHeader>
          {copyBusy && !copyPreview && !copyError && <p className="text-sm text-muted-foreground">Reading last year&apos;s choices…</p>}
          {copyError && <p className="text-sm text-destructive">{copyError}</p>}
          {copyPreview && copyPreview.subjects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing to copy from {copyPreview.previousYearName}: either no choices were recorded for these subjects, everyone takes them, or you have already set them up.
            </p>
          )}
          {copyPreview && copyPreview.subjects.length > 0 && (
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
              {copyPreview.subjects.map((s) => (
                <div key={s.subjectId} className="flex flex-col gap-0.5 p-2">
                  <span className="font-medium">{s.subjectName}</span>
                  {s.status === "copy" ? (
                    <span className="text-xs text-muted-foreground">
                      {s.taking} of {students.length} will take it: {s.continuing} continuing
                      {s.unknown > 0 ? `, ${s.unknown} with no record last year (included)` : ""}; {s.dropped} did not take it last year.
                    </span>
                  ) : (
                    <span className="text-xs text-amber-700">Nobody took this last year, so it is left as it is. Set it by hand if needed.</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={copyBusy} onClick={() => setCopyOpen(false)}>
              Cancel
            </Button>
            <Button disabled={copyBusy || !copyPreview || !copyPreview.subjects.some((s) => s.status === "copy")} onClick={applyCopy}>
              {copyBusy && copyPreview ? "Copying…" : "Copy these choices"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
