"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { downloadBlob } from "@/lib/xlsx-export";
import { CSV_MIME } from "@/lib/csv-export";
import { runCustomReport } from "@/app/(app)/exams/report-builder-actions";
import { LEARNER_COLUMNS, MARK_COLUMNS, MAX_REPORT_ROWS, type ReportDataset } from "@/lib/academics/custom-report";

const selectClass = "h-9 rounded-md border border-border bg-background px-2 text-sm";

export function ReportBuilderForm({
  streams,
  exams,
  canLearners,
  canMarks,
}: {
  streams: { id: string; label: string }[];
  exams: { id: string; label: string }[];
  canLearners: boolean;
  canMarks: boolean;
}) {
  const [dataset, setDataset] = useState<ReportDataset>(canLearners ? "learners" : "marks");
  const [selected, setSelected] = useState<Record<ReportDataset, string[]>>({
    learners: LEARNER_COLUMNS.map((c) => c.key),
    marks: MARK_COLUMNS.map((c) => c.key),
  });
  const [streamId, setStreamId] = useState("");
  const [examId, setExamId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const columns = dataset === "learners" ? LEARNER_COLUMNS : MARK_COLUMNS;

  async function run() {
    setPending(true);
    setMessage(null);
    const result = await runCustomReport({ dataset, columns: selected[dataset], streamId: streamId || null, examId: examId || null });
    setPending(false);
    if ("error" in result) return setMessage({ ok: false, text: result.error });
    downloadBlob(result.csv, `educore-${dataset}-report.csv`, CSV_MIME);
    setMessage({
      ok: true,
      text: result.truncated ? `Downloaded the first ${result.rows} rows (the limit is ${MAX_REPORT_ROWS}). Narrow the filter to get the rest.` : `Downloaded ${result.rows} rows.`,
    });
  }

  return (
    <div className="panel max-w-2xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Build a CSV of learners or exam marks with just the columns you need. You only see what your own access already allows. Marks include approved marks only.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor="rb-dataset">Report</Label>
        <select id="rb-dataset" className={selectClass} value={dataset} onChange={(e) => setDataset(e.target.value as ReportDataset)}>
          {canLearners && <option value="learners">Active learners</option>}
          {canMarks && <option value="marks">Exam marks (one row per learner per subject)</option>}
        </select>
      </div>

      {dataset === "learners" ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="rb-stream">Class (optional)</Label>
          <select id="rb-stream" className={selectClass} value={streamId} onChange={(e) => setStreamId(e.target.value)}>
            <option value="">All classes</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor="rb-exam">Exam</Label>
          <select id="rb-exam" className={selectClass} value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Choose an exam…</option>
            {exams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Columns</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {columns.map((c) => (
            <div key={c.key} className="flex items-center gap-2">
              <Checkbox
                id={`rb-${dataset}-${c.key}`}
                checked={selected[dataset].includes(c.key)}
                onCheckedChange={(v) =>
                  setSelected((s) => ({
                    ...s,
                    [dataset]: v === true ? columns.map((x) => x.key).filter((k) => k === c.key || s[dataset].includes(k)) : s[dataset].filter((k) => k !== c.key),
                  }))
                }
              />
              <Label htmlFor={`rb-${dataset}-${c.key}`} className="font-normal">
                {c.label}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {message.text}
        </p>
      )}
      <Button onClick={run} disabled={pending || selected[dataset].length === 0 || (dataset === "marks" && !examId)}>
        {pending ? "Building…" : "Download CSV"}
      </Button>
    </div>
  );
}
