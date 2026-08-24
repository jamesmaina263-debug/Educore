"use client";

import { useState } from "react";
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
import type { NemisPendingStudentRow, NemisBatchRow } from "@/app/(app)/integrations/_data";
import {
  generateNemisBatch,
  confirmNemisBatch,
  resetStudentNemisStatus,
  updateNemisInstitutionCode,
  getNemisBatchExportRows,
} from "@/app/(app)/integrations/actions";
import { downloadXlsxFromObjectRows } from "@/lib/xlsx-export";

function sanitize(stub: string) {
  return stub.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

// Matches the field order in NEMIS's own learner bulk-upload template (Institutions module
// "Learner" upload) -- see migration comment for why this is a formatted export, not a
// direct API call.
async function downloadNemisExport(
  rows: {
    admission_number: string;
    upi_number: string;
    birth_certificate_number: string;
    first_name: string;
    last_name: string;
    other_names: string;
    date_of_birth: string;
    gender: string;
    class_name: string;
  }[],
  filenameStub: string,
) {
  const sheetRows = rows.map((r) => ({
    "Admission No": r.admission_number,
    UPI: r.upi_number,
    "Birth Cert No": r.birth_certificate_number,
    "First Name": r.first_name,
    "Surname": r.last_name,
    "Other Names": r.other_names,
    "Date of Birth": r.date_of_birth,
    Gender: r.gender,
    Class: r.class_name,
  }));
  await downloadXlsxFromObjectRows(sheetRows, "Learners", `${sanitize(filenameStub)}.xlsx`);
}

export function NemisPanel({
  schoolName,
  institutionCode,
  pendingStudents,
  includedStudents,
  batches,
}: {
  schoolName: string;
  institutionCode: string | null;
  pendingStudents: NemisPendingStudentRow[];
  includedStudents: NemisPendingStudentRow[];
  batches: NemisBatchRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchType, setBatchType] = useState<"new_admissions" | "full_roster">("new_admissions");
  const [batchNotes, setBatchNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState(institutionCode ?? "");
  const [codePending, setCodePending] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<NemisPendingStudentRow | null>(null);
  const [resetNotes, setResetNotes] = useState("");
  const [resetPending, setResetPending] = useState(false);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => (s.size === pendingStudents.length ? new Set() : new Set(pendingStudents.map((r) => r.id))));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const ids = selected.size > 0 ? Array.from(selected) : null;
    const result = await generateNemisBatch(batchType, ids, batchNotes);
    setGenerating(false);
    if ("error" in result) return setError(result.error);
    setSelected(new Set());
    setBatchNotes("");
    router.refresh();
  }

  async function handleDownload(batchId: string) {
    setDownloadingId(batchId);
    const result = await getNemisBatchExportRows(batchId);
    setDownloadingId(null);
    if ("error" in result) return setError(result.error);
    await downloadNemisExport(result.rows, `${schoolName}-nemis-batch-${batchId.slice(0, 8)}`);
  }

  async function handleConfirm(batchId: string) {
    setConfirmingId(batchId);
    await confirmNemisBatch(batchId);
    setConfirmingId(null);
    router.refresh();
  }

  async function handleSaveCode() {
    setCodePending(true);
    await updateNemisInstitutionCode(code);
    setCodePending(false);
    setCodeOpen(false);
    router.refresh();
  }

  async function handleReset() {
    if (!resetTarget) return;
    setResetPending(true);
    await resetStudentNemisStatus(resetTarget.id, resetNotes);
    setResetPending(false);
    setResetTarget(null);
    setResetNotes("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex items-center justify-between p-4">
        <div>
          <p className="label-eyebrow">Institution code</p>
          <p className="text-lg font-semibold">{institutionCode || "Not set"}</p>
          <p className="text-xs text-muted-foreground">Ministry-issued 4-character NEMIS code — set once.</p>
        </div>
        <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              {institutionCode ? "Edit" : "Set code"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>NEMIS institution code</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="nemis_code">Code</Label>
              <Input id="nemis_code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} />
            </div>
            <DialogFooter>
              <Button onClick={handleSaveCode} disabled={codePending}>
                {codePending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-eyebrow">Pending students</p>
            <p className="text-sm text-muted-foreground">
              {pendingStudents.length} not yet included in a NEMIS batch
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={batchType} onValueChange={(v) => setBatchType(v as typeof batchType)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_admissions">New admissions</SelectItem>
                <SelectItem value="full_roster">Full roster</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleGenerate} disabled={generating || pendingStudents.length === 0}>
              {generating ? "Generating…" : selected.size > 0 ? `Generate batch (${selected.size})` : "Generate batch (all pending)"}
            </Button>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="batch_notes">Notes (optional)</Label>
          <Textarea id="batch_notes" value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} rows={2} />
        </div>

        {pendingStudents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students pending — everyone eligible has been submitted.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox checked={selected.size === pendingStudents.length} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Admission No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>UPI</TableHead>
                <TableHead>Birth Cert No</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingStudents.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                  </TableCell>
                  <TableCell>{s.admission_number}</TableCell>
                  <TableCell>{s.full_name}</TableCell>
                  <TableCell>{s.upi_number || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {s.missing_birth_cert ? (
                      <StatusBadge tone="warning" label="Missing" />
                    ) : (
                      s.birth_certificate_number
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {includedStudents.length > 0 && (
        <div className="panel flex flex-col gap-3 p-4">
          <p className="label-eyebrow">Awaiting Ministry confirmation</p>
          <p className="text-sm text-muted-foreground">
            In a generated batch — confirm the batch below once the Ministry portal accepts it, or reset a student
            here if that specific submission was rejected.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admission No</TableHead>
                <TableHead>Name</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {includedStudents.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.admission_number}</TableCell>
                  <TableCell>{s.full_name}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => setResetTarget(s)}>
                      Mark rejected
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset {resetTarget?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reset_notes">Reason (e.g. &quot;DOB mismatch — corrected, resubmitting&quot;)</Label>
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
        <p className="label-eyebrow">Batch history</p>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No batches generated yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generated</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Students</TableHead>
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
                  <TableCell className="capitalize">{b.batch_type.replace("_", " ")}</TableCell>
                  <TableCell>{b.student_count}</TableCell>
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
