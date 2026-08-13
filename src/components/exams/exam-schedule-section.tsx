"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { saveExamSchedule, deleteExamSchedule } from "@/app/exams/actions";

export interface ExamScheduleRow {
  id: string;
  subject_id: string;
  subject_name: string;
  class_id: string;
  class_name: string;
  exam_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string | null;
}

export interface SubjectClassOption {
  key: string;
  subject_id: string;
  subject_name: string;
  class_id: string;
  class_name: string;
}

export function ExamScheduleSection({
  examId,
  schedules,
  options,
  canWrite,
}: {
  examId: string;
  schedules: ExamScheduleRow[];
  options: SubjectClassOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [examDate, setExamDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venue, setVenue] = useState("");

  async function handleSave() {
    const option = options.find((o) => o.key === selectedKey);
    if (!option) return;
    setPending(true);
    setError(null);
    const result = await saveExamSchedule({
      exam_id: examId,
      subject_id: option.subject_id,
      class_id: option.class_id,
      exam_date: examDate,
      start_time: startTime || undefined,
      end_time: endTime || undefined,
      venue: venue || undefined,
    });
    setPending(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    setSelectedKey("");
    setExamDate("");
    setStartTime("");
    setEndTime("");
    setVenue("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setPending(true);
    const result = await deleteExamSchedule(id);
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-[0.8125rem] font-semibold">Exam Timetable</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {schedules.length} session{schedules.length === 1 ? "" : "s"}
          </span>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                Schedule Session
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Schedule an Exam Session</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Subject &amp; Class</Label>
                  <Select value={selectedKey} onValueChange={setSelectedKey}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select subject and class" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.key} value={o.key}>
                          {o.subject_name} — {o.class_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Date</Label>
                    <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Start</Label>
                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End</Label>
                    <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Venue</Label>
                  <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="e.g. Hall A" />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={pending || !selectedKey || !examDate}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </header>
      {schedules.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">No exam sessions scheduled yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Subject</th>
                <th>Class</th>
                <th>Date</th>
                <th>Time</th>
                <th>Venue</th>
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.subject_name}</td>
                  <td className="text-muted-foreground">{s.class_name}</td>
                  <td className="text-muted-foreground">{s.exam_date}</td>
                  <td className="text-muted-foreground">
                    {s.start_time ? s.start_time.slice(0, 5) : "—"}
                    {s.end_time ? ` – ${s.end_time.slice(0, 5)}` : ""}
                  </td>
                  <td className="text-muted-foreground">{s.venue ?? "—"}</td>
                  {canWrite && (
                    <td className="text-right">
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => handleDelete(s.id)}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
