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
import type { KnecPendingEntryRow, KnecBatchRow, KnecExamOption } from "@/app/(app)/integrations/_data";
import {
  generateKnecCbaExportBatch,
  confirmKnecCbaExportBatch,
  resetKnecCbaExportItem,
  updateKnecSchoolCode,
  getKnecCbaExportRows,
} from "@/app/(app)/integrations/actions";
import { downloadXlsxFromObjectRows } from "@/lib/xlsx-export";

function sanitize(stub: string) {
  return stub.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

// PROVISIONAL column layout -- no official KNEC CBA upload template was found publicly (see
// the investigation report). This mirrors the shape a school would plausibly need
// (learner identity + sub-strand + competency level) and is clearly labeled as provisional in
// the UI and filename; adjust once KNEC publishes, or a school shares, the real template.
async function downloadKnecExport(
  rows: {
    upi_number: string;
    admission_number: string;
    first_name: string;
    last_name: string;
    other_names: string;
    class_name: string;
    learning_area: string;
    strand: string;
    sub_strand: string;
    competency_level: string;
  }[],
  filenameStub: string,
) {
  const sheetRows = rows.map((r) => ({
    UPI: r.upi_number,
    "Admission No": r.admission_number,
    "First Name": r.first_name,
    Surname: r.last_name,
    "Other Names": r.other_names,
    Class: r.class_name,
    "Learning Area": r.learning_area,
    Strand: r.strand,
    "Sub-Strand": r.sub_strand,
    "Competency Level": r.competency_level,
  }));
  await downloadXlsxFromObjectRows(sheetRows, "CBA Export (Provisional)", `${sanitize(filenameStub)}-provisional.xlsx`);
}

export function KnecPanel({
  schoolName,
  knecSchoolCode,
  exams,
  pendingEntries,
  batches,
}: {
  schoolName: string;
  knecSchoolCode: string | null;
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

  async function handleDownload(batchId: string) {
    setDownloadingId(batchId);
    const result = await getKnecCbaExportRows(batchId);
    setDownloadingId(null);
    if ("error" in result) return setError(result.error);
    await downloadKnecExport(result.rows, `${schoolName}-knec-cba-${batchId.slice(0, 8)}`);
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
                        onClick={() => handleDownload(b.id)}
                        disabled={downloadingId === b.id}
                      >
                        {downloadingId === b.id ? "Preparing…" : "Download"}
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
