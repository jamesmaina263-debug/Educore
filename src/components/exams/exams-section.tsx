"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createExam, closeExam, reopenExam } from "@/app/(app)/exams/actions";

export interface ExamRow {
  id: string;
  name: string;
  exam_type: string;
  status: "open" | "closed";
  term_id: string;
  term_name: string;
}

export interface TermOption {
  id: string;
  name: string;
}

export interface ClassOption {
  id: string;
  name: string;
}

export interface SubjectOption {
  id: string;
  name: string;
}

export function ExamsSection({
  exams,
  terms,
  classes,
  subjects,
  canWrite,
  hasGradingScale,
}: {
  exams: ExamRow[];
  terms: TermOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  canWrite: boolean;
  hasGradingScale: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState("");
  const [examType, setExamType] = useState<"cat" | "exam" | "mock" | "other">("cat");
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
  const [subjectMax, setSubjectMax] = useState<Record<string, string>>(
    Object.fromEntries(subjects.map((s) => [s.id, "100"])),
  );
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set());

  function toggleClass(id: string) {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSubject(id: string) {
    setSelectedSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    setPending(true);
    setError(null);
    const classIds = Array.from(selectedClasses);
    const subjectRows = classIds.flatMap((class_id) =>
      Array.from(selectedSubjects).map((subject_id) => ({
        class_id,
        subject_id,
        max_score: Number(subjectMax[subject_id] || "100"),
      })),
    );
    const result = await createExam({ term_id: termId, name, exam_type: examType, class_ids: classIds, subjects: subjectRows });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setName("");
    setSelectedClasses(new Set());
    setSelectedSubjects(new Set());
    router.refresh();
  }

  async function handleClose(examId: string) {
    setPending(true);
    const result = await closeExam(examId);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  async function handleReopen(examId: string) {
    setPending(true);
    const result = await reopenExam(examId);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {!hasGradingScale && (
        <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          No grading scale is configured yet — set one up under Grading Scales before marks can be entered.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{exams.length} exams this year</p>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                New exam
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>New exam</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label>Name</Label>
                    <Input placeholder="Mid-Term CAT 1" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={examType} onValueChange={(v) => setExamType(v as typeof examType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cat">CAT</SelectItem>
                        <SelectItem value="exam">Exam</SelectItem>
                        <SelectItem value="mock">Mock</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Term</Label>
                  <Select value={termId} onValueChange={setTermId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {terms.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Classes sitting this exam</Label>
                  <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
                    {classes.map((c) => (
                      <div key={c.id} className="flex items-center gap-1.5">
                        <Checkbox
                          id={`class-${c.id}`}
                          checked={selectedClasses.has(c.id)}
                          onCheckedChange={() => toggleClass(c.id)}
                        />
                        <Label htmlFor={`class-${c.id}`}>{c.name}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Subjects examined (max score applies across all selected classes)</Label>
                  <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                    {subjects.map((s) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`subject-${s.id}`}
                          checked={selectedSubjects.has(s.id)}
                          onCheckedChange={() => toggleSubject(s.id)}
                        />
                        <Label htmlFor={`subject-${s.id}`} className="flex-1">
                          {s.name}
                        </Label>
                        <Input
                          className="w-20"
                          type="number"
                          value={subjectMax[s.id] ?? "100"}
                          onChange={(e) => setSubjectMax((p) => ({ ...p, [s.id]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={pending || !name.trim() || !termId || selectedClasses.size === 0 || selectedSubjects.size === 0}
                >
                  {pending ? "Creating…" : "Create exam"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {exams.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
          No exams yet.
        </div>
      ) : (
        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Exam schedule</h2>
            <span className="text-[0.6875rem] text-muted-foreground">{exams.length} exams</span>
          </header>
          <div className="overflow-x-auto">
            <Table className="table-dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exams.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell>{e.term_name}</TableCell>
                    <TableCell className="uppercase">{e.exam_type}</TableCell>
                    <TableCell>
                      <StatusBadge tone={e.status === "open" ? "success" : "neutral"} label={e.status} />
                    </TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {e.status === "open" ? (
                        <>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/exams/${e.id}`}>Enter marks</Link>
                          </Button>
                          {canWrite && (
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleClose(e.id)}>
                              Close exam
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/exams/${e.id}`}>View marks</Link>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/exams/report-cards?exam=${e.id}`}>Report cards</Link>
                          </Button>
                          {canWrite && (
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleReopen(e.id)}>
                              Reopen
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
