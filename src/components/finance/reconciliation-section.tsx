"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  importMpesaStatementAction,
  getMpesaStatementBatchLinesAction,
  recordUnallocatedPaymentAction,
  type MpesaStatementLineInput,
  type MpesaStatementImportSummary,
  type MpesaStatementLineRow,
} from "@/app/(app)/finance/actions";

export interface StatementBatchRow {
  id: string;
  source_label: string | null;
  total_lines: number;
  matched_count: number;
  mismatched_count: number;
  not_in_system_count: number;
  created_at: string;
}

// Statement column header aliases -- covers Safaricom's standard Paybill/Till statement export
// ("Receipt No.", "Completion Time", "Details", "Paid In", "Withdrawn") as well as simpler
// single-"Amount"-column exports some schools' banks/aggregators produce.
const HEADER_ALIASES: Record<string, string> = {
  receiptno: "receipt_no",
  "receiptno.": "receipt_no",
  receipt: "receipt_no",
  "receipt no": "receipt_no",
  "receipt no.": "receipt_no",
  mpesareceiptno: "receipt_no",
  "mpesa receipt no": "receipt_no",
  transactioncode: "receipt_no",
  completiontime: "transaction_time",
  "completion time": "transaction_time",
  transactiondate: "transaction_time",
  "transaction date": "transaction_time",
  date: "transaction_time",
  initiationtime: "transaction_time",
  "initiation time": "transaction_time",
  details: "details",
  description: "details",
  "other party info": "details",
  otherpartyinfo: "details",
  paidin: "paid_in",
  "paid in": "paid_in",
  creditamount: "paid_in",
  "credit amount": "paid_in",
  withdrawn: "withdrawn",
  debitamount: "withdrawn",
  "debit amount": "withdrawn",
  amount: "amount",
};

function normalizeHeader(h: string): string | null {
  const key = h.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIASES[key] ?? null;
}

function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowsFromRaw(raw: Record<string, unknown>[]): MpesaStatementLineInput[] {
  const out: MpesaStatementLineInput[] = [];
  for (const rawRow of raw) {
    const row: Record<string, unknown> = {};
    for (const [header, value] of Object.entries(rawRow)) {
      const key = normalizeHeader(header);
      if (!key) continue;
      row[key] = value;
    }
    const receiptNo = String(row.receipt_no ?? "").trim();
    if (!receiptNo) continue;

    // Prefer a dedicated "Paid In" column (standard Paybill export); fall back to a single
    // "Amount" column for simpler exports. Rows that are only a withdrawal (Paid In absent or
    // zero, but Withdrawn present) are not income and are skipped.
    const paidIn = parseMoney(row.paid_in);
    const withdrawn = parseMoney(row.withdrawn);
    const plainAmount = parseMoney(row.amount);

    let amount: number | null = null;
    if (paidIn !== null && paidIn > 0) amount = paidIn;
    else if (paidIn === null && withdrawn === null && plainAmount !== null && plainAmount > 0) amount = plainAmount;

    if (amount === null) continue;

    out.push({
      receipt_no: receiptNo,
      transaction_time: row.transaction_time ? String(row.transaction_time) : null,
      details: row.details ? String(row.details) : null,
      amount,
    });
  }
  return out;
}

async function parseCsv(file: File): Promise<MpesaStatementLineInput[]> {
  const Papa = (await import("papaparse")).default;
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  return rowsFromRaw(result.data);
}

async function parseXlsx(file: File): Promise<MpesaStatementLineInput[]> {
  const ExcelJS = await import("exceljs");
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const raw: Record<string, unknown>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) obj[header] = cell.value;
    });
    raw.push(obj);
  });
  return rowsFromRaw(raw);
}

async function parseFileToRows(file: File): Promise<MpesaStatementLineInput[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx")) return parseXlsx(file);
  if (name.endsWith(".xls")) {
    throw new Error("The old .xls format isn't supported -- please save the file as .xlsx or .csv and re-upload.");
  }
  throw new Error("Unrecognized file type -- please upload a .csv or .xlsx statement export.");
}

const STATUS_LABEL: Record<MpesaStatementLineRow["match_status"], string> = {
  matched: "Matched",
  amount_mismatch: "Amount mismatch",
  not_in_system: "Not in system",
};

function StatusBadge({ status }: { status: MpesaStatementLineRow["match_status"] }) {
  const variant = status === "matched" ? "default" : status === "amount_mismatch" ? "secondary" : "destructive";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}

export function ReconciliationSection({
  initialBatches,
  canWrite,
}: {
  initialBatches: StatementBatchRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState(initialBatches);
  const [summary, setSummary] = useState<MpesaStatementImportSummary | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [lines, setLines] = useState<MpesaStatementLineRow[] | null>(null);
  const [linesPending, setLinesPending] = useState(false);
  const [recording, setRecording] = useState<Record<string, boolean>>({});
  const [recorded, setRecorded] = useState<Record<string, boolean>>({});

  async function loadLines(batchId: string) {
    setActiveBatchId(batchId);
    setLinesPending(true);
    setLines(null);
    const result = await getMpesaStatementBatchLinesAction(batchId);
    setLinesPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setLines(result.lines);
  }

  async function handleFileSelected(file: File) {
    setPending(true);
    setError(null);
    setSummary(null);
    try {
      const rows = await parseFileToRows(file);
      if (rows.length === 0) {
        setError("No paid-in transaction rows found -- check the file has a Receipt No. column and at least one paid-in row.");
        return;
      }
      const result = await importMpesaStatementAction({ lines: rows, source_label: file.name });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setSummary(result.summary);
      setBatches((prev) => [
        {
          id: result.summary.batch_id,
          source_label: file.name,
          total_lines: result.summary.total_lines,
          matched_count: result.summary.matched_count,
          mismatched_count: result.summary.mismatched_count,
          not_in_system_count: result.summary.not_in_system_count,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      await loadLines(result.summary.batch_id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRecordUnallocated(line: MpesaStatementLineRow) {
    setRecording((prev) => ({ ...prev, [line.id]: true }));
    const result = await recordUnallocatedPaymentAction({
      method: "mpesa",
      amount: line.amount,
      reference: line.receipt_no,
      purpose: "Recorded from M-Pesa statement reconciliation",
      notes: line.details ?? undefined,
    });
    setRecording((prev) => ({ ...prev, [line.id]: false }));
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRecorded((prev) => ({ ...prev, [line.id]: true }));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="panel p-4">
        <p className="mb-1 text-sm font-semibold">Upload a Paybill statement</p>
        <p className="mb-3 text-sm text-muted-foreground">
          CSV or Excel export from Safaricom (or your bank/aggregator). Each &quot;paid in&quot; line is matched against
          payments already recorded in the system by M-Pesa receipt number.
        </p>
        {canWrite ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={pending}>
              {pending ? "Importing..." : "Upload statement"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">You don&apos;t have permission to import statements.</p>
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {summary && (
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">{summary.total_lines} rows</Badge>
            <Badge variant="default">{summary.matched_count} matched</Badge>
            <Badge variant="secondary">{summary.mismatched_count} amount mismatch</Badge>
            <Badge variant="destructive">{summary.not_in_system_count} not in system</Badge>
          </div>
        )}
      </div>

      {batches.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Recent statements</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Statement</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Mismatch</TableHead>
                <TableHead>Not in system</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.source_label ?? "Statement"}</TableCell>
                  <TableCell>{new Date(b.created_at).toLocaleString()}</TableCell>
                  <TableCell>{b.total_lines}</TableCell>
                  <TableCell>{b.matched_count}</TableCell>
                  <TableCell>{b.mismatched_count}</TableCell>
                  <TableCell>{b.not_in_system_count}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => loadLines(b.id)}>
                      View lines
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {activeBatchId && (
        <div>
          <p className="mb-2 text-sm font-semibold">Statement lines</p>
          {linesPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : lines && lines.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt No.</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.receipt_no}</TableCell>
                    <TableCell>{l.transaction_time ? new Date(l.transaction_time).toLocaleString() : "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{l.details ?? "—"}</TableCell>
                    <TableCell>{l.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.match_status} />
                    </TableCell>
                    <TableCell>
                      {l.match_status === "not_in_system" && canWrite && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={recording[l.id] || recorded[l.id]}
                          onClick={() => handleRecordUnallocated(l)}
                        >
                          {recorded[l.id] ? "Recorded" : recording[l.id] ? "Recording..." : "Record payment"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No lines in this statement.</p>
          )}
        </div>
      )}
    </div>
  );
}
