"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { AtRiskRow, TransportRouteCapacityRow, FeeForecast } from "./reports-section";

export interface AttendanceExportDay {
  date: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export interface ReportExportData {
  schoolName: string;
  generatedAt: string;
  filters: { term: string; stream: string; campus: string; from: string; to: string };
  summary: { label: string; value: string }[];
  atRisk: AtRiskRow[];
  transport: TransportRouteCapacityRow[];
  fee: FeeForecast | null;
  attendance: AttendanceExportDay[];
}

function toCSV(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: string | number) => {
    const s = String(v);
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

function filenameStub(data: ReportExportData) {
  return `${data.schoolName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-report-${data.generatedAt.slice(0, 10)}`;
}

async function exportCSV(data: ReportExportData) {
  const rows = data.atRisk.map((r) => ({
    Student: `${r.first_name} ${r.last_name}`,
    "Adm. No.": r.admission_number,
    "Attendance (30d)": r.attendance_rate_30d ?? "",
    "Latest exam avg": r.latest_exam_average ?? "",
    "Overdue balance": r.overdue_balance ?? "",
    Reasons: r.risk_reasons.join("; "),
  }));
  downloadBlob(toCSV(rows), `${filenameStub(data)}-at-risk.csv`, "text/csv;charset=utf-8;");
}

async function exportAttendanceCSV(data: ReportExportData) {
  const rows = data.attendance.map((d) => ({
    Date: d.date,
    Present: d.present,
    Absent: d.absent,
    Late: d.late,
    Total: d.total,
    "Attendance %": d.total > 0 ? Math.round((1000 * (d.present + d.late)) / d.total) / 10 : "",
  }));
  downloadBlob(toCSV(rows), `${filenameStub(data)}-attendance.csv`, "text/csv;charset=utf-8;");
}

async function exportExcel(data: ReportExportData) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(data.summary.map((s) => ({ Metric: s.label, Value: s.value })));
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  const atRiskSheet = XLSX.utils.json_to_sheet(
    data.atRisk.map((r) => ({
      Student: `${r.first_name} ${r.last_name}`,
      "Adm. No.": r.admission_number,
      "Attendance (30d) %": r.attendance_rate_30d ?? "",
      "Latest exam avg": r.latest_exam_average ?? "",
      "Overdue balance (KES)": r.overdue_balance ?? "",
      Reasons: r.risk_reasons.join("; "),
    })),
  );
  XLSX.utils.book_append_sheet(wb, atRiskSheet, "At-risk students");

  const transportSheet = XLSX.utils.json_to_sheet(
    data.transport.map((t) => ({
      Route: t.route_name,
      Capacity: t.capacity,
      Allocated: t.allocated,
      Available: t.available,
    })),
  );
  XLSX.utils.book_append_sheet(wb, transportSheet, "Transport capacity");

  const attendanceSheet = XLSX.utils.json_to_sheet(
    data.attendance.map((d) => ({
      Date: d.date,
      Present: d.present,
      Absent: d.absent,
      Late: d.late,
      Total: d.total,
      "Attendance %": d.total > 0 ? Math.round((1000 * (d.present + d.late)) / d.total) / 10 : "",
    })),
  );
  XLSX.utils.book_append_sheet(wb, attendanceSheet, "Attendance");

  XLSX.writeFile(wb, `${filenameStub(data)}.xlsx`);
}

async function exportPDF(data: ReportExportData) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF();
  let y = 14;
  doc.setFontSize(14);
  doc.text(`${data.schoolName} — Report`, 14, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(120);
  const filterLine = [
    data.filters.campus && `Campus: ${data.filters.campus}`,
    data.filters.term && `Term: ${data.filters.term}`,
    data.filters.stream && `Class: ${data.filters.stream}`,
    `${data.filters.from} to ${data.filters.to}`,
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(`Generated ${data.generatedAt}  ·  ${filterLine}`, 14, y);
  y += 6;
  doc.setTextColor(0);

  autoTable(doc, {
    startY: y,
    head: [["Metric", "Value"]],
    body: data.summary.map((s) => [s.label, s.value]),
    theme: "grid",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 41, 59] },
  });

  const afterSummaryY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  let nextY = afterSummaryY;
  if (data.atRisk.length > 0) {
    doc.setFontSize(11);
    doc.text("At-risk students", 14, nextY);
    autoTable(doc, {
      startY: nextY + 3,
      head: [["Student", "Adm. No.", "Attendance", "Exam avg", "Overdue", "Reasons"]],
      body: data.atRisk.map((r) => [
        `${r.first_name} ${r.last_name}`,
        r.admission_number,
        r.attendance_rate_30d != null ? `${r.attendance_rate_30d}%` : "—",
        r.latest_exam_average ?? "—",
        r.overdue_balance != null ? `KES ${Number(r.overdue_balance).toLocaleString()}` : "—",
        r.risk_reasons.join(", "),
      ]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    nextY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (data.attendance.length > 0) {
    doc.setFontSize(11);
    doc.text("Attendance by day", 14, nextY);
    autoTable(doc, {
      startY: nextY + 3,
      head: [["Date", "Present", "Absent", "Late", "Total", "Attendance %"]],
      body: data.attendance.map((d) => [
        d.date,
        String(d.present),
        String(d.absent),
        String(d.late),
        String(d.total),
        d.total > 0 ? `${Math.round((1000 * (d.present + d.late)) / d.total) / 10}%` : "—",
      ]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 41, 59] },
    });
  }

  doc.save(`${filenameStub(data)}.pdf`);
}

export function ReportsExportMenu({ data }: { data: ReportExportData }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="size-4" aria-hidden /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportCSV(data)}>Export at-risk table (CSV)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportAttendanceCSV(data)}>Export attendance (CSV)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportExcel(data)}>Export full report (Excel)</DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportPDF(data)}>Export full report (PDF)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
