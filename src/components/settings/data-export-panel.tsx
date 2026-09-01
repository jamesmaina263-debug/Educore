"use client";

import { useState, useTransition } from "react";
import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildXlsxWorkbook, downloadBlob, XLSX_MIME, type XlsxSheetSpec } from "@/lib/xlsx-export";
import { exportSchoolData, type DataExportResult } from "@/app/(app)/settings/data-export-actions";

function filenameFor(data: DataExportResult): string {
  const slug = data.schoolName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `${slug}-data-export-${data.generatedAt.slice(0, 10)}.xlsx`;
}

export function DataExportPanel({ canExport }: { canExport: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<DataExportResult | null>(null);

  const handleExport = () => {
    setError(null);
    startTransition(async () => {
      const result = await exportSchoolData();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const sheets: XlsxSheetSpec[] = result.data.sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows }));
      const buffer = await buildXlsxWorkbook(sheets);
      downloadBlob(buffer, filenameFor(result.data), XLSX_MIME);
      setLastExport(result.data);
    });
  };

  if (!canExport) {
    return (
      <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
        Data export is available to the school owner account.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-6">
        <div className="flex items-start gap-3">
          <FileDown className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="font-medium">Export your school&apos;s data</h2>
            <p className="text-sm text-muted-foreground">
              Download an Excel workbook with your school&apos;s Students, Guardians, Staff, academic structure (Years,
              Terms, Classes, Streams, Subjects), Invoices, and Payments — the core operational record, for backup or
              portability. Module-specific reports (attendance, exam marks, and others) have their own exports
              elsewhere in each module.
            </p>
          </div>
        </div>
        <div>
          <Button onClick={handleExport} disabled={pending}>
            <Download className="size-4" aria-hidden />
            {pending ? "Preparing export…" : "Export all school data (.xlsx)"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {lastExport && !error && (
          <p className="text-sm text-muted-foreground">
            Downloaded {lastExport.sheets.length} sheets ({lastExport.sheets.reduce((n, s) => n + s.rows.length, 0)} rows
            total) — recorded in the Audit Log.
          </p>
        )}
      </div>
    </div>
  );
}
