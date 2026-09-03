"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileUp, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadBlob, XLSX_MIME } from "@/lib/xlsx-export";
import { importSchoolData, downloadImportTemplateAction } from "@/app/(app)/settings/data-import-actions";
import {
  IMPORT_SHEET_ORDER,
  type ImportSheetName,
  type RawImportSheets,
  type ImportSheetResult,
} from "@/app/(app)/settings/data-import-shared";

const KNOWN_SHEETS = new Set<string>(IMPORT_SHEET_ORDER);

function normalizeSheetName(name: string): ImportSheetName | null {
  const trimmed = name.trim();
  for (const known of IMPORT_SHEET_ORDER) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return KNOWN_SHEETS.has(trimmed) ? (trimmed as ImportSheetName) : null;
}

// Unwraps exceljs's richer cell.value shapes down to a plain string, same approach
// as the timetable upload dialog (academics/timetable-upload-dialog.tsx).
function flattenCellValue(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === "object") {
    if ("result" in v) return flattenCellValue((v as { result: unknown }).result);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
  }
  return v === null || v === undefined ? "" : String(v);
}

/** Parses every recognized sheet tab in the uploaded workbook into header-keyed row objects. */
async function parseWorkbookToSheets(file: File): Promise<RawImportSheets> {
  const ExcelJS = await import("exceljs");
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const sheets: RawImportSheets = {};
  for (const ws of wb.worksheets) {
    const sheetName = normalizeSheetName(ws.name);
    if (!sheetName) continue; // ignore any extra/reference tabs the file might have

    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber] = flattenCellValue(cell.value).trim();
    });

    const rows: Record<string, string>[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, string> = {};
      let hasValue = false;
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;
        const val = flattenCellValue(cell.value);
        if (val !== "") hasValue = true;
        obj[header] = val;
      });
      if (hasValue) rows.push(obj);
    });
    sheets[sheetName] = rows;
  }
  return sheets;
}

export function DataImportPanel({ canImport }: { canImport: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [templatePending, setTemplatePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportSheetResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = async () => {
    setTemplatePending(true);
    try {
      const result = await downloadImportTemplateAction();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      downloadBlob(bytes.buffer, "educore-import-template.xlsx", XLSX_MIME);
    } finally {
      setTemplatePending(false);
    }
  };

  const handleFileSelected = (file: File) => {
    setError(null);
    setResults(null);
    startTransition(async () => {
      try {
        const sheets = await parseWorkbookToSheets(file);
        if (Object.values(sheets).every((rows) => !rows || rows.length === 0)) {
          setError(
            'No recognized data found. Sheet tabs must be named one of: ' +
              IMPORT_SHEET_ORDER.join(", ") +
              " — download the template for a starter file with the right tabs and headers.",
          );
          return;
        }
        const outcome = await importSchoolData(sheets);
        if ("error" in outcome) {
          setError(outcome.error);
          return;
        }
        setResults(outcome.sheets);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that file.");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  };

  if (!canImport) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        Data import is available to the school owner and principal accounts.
      </div>
    );
  }

  const totalOk = results?.reduce((n, s) => n + s.results.filter((r) => r.status === "ok").length, 0) ?? 0;
  const totalErrors = results?.reduce((n, s) => n + s.results.filter((r) => r.status === "error").length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-6">
        <div className="flex items-start gap-3">
          <FileUp className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="font-medium">Import data from another system</h2>
            <p className="text-sm text-muted-foreground">
              Migrating a school onto EduCore: upload one workbook with a tab per record type -- Academic Years,
              Terms, Classes, Streams, Subjects, Staff, Students, Guardians. Rows are matched and linked by name/
              admission number, so you can import in one pass or add to it later; re-uploading the same file updates
              existing records instead of duplicating them. Import in this order if uploading separate files: Academic
              Years → Terms → Classes → Streams → Subjects → Staff → Students → Guardians.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate} disabled={templatePending}>
            {templatePending ? "Preparing…" : "Download import template"}
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={pending}>
            <Upload className="size-4" aria-hidden />
            {pending ? "Importing…" : "Upload data (.xlsx)"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelected(file);
            }}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {results && (
        <div className="panel flex flex-col gap-4 p-6">
          <p className="text-sm font-medium">
            {totalOk} row{totalOk === 1 ? "" : "s"} imported, {totalErrors} error{totalErrors === 1 ? "" : "s"} —
            recorded in the Audit Log.
          </p>
          {results
            .filter((s) => s.results.length > 0)
            .map((sheet) => (
              <div key={sheet.sheet} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{sheet.sheet}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {sheet.results.map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {r.status === "ok" ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                      )}
                      <span className={r.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                        Row {r.rowNumber}: {r.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
