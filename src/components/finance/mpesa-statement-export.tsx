"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMpesaStatementAction } from "@/app/(app)/finance/payments/mpesa-statement-actions";
import { downloadBlob, buildXlsxWorkbook, XLSX_MIME } from "@/lib/xlsx-export";
import { buildCsv, CSV_MIME } from "@/lib/csv-export";
import type { MpesaStatementRow } from "@/lib/finance/get-mpesa-statement";

const STATUS_LABEL: Record<MpesaStatementRow["status"], string> = {
  confirmed: "Confirmed",
  recorded: "Recorded",
  reversed: "Reversed",
  unallocated: "Unallocated",
};

const HEADERS = ["Date", "M-Pesa Code", "Student Name", "Admission No", "Class", "Phone", "Amount (KES)", "Status"];

function toExportRow(r: MpesaStatementRow): Record<string, string | number> {
  return {
    Date: r.date,
    "M-Pesa Code": r.mpesaCode,
    "Student Name": r.studentName,
    "Admission No": r.admissionNumber,
    Class: r.className,
    Phone: r.phone,
    "Amount (KES)": r.amount,
    Status: STATUS_LABEL[r.status],
  };
}

/** Today's calendar date in Nairobi as YYYY-MM-DD (en-CA formats as ISO date). */
function nairobiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthRange(offsetMonths: number): { from: string; to: string } {
  const [y, m] = nairobiToday().split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(y, m + offsetMonths, 0));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { from: fmt(first), to: offsetMonths === 0 ? nairobiToday() : fmt(last) };
}

/**
 * Finance > Payments: download every M-Pesa payment recorded in a date range, with the
 * M-Pesa code and the student it was applied to. Read-only -- nothing is written.
 */
export function MpesaStatementExport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<"xlsx" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function setRange(range: { from: string; to: string }) {
    setFrom(range.from);
    setTo(range.to);
    setError(null);
    setMessage(null);
  }

  async function run(kind: "xlsx" | "csv") {
    setError(null);
    setMessage(null);
    if (!from || !to) {
      setError("Choose a start and end date first.");
      return;
    }
    setBusy(kind);
    try {
      const result = await getMpesaStatementAction(from, to);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.rows.length === 0) {
        setMessage("No M-Pesa payments were recorded in that date range.");
        return;
      }
      const filename = `mpesa-payments-statement-${from}_to_${to}`;
      const exportRows = result.rows.map(toExportRow);
      if (kind === "xlsx") {
        const buffer = await buildXlsxWorkbook([
          { name: "M-Pesa Payments", headers: HEADERS, rows: exportRows.map((r) => HEADERS.map((h) => r[h] ?? "")) },
        ]);
        downloadBlob(buffer, `${filename}.xlsx`, XLSX_MIME);
      } else {
        downloadBlob(await buildCsv(exportRows), `${filename}.csv`, CSV_MIME);
      }
      const extras = [
        result.reversedCount > 0 ? `${result.reversedCount} reversed (not counted in the total)` : null,
        result.unallocatedCount > 0 ? `${result.unallocatedCount} not yet allocated to a student` : null,
      ].filter(Boolean);
      setMessage(
        `Downloaded ${result.rows.length} payment${result.rows.length === 1 ? "" : "s"} totalling KES ${result.totalAmount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
          (extras.length > 0 ? ` -- ${extras.join(", ")}.` : "."),
      );
    } catch {
      setError("Could not generate the statement. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div>
        <p className="text-sm font-semibold">M-Pesa payments statement</p>
        <p className="text-xs text-muted-foreground">
          Every M-Pesa payment recorded in the date range, with the M-Pesa code, student name, admission number, class and
          phone. Dates are when each payment was recorded in EduCore.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="mpesa-statement-from" className="text-xs">
            From
          </Label>
          <Input
            id="mpesa-statement-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setMessage(null);
            }}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="mpesa-statement-to" className="text-xs">
            To
          </Label>
          <Input
            id="mpesa-statement-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setMessage(null);
            }}
            className="w-40"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRange({ from: nairobiToday(), to: nairobiToday() })}>
          Today
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setRange(monthRange(0))}>
          This month
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setRange(monthRange(-1))}>
          Last month
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy !== null} onClick={() => run("xlsx")}>
          {busy === "xlsx" ? "Preparing..." : "Download Excel"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => run("csv")}>
          {busy === "csv" ? "Preparing..." : "Download CSV"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  );
}
