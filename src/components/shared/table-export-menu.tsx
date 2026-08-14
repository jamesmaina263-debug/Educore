"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// Generic Excel/PDF/CSV export for any single flat "register"-style table (Payroll, Invoices,
// Mark sheets, etc). Rows must already be flattened into plain label -> value pairs in the
// order they should appear as columns; this component doesn't know about domain shapes.
export interface TableExportMenuProps {
  /** Used to build the downloaded filename, e.g. "mvuke-academy-payroll-2026-08". Sanitized automatically. */
  filenameStub: string;
  /** Shown as the PDF document heading and the Excel sheet name. */
  title: string;
  /** One object per row; object key order determines column order. Values are already display-formatted. */
  rows: Record<string, string | number>[];
  /** Optional context line under the PDF title, e.g. "Mvuke Academy · Term 2, 2026". */
  subtitle?: string;
  size?: "sm" | "default";
}

function sanitize(stub: string) {
  return stub.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function toCSV(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV(rows: Record<string, string | number>[], filenameStub: string) {
  downloadBlob(toCSV(rows), `${sanitize(filenameStub)}.csv`, "text/csv;charset=utf-8;");
}

async function exportExcel(rows: Record<string, string | number>[], filenameStub: string, sheetName: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.slice(0, 31) || "Sheet1");
  XLSX.writeFile(wb, `${sanitize(filenameStub)}.xlsx`);
}

async function exportPDF(
  rows: Record<string, string | number>[],
  filenameStub: string,
  title: string,
  subtitle?: string,
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const doc = new jsPDF({ orientation: headers.length > 6 ? "landscape" : "portrait" });

  let y = 14;
  doc.setFontSize(14);
  doc.text(title, 14, y);
  y += 6;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(subtitle, 14, y);
    doc.setTextColor(0);
    y += 6;
  }

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows.map((r) => headers.map((h) => String(r[h] ?? ""))),
    theme: "grid",
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });

  doc.save(`${sanitize(filenameStub)}.pdf`);
}

export function TableExportMenu({ filenameStub, title, rows, subtitle, size = "sm" }: TableExportMenuProps) {
  const disabled = rows.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="outline" disabled={disabled}>
          <Download className="size-4" aria-hidden /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportCSV(rows, filenameStub)}>Export as CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportExcel(rows, filenameStub, title)}>Export as Excel</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPDF(rows, filenameStub, title, subtitle)}>Export as PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
