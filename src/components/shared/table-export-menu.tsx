"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { downloadXlsxFromObjectRows } from "@/lib/xlsx-export";

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
  /**
   * PDF only. School logo shown at the top-left of the PDF. If the image can't be loaded (bad URL,
   * blocked by CORS, offline) the PDF is still produced, just without the logo.
   */
  logoUrl?: string | null;
  /**
   * PDF only. Adds a sign-off block (printed name, signature and date lines) under the table.
   * `printedName` pre-fills the name line; leave it out to leave the line blank for handwriting.
   */
  signOff?: { heading: string; printedName?: string | null };
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
  await downloadXlsxFromObjectRows(rows, sheetName, `${sanitize(filenameStub)}.xlsx`);
}

interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

// Loads the logo through an <img> + canvas so any browser-supported format (PNG, JPEG, WebP)
// ends up as a PNG data URL jsPDF can embed. Resolves to null on ANY failure (network error,
// missing CORS headers tainting the canvas, timeout) so a logo problem can never block a download.
function loadLogo(url: string): Promise<LoadedLogo | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: LoadedLogo | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => finish(null), 5000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          if (!naturalW || !naturalH) return finish(null);
          const scale = Math.min(1, 300 / Math.max(naturalW, naturalH));
          const width = Math.max(1, Math.round(naturalW * scale));
          const height = Math.max(1, Math.round(naturalH * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(img, 0, 0, width, height);
          finish({ dataUrl: canvas.toDataURL("image/png"), width, height });
        } catch {
          finish(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = url;
    } catch {
      finish(null);
    }
  });
}

async function exportPDF(
  rows: Record<string, string | number>[],
  filenameStub: string,
  title: string,
  subtitle?: string,
  logoUrl?: string | null,
  signOff?: TableExportMenuProps["signOff"],
) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const logo = logoUrl ? await loadLogo(logoUrl) : null;

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const doc = new jsPDF({ orientation: headers.length > 6 ? "landscape" : "portrait" });

  let y = 14;
  let textX = 14;
  let headerBottom = 0;
  if (logo) {
    const logoH = 16;
    const logoW = Math.min(40, (logo.width / logo.height) * logoH);
    try {
      doc.addImage(logo.dataUrl, "PNG", 14, 10, logoW, logoH);
      textX = 14 + logoW + 4;
      headerBottom = 10 + logoH + 4;
    } catch {
      // Embedding failed -- carry on with a logo-less header.
    }
  }
  doc.setFontSize(14);
  doc.text(title, textX, y);
  y += 6;
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(subtitle, textX, y);
    doc.setTextColor(0);
    y += 6;
  }

  autoTable(doc, {
    startY: Math.max(y, headerBottom),
    head: [headers],
    body: rows.map((r) => headers.map((h) => String(r[h] ?? ""))),
    theme: "grid",
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
  });

  if (signOff) {
    const pageHeight = doc.internal.pageSize.getHeight();
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    const blockHeight = 38;
    let sy = finalY + 14;
    if (sy + blockHeight > pageHeight - 10) {
      doc.addPage();
      sy = 24;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(signOff.heading, 14, sy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lineStart = 40;
    const lineEnd = 120;
    const fields: { label: string; value?: string | null }[] = [
      { label: "Name:", value: signOff.printedName },
      { label: "Signature:" },
      { label: "Date:" },
    ];
    fields.forEach((f, i) => {
      const ly = sy + 12 + i * 10;
      doc.text(f.label, 14, ly);
      doc.setDrawColor(120);
      doc.line(lineStart, ly + 1, lineEnd, ly + 1);
      if (f.value) doc.text(f.value, lineStart + 1, ly - 0.5);
    });
  }

  doc.save(`${sanitize(filenameStub)}.pdf`);
}

export function TableExportMenu({ filenameStub, title, rows, subtitle, size = "sm", logoUrl, signOff }: TableExportMenuProps) {
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
        <DropdownMenuItem onClick={() => exportPDF(rows, filenameStub, title, subtitle, logoUrl, signOff)}>Export as PDF</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
