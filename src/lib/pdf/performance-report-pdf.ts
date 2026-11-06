import type { jsPDF } from "jspdf";
import type { PerformanceReport, ReportChart } from "@/lib/academics/performance-report-model";
import { MARGIN, drawPageFooters, drawSchoolHeader, hexToRgb, type LoadedLogo, type PdfSchoolHeader } from "@/lib/pdf/pdf-common";

// Draws a PerformanceReport (see performance-report-model.ts) as a real, text-selectable A4 PDF with
// vector charts. Nothing is calculated here: every figure was produced by performance-analytics.ts and
// arrives pre-formatted, so the PDF can never disagree with the screen or the Excel export.

const PALETTE: [number, number, number][] = [
  [37, 99, 235],
  [22, 163, 74],
  [202, 138, 4],
  [220, 38, 38],
  [124, 58, 237],
  [8, 145, 178],
  [219, 39, 119],
  [101, 163, 13],
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const step = span <= 5 ? 1 : span <= 10 ? 2 : span <= 50 ? 10 : 20;
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

export function drawChart(doc: jsPDF, chart: ReportChart, x: number, y: number, w: number, h: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text(chart.title, x, y);

  const multi = chart.series.length > 1;
  const legendH = multi ? 5 : 0;
  const top = y + 3 + legendH;
  const left = x + 10;
  const plotW = w - 12;
  const plotH = h - 3 - legendH - 9;
  const yOf = (v: number) => top + plotH - ((v - chart.min) / Math.max(1e-9, chart.max - chart.min)) * plotH;

  if (chart.labels.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text("No data for the selected filters.", left, top + plotH / 2);
    doc.setTextColor(0);
    return;
  }

  if (multi) {
    let lx = left;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    chart.series.slice(0, 8).forEach((s, i) => {
      const [r, g, b] = PALETTE[i % PALETTE.length];
      doc.setFillColor(r, g, b);
      doc.rect(lx, y + 3.2, 2.4, 2.4, "F");
      doc.setTextColor(60);
      const name = clip(s.name, 16);
      doc.text(name, lx + 3.4, y + 5.2);
      lx += 5 + doc.getTextWidth(name) + 3;
    });
  }

  // grid + y axis
  doc.setDrawColor(220);
  doc.setLineWidth(0.15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(110);
  for (const t of niceTicks(chart.min, chart.max)) {
    const ty = yOf(t);
    doc.line(left, ty, left + plotW, ty);
    doc.text(`${t}${chart.unit === "%" ? "%" : ""}`, left - 1.5, ty + 1, { align: "right" });
  }

  const n = chart.labels.length;
  const slot = plotW / n;
  doc.setTextColor(60);
  chart.labels.forEach((label, i) => {
    doc.text(clip(label, Math.max(6, Math.floor(slot / 1.6))), left + slot * i + slot / 2, top + plotH + 4, { align: "center" });
  });

  if (chart.kind === "bar") {
    const k = chart.series.length;
    const barW = Math.min(14, (slot * 0.7) / k);
    chart.series.forEach((s, si) => {
      const [r, g, b] = PALETTE[si % PALETTE.length];
      doc.setFillColor(r, g, b);
      s.values.forEach((v, i) => {
        if (v === null) return;
        const bx = left + slot * i + slot / 2 - (barW * k) / 2 + barW * si;
        const by = yOf(Math.max(chart.min, v));
        doc.rect(bx, by, barW, top + plotH - by, "F");
        doc.setFontSize(6.5);
        doc.setTextColor(60);
        doc.text(String(v), bx + barW / 2, by - 0.8, { align: "center" });
      });
    });
  } else {
    chart.series.forEach((s, si) => {
      const [r, g, b] = PALETTE[si % PALETTE.length];
      doc.setDrawColor(r, g, b);
      doc.setFillColor(r, g, b);
      doc.setLineWidth(0.5);
      let prev: { px: number; py: number } | null = null;
      s.values.forEach((v, i) => {
        if (v === null) {
          prev = null; // a gap stays a gap: never joined through, never drawn as zero
          return;
        }
        const px = left + slot * i + slot / 2;
        const py = yOf(v);
        if (prev) doc.line(prev.px, prev.py, px, py);
        doc.circle(px, py, 0.9, "F");
        if (chart.series.length === 1) {
          doc.setFontSize(6.5);
          doc.setTextColor(60);
          doc.text(String(v), px, py - 1.8, { align: "center" });
        }
        prev = { px, py };
      });
    });
  }
  doc.setDrawColor(150);
  doc.setLineWidth(0.25);
  doc.line(left, top + plotH, left + plotW, top + plotH);
  doc.line(left, top, left, top + plotH);
  doc.setTextColor(0);
}

export async function buildPerformanceReportPdf(report: PerformanceReport, school: PdfSchoolHeader, logo: LoadedLogo | null) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const accent = hexToRgb(school.primaryColor);

  let y = drawSchoolHeader(doc, school, logo) + 8;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(report.title, MARGIN, y);
  y += 5.5;
  if (report.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80);
    doc.text(doc.splitTextToSize(report.subtitle, contentW), MARGIN, y);
    y += 5.5;
    doc.setTextColor(0);
  }

  // stat cards, 4 per row
  const perRow = 4;
  const cardW = (contentW - (perRow - 1) * 3) / perRow;
  const cardH = 13;
  report.stats.forEach((s, i) => {
    const col = i % perRow;
    if (col === 0 && i > 0) y += cardH + 3;
    const cx = MARGIN + col * (cardW + 3);
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, cardH, 1.2, 1.2, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(100);
    doc.text(clip(s.label, 28), cx + 2, y + 4.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(0);
    doc.text(clip(s.value, 26), cx + 2, y + 9.6);
  });
  y += cardH + 8;

  const chartH = 58;
  for (const chart of report.charts) {
    if (y + chartH > pageH - 18) {
      doc.addPage();
      y = MARGIN + 6;
    }
    drawChart(doc, chart, MARGIN, y, contentW, chartH);
    y += chartH + 6;
  }

  for (const table of report.tables) {
    if (table.rows.length === 0) continue;
    if (y > pageH - 40) {
      doc.addPage();
      y = MARGIN + 6;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(table.title, MARGIN, y);
    autoTable(doc, {
      startY: y + 2,
      head: [table.head],
      body: table.rows.map((r) => r.map(String)),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: accent, textColor: 255 },
      margin: { left: MARGIN, right: MARGIN },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 10) + 8;
  }

  if (report.notes.length > 0) {
    if (y > pageH - 30) {
      doc.addPage();
      y = MARGIN + 6;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90);
    for (const note of report.notes) {
      const lines = doc.splitTextToSize(note, contentW) as string[];
      doc.text(lines, MARGIN, y);
      y += lines.length * 3.6 + 1.5;
    }
  }

  drawPageFooters(doc, `${school.name} · ${report.title}`, new Date().toISOString());
  return doc;
}
