"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { createTimetableSlot, deleteTimetableSlot, generateTimetableForStream } from "@/app/(app)/academics/actions";
import { TimetableUploadDialog, downloadTimetableTemplate } from "./timetable-upload-dialog";
import type { StreamRow } from "./classes-streams-section";
import type { ClassRow } from "./classes-streams-section";
import type { SubjectRow } from "./subjects-section";
import type { TeacherOption } from "./classes-streams-section";

export interface TimetableSlotRow {
  id: string;
  stream_id: string;
  subject_id: string;
  teacher_id: string;
  day_of_week: number; // ISO: 1=Monday..7=Sunday
  period_number: number;
  start_time: string;
  end_time: string;
}

const DAYS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
];

export function TimetableSection({
  streams,
  classes,
  subjects,
  teachers,
  slots,
  canWrite,
}: {
  streams: StreamRow[];
  classes: ClassRow[];
  subjects: SubjectRow[];
  teachers: TeacherOption[];
  slots: TimetableSlotRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [streamId, setStreamId] = useState(streams[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("1");
  const [period, setPeriod] = useState("1");
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateSummary, setGenerateSummary] = useState<string | null>(null);

  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const subjectNameById = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const activeSubjects = useMemo(() => subjects.filter((s) => s.is_active), [subjects]);
  const teacherNameById = useMemo(() => new Map(teachers.map((t) => [t.id, t.full_name])), [teachers]);

  const streamSlots = slots.filter((s) => s.stream_id === streamId);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createTimetableSlot({
        stream_id: streamId,
        subject_id: subjectId,
        teacher_id: teacherId,
        day_of_week: Number(day),
        period_number: Number(period),
        start_time: startTime,
        end_time: endTime,
      });
      if ("error" in result) return setError(result.error);
      setOpen(false);
      setSubjectId("");
      setTeacherId("");
      setStartTime("");
      setEndTime("");
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTimetableSlot(id);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleGenerate() {
    if (!streamId) return;
    setError(null);
    setGenerateSummary(null);
    setGenerating(true);
    startTransition(async () => {
      const result = await generateTimetableForStream(streamId);
      setGenerating(false);
      if ("error" in result) return setError(result.error);
      const { placed, unplacedSubjects, skippedSubjects } = result.summary;
      const parts = [`Placed ${placed} period(s).`];
      if (unplacedSubjects.length > 0) {
        parts.push(
          `Could not fully place: ${unplacedSubjects
            .map((u) => `${u.subject_name} (${u.placed}/${u.requested} — ${u.reason})`)
            .join(", ")}.`,
        );
      }
      if (skippedSubjects.length > 0) {
        parts.push(`Skipped (no periods/week set): ${skippedSubjects.join(", ")}.`);
      }
      setGenerateSummary(parts.join(" "));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="w-64 space-y-1.5">
          <Label>Stream</Label>
          <Select value={streamId} onValueChange={setStreamId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a stream" />
            </SelectTrigger>
            <SelectContent>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {classNameById.get(s.class_id) ?? ""} — {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canWrite && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => downloadTimetableTemplate(streams, classes, subjects, teachers)}
            >
              Download template
            </Button>
            <TimetableUploadDialog />
            {streamId && (
              <Button type="button" size="sm" variant="outline" disabled={generating} onClick={handleGenerate}>
                {generating ? "Generating…" : "Generate timetable"}
              </Button>
            )}
            {streamId && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    Add slot
                  </Button>
                </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add timetable slot</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Day</Label>
                    <Select value={day} onValueChange={setDay}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS.map((d) => (
                          <SelectItem key={d.value} value={String(d.value)}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Period number</Label>
                    <Input type="number" min={1} value={period} onChange={(e) => setPeriod(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Subject</Label>
                  <Select value={subjectId} onValueChange={setSubjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSubjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Teacher</Label>
                  <Select value={teacherId} onValueChange={setTeacherId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a teacher" />
                    </SelectTrigger>
                    <SelectContent>
                      {teachers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Start time</Label>
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End time</Label>
                    <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={pending || !subjectId || !teacherId || !startTime || !endTime}
                >
                  {pending ? "Adding…" : "Add slot"}
                </Button>
              </DialogFooter>
            </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </div>

      {error && !open && <p className="text-sm text-danger">{error}</p>}
      {generateSummary && <p className="text-sm text-muted-foreground">{generateSummary}</p>}

      {!streamId ? (
        <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
          No streams available. Create a class and stream first.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[40rem] grid-cols-5 gap-3">
          {DAYS.map((d) => {
            const daySlots = streamSlots
              .filter((s) => s.day_of_week === d.value)
              .sort((a, b) => a.period_number - b.period_number);
            return (
              <div key={d.value} className="flex flex-col gap-2">
                <p className="label-eyebrow">{d.label}</p>
                {daySlots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No classes</p>
                ) : (
                  daySlots.map((s) => (
                    <div key={s.id} className="panel p-2 text-xs">
                      <p className="font-medium">{subjectNameById.get(s.subject_id) ?? ""}</p>
                      <p className="text-muted-foreground">
                        {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                      </p>
                      <p className="text-muted-foreground">{teacherNameById.get(s.teacher_id) ?? ""}</p>
                      {canWrite && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-6 px-2 text-xs"
                          disabled={pending}
                          onClick={() => handleDelete(s.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}
