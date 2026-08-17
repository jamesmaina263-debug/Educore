"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { bulkUploadTimetableAction, type TimetableUploadResult, type TimetableUploadRow } from "@/app/(app)/academics/actions";
import type { StreamRow, ClassRow, TeacherOption } from "./classes-streams-section";
import type { SubjectRow } from "./subjects-section";

// Canonical column keys the upload accepts, mapped from whatever header text is in
// row 1 of the uploaded file (case/spacing-insensitive). Everything else about
// resolving names to real records happens server-side in bulk_upsert_timetable_slots().
const HEADER_ALIASES: Record<string, keyof TimetableUploadRow> = {
  class: "class_name",
  classname: "class_name",
  "class name": "class_name",
  stream: "stream_name",
  streamname: "stream_name",
  "stream name": "stream_name",
  day: "day",
  "day of week": "day",
  period: "period_number",
  "period number": "period_number",
  periodnumber: "period_number",
  subject: "subject_name",
  "subject name": "subject_name",
  subjectname: "subject_name",
  teacher: "teacher_name",
  "teacher name": "teacher_name",
  teachername: "teacher_name",
  start: "start_time",
  "start time": "start_time",
  starttime: "start_time",
  end: "end_time",
  "end time": "end_time",
  endtime: "end_time",
};

function normalizeHeader(h: string): keyof TimetableUploadRow | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[key] ?? null;
}

// Excel stores a "Time"-formatted cell as a fraction of a day (e.g. 0.375 = 09:00).
// A plain-text cell like "9:00" or "9:00 AM" also needs normalizing to 24h "HH:MM".
function normalizeTime(v: unknown): string {
  if (typeof v === "number") {
    const frac = v - Math.floor(v);
    const totalMinutes = Math.round(frac * 24 * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`;
  m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let hh = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) hh += 12;
    return `${String(hh).padStart(2, "0")}:${m[2]}`;
  }
  return s; // pass through unrecognized text -- the server validates and reports a clear error
}

async function parseFileToRows(file: File): Promise<TimetableUploadRow[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return raw.map((rawRow) => {
    const row: Partial<TimetableUploadRow> = {};
    for (const [header, value] of Object.entries(rawRow)) {
      const key = normalizeHeader(header);
      if (!key) continue;
      row[key] = key === "start_time" || key === "end_time" ? normalizeTime(value) : String(value ?? "").trim();
    }
    return {
      class_name: row.class_name ?? "",
      stream_name: row.stream_name ?? "",
      day: row.day ?? "",
      period_number: row.period_number ?? "",
      subject_name: row.subject_name ?? "",
      teacher_name: row.teacher_name ?? "",
      start_time: row.start_time ?? "",
      end_time: row.end_time ?? "",
    };
  });
}

export async function downloadTimetableTemplate(streams: StreamRow[], classes: ClassRow[], subjects: SubjectRow[], teachers: TeacherOption[]) {
  const XLSX = await import("xlsx");
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  const firstStream = streams[0];
  const exampleClass = firstStream ? classNameById.get(firstStream.class_id) ?? "" : "1";
  const exampleStream = firstStream?.name ?? "North";
  const exampleSubject = subjects.find((s) => s.is_active)?.name ?? "English";
  const exampleTeacher = teachers[0]?.full_name ?? "Jane Wanjiku";

  const headers = ["Class", "Stream", "Day", "Period", "Subject", "Teacher", "Start Time", "End Time"];
  const exampleRow = [exampleClass, exampleStream, "Monday", 1, exampleSubject, exampleTeacher, "08:00", "08:40"];

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  XLSX.utils.book_append_sheet(wb, sheet, "Timetable");

  // Reference sheet: exact valid spellings to copy-paste from, since the upload matches
  // Class/Stream/Subject/Teacher names exactly (case-insensitive) against what's on file.
  const classStreamPairs = streams.map((s) => [classNameById.get(s.class_id) ?? "", s.name]);
  const subjectNames = subjects.filter((s) => s.is_active).map((s) => [s.name]);
  const teacherNames = teachers.map((t) => [t.full_name]);
  const maxLen = Math.max(classStreamPairs.length, subjectNames.length, teacherNames.length, 1);
  const refRows: (string | number)[][] = [["Class", "Stream", "", "Subject", "", "Teacher"]];
  for (let i = 0; i < maxLen; i++) {
    refRows.push([
      classStreamPairs[i]?.[0] ?? "",
      classStreamPairs[i]?.[1] ?? "",
      "",
      subjectNames[i]?.[0] ?? "",
      "",
      teacherNames[i]?.[0] ?? "",
    ]);
  }
  const refSheet = XLSX.utils.aoa_to_sheet(refRows);
  XLSX.utils.book_append_sheet(wb, refSheet, "Reference");

  XLSX.writeFile(wb, "timetable-template.xlsx");
}

export function TimetableUploadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TimetableUploadResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const rows = await parseFileToRows(file);
      if (rows.length === 0) {
        setError("No rows found in that file -- check it has a header row plus at least one data row.");
        return;
      }
      const result = await bulkUploadTimetableAction(rows);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setResults(result.results);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const okCount = results?.filter((r) => r.status === "ok").length ?? 0;
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setResults(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Upload timetable
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload timetable</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload a CSV or Excel file with columns Class, Stream, Day, Period, Subject, Teacher, Start Time, End
            Time -- one row per lesson, across as many classes and streams as you like. Use the &ldquo;Download
            template&rdquo; button next to Upload timetable to get a starter file with your real class, stream,
            subject, and teacher names.
          </p>
          <div className="space-y-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
              className="block w-full text-sm"
            />
            {pending && <p className="text-xs text-muted-foreground">Reading and uploading…</p>}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {results && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {okCount} added/updated{errorCount > 0 ? `, ${errorCount} skipped` : ""}
              </p>
              <div className="max-h-64 overflow-y-auto rounded border">
                <table className="w-full text-xs">
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.rowNumber} className={r.status === "error" ? "bg-danger/5" : ""}>
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">Row {r.rowNumber}</td>
                        <td className="px-2 py-1">
                          {r.status === "ok" ? (
                            <span className="text-success">✓ {r.message}</span>
                          ) : (
                            <span className="text-danger">✗ {r.message}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errorCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Fix the rows above in your spreadsheet and re-upload the file -- rows that already succeeded won&apos;t
                  be duplicated.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {results ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
