"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { KnecPendingEntryRow, KnecBatchRow, KnecExamOption, KnecCbaWindowRow } from "@/app/(app)/integrations/_data";
import { CbaWindowsTable } from "@/components/integrations/cba-windows-table";
import {
  generateKnecCbaExportBatch,
  confirmKnecCbaExportBatch,
  resetKnecCbaExportItem,
  updateKnecSchoolCode,
  updateKnecCbaExportColumns,
  getKnecCbaExportRows,
  dismissKnecCbaWindowReminder,
  setKnecCbaRemindersEnabled,
} from "@/app/(app)/integrations/actions";
import type { KnecCbaWindowReminder, KnecCbaWindowUrgency } from "@/lib/knec-cba-window-reminders";
import { downloadXlsxFromObjectRows } from "@/lib/xlsx-export";
import { downloadCsvFromObjectRows } from "@/lib/csv-export";
import {
  buildKnecCbaExportSheetRows,
  withAllKnownColumns,
  KNEC_CBA_EXPORT_DEFAULT_COLUMNS,
  KNEC_CBA_EXPORT_COLUMN_DESCRIPTIONS,
  type KnecCbaExportColumn,
  type KnecCbaExportRowSource,
} from "@/lib/knec-cba-export-columns";

function sanitize(stub: string) {
  return stub.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

const URGENCY_TONE: Record<KnecCbaWindowUrgency, "danger" | "warning" | "info"> = {
  overdue: "danger",
  urgent: "danger",
  soon: "warning",
  upcoming: "info",
};

const URGENCY_LABEL: Record<KnecCbaWindowUrgency, string> = {
  overdue: "Deadline passed",
  urgent: "Due very soon",
  soon: "Coming up",
  upcoming: "Upcoming",
};

function formatDaysUntil(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

// Column set/labels/order are school-configurable (schools.knec_cba_export_columns) -- no
// official cba.knec.ac.ke upload template is publicly documented, so this is provisional by
// design and adjustable without a code change. CSV is the primary download (simplest, most
// universally importable format for an unknown target); .xlsx stays available as a fallback in
// case a school's KNEC contact says the portal wants a spreadsheet instead.
async function downloadKnecExportCsv(
  rows: KnecCbaExportRowSource[],
  columns: KnecCbaExportColumn[],
  knecSchoolCode: string | null,
  filenameStub: string,
) {
  const sheetRows = buildKnecCbaExportSheetRows(rows, columns, knecSchoolCode);
  await downloadCsvFromObjectRows(sheetRows, `${sanitize(filenameStub)}-provisional.csv`);
}

async function downloadKnecExportXlsx(
  rows: KnecCbaExportRowSource[],
  columns: KnecCbaExportColumn[],
  knecSchoolCode: string | null,
  filenameStub: string,
) {
  const sheetRows = buildKnecCbaExportSheetRows(rows, columns, knecSchoolCode);
  await downloadXlsxFromObjectRows(sheetRows, "CBA Export (Provisional)", `${sanitize(filenameStub)}-provisional.xlsx`);
}

export function KnecPanel({
  schoolName,
  knecSchoolCode,
  exportColumns,
  remindersEnabled,
  reminders,
  allWindows,
  exams,
  pendingEntries,
  batches,
}: {
  schoolName: string;
  knecSchoolCode: string | null;
  exportColumns: KnecCbaExportColumn[];
  remindersEnabled: boolean;
  reminders: KnecCbaWindowReminder[];
  allWindows: KnecCbaWindowRow[];
  exams: KnecExamOption[];
  pendingEntries: KnecPendingEntryRow[];
  batches: KnecBatchRow[];
}) {
  const router = useRouter();
  const [examId, setExamId] = useState<string>(exams[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchNotes, setBatchNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState(knecSchoolCode ?? "");
  const [codePending, setCodePending] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<KnecPendingEntryRow | null>(null);
  const [resetNotes, setResetNotes] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [draftColumns, setDraftColumns] = useState<KnecCbaExportColumn[]>(() => withAllKnownColumns(exportColumns));
  const [columnsPending, setColumnsPending] = useState(false);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [dismissingWindowId, setDismissingWindowId] = useState<string | null>(null);
  const [reminderTogglePending, setReminderTogglePending] = useState(false);

  const entriesForExam = useMemo(
    () => pendingEntries.filter((e) => e.exam_id === examId),
    [pendingEntries, examId],
  );
  const notSubmitted = useMemo(
    () => entriesForExam.filter((e) => e.status === "not_submitted"),
    [entriesForExam],
  );
  const included = useMemo(
    () => entriesForExam.filter((e) => e.status === "included_in_batch"),
    [entriesForExam],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => (s.size === notSubmitted.length ? new Set() : new Set(notSubmitted.map((r) => r.id))));
  }

  async function handleGenerate() {
    if (!examId) return;
    setGenerating(true);
    setError(null);
    const studentIds =
      selected.size > 0 ? Array.from(new Set(notSubmitted.filter((e) => selected.has(e.id)).map((e) => e.student_id))) : null;
    const result = await generateKnecCbaExportBatch(examId, null, studentIds, batchNotes);
    setGenerating(false);
    if ("error" in result) return setError(result.error);
    setSelected(new Set());
    setBatchNotes("");
    router.refresh();
  }

  async function handleDownload(batchId: string, format: "csv" | "xlsx") {
    setDownloadingId(batchId);
    const result = await getKnecCbaExportRows(batchId);
    setDownloadingId(null);
    if ("error" in result) return setError(result.error);
    const filenameStub = `${schoolName}-knec-cba-${batchId.slice(0, 8)}`;
    if (format === "csv") {
      await downloadKnecExportCsv(result.rows, exportColumns, knecSchoolCode, filenameStub);
    } else {
      await downloadKnecExportXlsx(result.rows, exportColumns, knecSchoolCode, filenameStub);
    }
  }

  async function handleConfirm(batchId: string) {
    setConfirmingId(batchId);
    await confirmKnecCbaExportBatch(batchId);
    setConfirmingId(null);
    router.refresh();
  }

  async function handleSaveCode() {
    setCodePending(true);
    await updateKnecSchoolCode(code);
    setCodePending(false);
    setCodeOpen(false);
    router.refresh();
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setDraftColumns((cols) => {
      const target = index + direction;
      if (target < 0 || target >= cols.length) return cols;
      const next = [...cols];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleColumn(index: number) {
    setDraftColumns((cols) => cols.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c)));
  }

  function relabelColumn(index: number, label: string) {
    setDraftColumns((cols) => cols.map((c, i) => (i === index ? { ...c, label } : c)));
  }

  function resetColumnsToDefault() {
    setDraftColumns(withAllKnownColumns(KNEC_CBA_EXPORT_DEFAULT_COLUMNS));
    setColumnsError(null);
  }

  async function handleSaveColumns() {
    if (!draftColumns.some((c) => c.enabled)) {
      setColumnsError("At least one column must be enabled.");
      return;
    }
    setColumnsPending(true);
    setColumnsError(null);
    const result = await updateKnecCbaExportColumns(draftColumns);
    setColumnsPending(false);
    if ("error" in result) return setColumnsError(result.error);
    setColumnsOpen(false);
    router.refresh();
  }

  async function handleDismissReminder(windowId: string) {
    setDismissingWindowId(windowId);
    await dismissKnecCbaWindowReminder(windowId);
    setDismissingWindowId(null);
    router.refresh();
  }

  async function handleToggleReminders() {
    setReminderTogglePending(true);
    await setKnecCbaRemindersEnabled(!remindersEnabled);
    setReminderTogglePending(false);
    router.refresh();
  }

  async function handleReset() {
    if (!resetTarget) return;
    setResetPending(true);
    await resetKnecCbaExportItem(resetTarget.id, resetNotes);
    setResetPending(false);
    setResetTarget(null);
    setResetNotes("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-eyebrow">Assessment window reminders</p>
            <p className="text-xs text-muted-foreground">
              KNEC-published CBA/SBA deadlines relevant to your grades — EduCore-authored operational data, not
              official KNEC content.
            </p>
          </div>
          <Button variant={remindersEnabled ? "outline" : "default"} size="sm" onClick={handleToggleReminders} disabled={reminderTogglePending}>
            {reminderTogglePending ? "Updating…" : remindersEnabled ? "Turn off" : "Turn on"}
          </Button>
        </div>

        {!remindersEnabled ? (
          <p className="text-sm text-muted-foreground">Reminders are off for this school.</p>
        ) : reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming KNEC CBA deadlines for your grades right now.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {reminders.map((r) => (
              <div key={r.window.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{r.window.title}</p>
                    <StatusBadge tone={URGENCY_TONE[r.urgency]} label={URGENCY_LABEL[r.urgency]} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDaysUntil(r.daysUntilClose)} — closes {new Date(r.window.closesAt).toLocaleDateString()}
                    {r.window.gradeLabels && r.window.gradeLabels.length > 0 ? ` · ${r.window.gradeLabels.join(", ")}` : ""}
                  </p>
                  {r.window.notes && <p className="mt-0.5 text-xs text-muted-foreground">{r.window.notes}</p>}
                  {r.window.sourceUrl && (
                    <a
                      href={r.window.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline underline-offset-2"
                    >
                      Source
                    </a>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDismissReminder(r.window.id)}
                  disabled={dismissingWindowId === r.window.id}
                >
                  {dismissingWindowId === r.window.id ? "Dismissing…" : "Dismiss"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <p className="label-eyebrow">Manage assessment windows</p>
          <p className="text-xs text-muted-foreground">
            Add the CBA/SBA deadlines your school needs to track, as KNEC publishes them via its own
            circulars/portal notices. Link a source where you can, so anyone can verify it directly.
          </p>
        </div>
        <CbaWindowsTable rows={allWindows} />
      </div>

      <div className="panel flex items-center justify-between p-4">
        <div>
          <p className="label-eyebrow">KNEC School Code</p>
          <p className="text-lg font-semibold">{knecSchoolCode || "Not set"}</p>
          <p className="text-xs text-muted-foreground">Ministry-issued 9-digit code used to log into cba.knec.ac.ke — set once.</p>
        </div>
        <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {knecSchoolCode ? "Edit" : "Set code"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>KNEC School Code</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="knec_code">Code</Label>
              <Input id="knec_code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} />
            </div>
            <DialogFooter>
              <Button onClick={handleSaveCode} disabled={codePending}>
                {codePending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="panel flex items-center justify-between p-4">
        <div>
          <p className="label-eyebrow">Export column layout</p>
          <p className="text-sm">
            {draftColumns.filter((c) => c.enabled).length} of {draftColumns.length} fields enabled
          </p>
          <p className="text-xs text-muted-foreground">
            Provisional — rename, reorder, or toggle columns to match whatever KNEC&apos;s real upload format turns
            out to need, without waiting for a code change.
          </p>
        </div>
        <Dialog
          open={columnsOpen}
          onOpenChange={(open) => {
            setColumnsOpen(open);
            if (open) setDraftColumns(withAllKnownColumns(exportColumns));
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Configure columns
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Configure export columns</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">
              Applies to every future CSV/Excel download from this school. Disabled fields are left out of the
              download entirely.
            </p>
            <div className="flex flex-col gap-2">
              {draftColumns.map((col, i) => (
                <div key={col.key} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <Checkbox checked={col.enabled} onCheckedChange={() => toggleColumn(i)} />
                  <div className="flex-1">
                    <Input
                      value={col.label}
                      onChange={(e) => relabelColumn(i, e.target.value)}
                      className="h-8"
                      aria-label={`Header label for ${col.key}`}
                    />
                    <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                      {KNEC_CBA_EXPORT_COLUMN_DESCRIPTIONS[col.key]}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      disabled={i === 0}
                      onClick={() => moveColumn(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      disabled={i === draftColumns.length - 1}
                      onClick={() => moveColumn(i, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {columnsError && <p className="text-sm text-danger">{columnsError}</p>}
            <DialogFooter className="justify-between sm:justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={resetColumnsToDefault}>
                Reset to defaults
              </Button>
              <Button onClick={handleSaveColumns} disabled={columnsPending}>
                {columnsPending ? "Saving…" : "Save layout"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {exams.length === 0 ? (
        <div className="panel p-4">
          <p className="text-sm text-muted-foreground">
            No CBC competency marks are waiting on a KNEC export yet. Record sub-strand competency marks for an exam
            first, then come back here.
          </p>
        </div>
      ) : (
        <>
          <div className="panel flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="label-eyebrow">Pending competency marks</p>
                <p className="text-sm text-muted-foreground">
                  {notSubmitted.length} not yet included in a KNEC export
                  {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={examId}
                  onValueChange={(v) => {
                    setExamId(v);
                    setSelected(new Set());
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {exams.map((ex) => (
                      <SelectItem key={ex.id} value={ex.id}>
                        {ex.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleGenerate} disabled={generating || notSubmitted.length === 0}>
                  {generating ? "Generating…" : selected.size > 0 ? `Generate export (${selected.size})` : "Generate export (all pending)"}
                </Button>
              </div>
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="space-y-1.5">
              <Label htmlFor="batch_notes">Notes (optional)</Label>
              <Textarea id="batch_notes" value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} rows={2} />
            </div>

            {notSubmitted.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No competency marks pending for this exam — everyone eligible has been exported.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox checked={selected.size === notSubmitted.length} onCheckedChange={toggleAll} />
                    </TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Learning Area</TableHead>
                    <TableHead>Sub-Strand</TableHead>
                    <TableHead>Level</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notSubmitted.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                      </TableCell>
                      <TableCell>
                        {e.student_name}
                        <span className="ml-1 text-xs text-muted-foreground">{e.admission_number}</span>
                      </TableCell>
                      <TableCell>{e.class_name}</TableCell>
                      <TableCell>{e.learning_area}</TableCell>
                      <TableCell>{e.sub_strand}</TableCell>
                      <TableCell>{e.competency_level}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {included.length > 0 && (
            <div className="panel flex flex-col gap-3 p-4">
              <p className="label-eyebrow">Awaiting confirmation</p>
              <p className="text-sm text-muted-foreground">
                Included in a generated export — confirm the export below once uploaded to cba.knec.ac.ke, or mark a
                single entry rejected here if the portal flagged just that one.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Sub-Strand</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {included.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.student_name}</TableCell>
                      <TableCell>{e.sub_strand}</TableCell>
                      <TableCell>{e.competency_level}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setResetTarget(e)}>
                          Mark rejected
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <Dialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reset {resetTarget?.student_name} — {resetTarget?.sub_strand}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset_notes">Reason (e.g. &quot;wrong band selected — corrected, re-exporting&quot;)</Label>
            <Textarea id="reset_notes" value={resetNotes} onChange={(e) => setResetNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button onClick={handleReset} disabled={resetPending}>
              {resetPending ? "Resetting…" : "Reset to pending"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="panel flex flex-col gap-3 p-4">
        <p className="label-eyebrow">Export history</p>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports generated yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generated</TableHead>
                <TableHead>Exam</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Entries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(b.generated_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{b.exam_name}</TableCell>
                  <TableCell>{b.student_count}</TableCell>
                  <TableCell>{b.entry_count}</TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={b.status === "confirmed" ? "success" : "warning"}
                      label={b.status === "confirmed" ? "Confirmed" : "Awaiting confirmation"}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.generated_by_name ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDownload(b.id, "csv")}
                        disabled={downloadingId === b.id}
                      >
                        {downloadingId === b.id ? "Preparing…" : "Download CSV"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(b.id, "xlsx")}
                        disabled={downloadingId === b.id}
                      >
                        Excel
                      </Button>
                      {b.status === "generated" && (
                        <Button size="sm" onClick={() => handleConfirm(b.id)} disabled={confirmingId === b.id}>
                          {confirmingId === b.id ? "Confirming…" : "Confirm submitted"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
