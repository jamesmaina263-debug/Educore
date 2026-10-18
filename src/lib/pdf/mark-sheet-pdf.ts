import type { CellDef, RowInput } from "jspdf-autotable";
import type { MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { MISSING } from "@/lib/academics/mark-sheet-model";

// Lays out a MarkSheetModel as a real, text-selectable PDF with jsPDF + jspdf-autotable (the same
// libraries the generic export already used; no new dependency). It does no calculation of its
// own. Everything printed comes from the model, so the PDF, Excel and CSV agree.

export interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

const NAVY: [number, number, number] = [30, 41, 59];
const GOLD: [number, number, number] = [202, 138, 4];
const MARGIN = 12;

function hexToRgb(hex: string | null): [number, number, number] {
  const m = hex?.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return NAVY;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const EXAM_TYPE_LABELS: Record<string, string> = { cat: "CAT", exam: "Exam", mock: "Mock", other: "Assessment" };

// "CAT 1" already says it is a CAT; only append the type when the name doesn't.
function assessmentTitle(model: MarkSheetModel): string {
  const typeLabel = EXAM_TYPE_LABELS[model.exam.examType] ?? model.exam.examType;
  return model.exam.name.toLowerCase().includes(typeLabel.toLowerCase()) ? model.exam.name : `${model.exam.name} (${typeLabel})`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export async function buildMarkSheetPdf(model: MarkSheetModel, logo: LoadedLogo | null) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const numeric = model.kind === "numeric" || model.kind === "mixed";
  const posCols = model.showRanking ? (model.multiStream ? 3 : 2) : 0; // Average + position(s)
  const columnCount = 3 + (model.multiStream ? 1 : 0) + model.subjects.length + (numeric ? 1 : 0) + posCols;
  // A4 portrait fits about 8 columns legibly; wider sheets go landscape.
  const doc = new jsPDF({ orientation: columnCount > 8 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const accent = hexToRgb(model.school.primaryColor);

  // ---- School header (first page) ----
  let textX = MARGIN;
  if (logo) {
    const logoH = 18;
    const logoW = Math.min(36, (logo.width / logo.height) * logoH);
    try {
      doc.addImage(logo.dataUrl, "PNG", MARGIN, 9, logoW, logoH);
      textX = MARGIN + logoW + 4;
    } catch {
      // Embedding failed; carry on with a logo-less header.
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...accent);
  doc.text(model.school.name, textX, 15);
  let hy = 15;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90);
  if (model.school.motto) {
    hy += 4.5;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.text(model.school.motto, textX, hy);
    doc.setFont("helvetica", "normal");
  }
  const contact = [model.school.address, model.school.phone, model.school.email].filter(Boolean).join("  ·  ");
  if (contact) {
    hy += 4.5;
    doc.setFontSize(8);
    doc.text(contact, textX, hy);
  }
  const ruleY = Math.max(hy + 4, 29);
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, ruleY, pageW - MARGIN, ruleY);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, ruleY + 1.2, pageW - MARGIN, ruleY + 1.2);

  // ---- Title + assessment details ----
  let y = ruleY + 8;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("CLASS MARK SHEET", MARGIN, y);
  if (model.provisional) {
    doc.setFontSize(8.5);
    doc.setTextColor(146, 64, 14);
    doc.text("PROVISIONAL: assessment not yet closed, positions are not final", pageW - MARGIN, y, { align: "right" });
    doc.setTextColor(0);
  }
  y += 5.5;
  const termYear = [model.exam.termName, model.exam.academicYearName].filter(Boolean).join(", ") || MISSING;
  const grading = model.kind === "numeric" ? "Marks-based" : model.kind === "cbc" ? "Competency-based (CBC)" : model.kind === "mixed" ? "Mixed marks and competency" : "No marks entered yet";
  const streams = [...new Set(model.learners.map((l) => l.streamName))];
  const left = [
    ["Assessment", assessmentTitle(model)],
    ["Term / Year", termYear],
    ["Grading", grading],
  ];
  const right = [
    ["Class", `${model.classLabel}${streams.length ? `  (${streams.join(", ")})` : ""}`],
    ["Learners", String(model.learners.length)],
    ["Generated", formatDate(model.generatedAt)],
  ];
  doc.setFontSize(8.5);
  left.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, MARGIN, y + i * 4.6);
    doc.setFont("helvetica", "normal");
    doc.text(v, MARGIN + 24, y + i * 4.6);
  });
  const rx = pageW / 2 + 4;
  right.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, rx, y + i * 4.6);
    doc.setFont("helvetica", "normal");
    doc.text(v, rx + 20, y + i * 4.6);
  });
  y += 3 * 4.6 + 2;

  // ---- Table ----
  const head = ["No", "Adm No", "Learner"];
  if (model.multiStream) head.push("Stream");
  for (const s of model.subjects) head.push(numeric ? `${s.name}\n/${s.maxScore}` : s.name);
  if (numeric) head.push("Total");
  if (model.showRanking) {
    head.push("Avg %");
    head.push(model.multiStream ? "Pos\n(stream)" : "Pos");
    if (model.multiStream) head.push("Pos\n(class)");
  }
  const body = model.learners.map((l) => {
    const row: string[] = [String(l.no), l.admissionNumber, l.incomplete && model.kind !== "empty" ? `${l.name} *` : l.name];
    if (model.multiStream) row.push(l.streamName);
    for (const s of model.subjects) row.push(l.cells[s.id].text);
    if (numeric) row.push(l.total === null ? MISSING : String(l.total));
    if (model.showRanking) {
      row.push(l.average === null ? MISSING : l.average.toFixed(2));
      row.push(l.rankInStream === null ? MISSING : String(l.rankInStream));
      if (model.multiStream) row.push(l.rankInClass === null ? MISSING : String(l.rankInClass));
    }
    return row;
  });

  // Class summary rows (foot): statistics for marks-based, band distribution for CBC.
  const labelSpan = 3 + (model.multiStream ? 1 : 0);
  const foot: RowInput[] = [];
  if (model.kind !== "empty") {
    // Cells after the subject columns: Total, then Avg and position(s) when ranking is shown.
    const trail = (avg?: string): string[] => [...(numeric ? [""] : []), ...(model.showRanking ? [avg ?? "", ...(model.multiStream ? ["", ""] : [""])] : [])];
    const mk = (label: string, perSubject: string[], avg?: string): CellDef[] => [
      { content: label, colSpan: labelSpan, styles: { halign: "right", fontStyle: "bold" } },
      ...perSubject.map((content): CellDef => ({ content })),
      ...trail(avg).map((content): CellDef => ({ content })),
    ];
    const stat = (pick: (st: (typeof model.subjectStats)[string]) => number | null) =>
      model.subjects.map((sub) => {
        const v = pick(model.subjectStats[sub.id]);
        return v === null ? MISSING : String(v);
      });
    if (numeric) {
      foot.push(mk("Class mean", stat((st) => st.mean), model.classMean === null ? undefined : String(model.classMean)));
      foot.push(mk("Highest", stat((st) => st.highest)));
      foot.push(mk("Lowest", stat((st) => st.lowest)));
    }
    if (model.kind === "cbc" || model.kind === "mixed") {
      foot.push(mk("Performance levels", model.subjects.map((sub) => model.subjectStats[sub.id].distribution.map((d) => `${d.code} ${d.count}`).join("  ") || MISSING)));
    }
    foot.push(mk("Marks entered", model.subjects.map((sub) => `${model.subjectStats[sub.id].entered}/${model.learners.length}`)));
  }

  const fontSize = columnCount > 12 ? 7 : 8;
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    foot,
    showHead: "everyPage",
    showFoot: "lastPage",
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 18 },
    styles: { fontSize, cellPadding: 1.3, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20, valign: "middle" },
    headStyles: { fillColor: accent, textColor: 255, halign: "center", fontStyle: "bold" },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, halign: "center", fontStyle: "normal" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { halign: "center", cellWidth: 9 },
      1: { halign: "left", cellWidth: 22 },
      2: { halign: "left", cellWidth: "auto" },
    },
    didParseCell: (data) => {
      const col = data.column.index;
      if (data.section === "head" && (col === 1 || col === 2)) data.cell.styles.halign = "left";
      if (data.section === "body") {
        if (col >= labelSpan) data.cell.styles.halign = "center";
        if (data.cell.text.join("") === MISSING) data.cell.styles.textColor = 130;
      }
      if (data.section === "foot" && col === 0) data.cell.styles.halign = "right";
    },
    // Running header on continuation pages so every page identifies itself.
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...accent);
        doc.text(`${model.school.name}  ·  Class Mark Sheet  ·  ${model.exam.name}  ·  ${model.classLabel}`, MARGIN, 10);
        doc.setTextColor(0);
      }
    },
  });

  // ---- Key and notes ----
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  let ny = (last?.finalY ?? y) + 6;
  const notes: string[] = [];
  if (model.legend.length) notes.push(`Key: ${model.legend.map((l) => `${l.code} = ${l.meaning}`).join(";  ")}`);
  notes.push(`${MISSING} = mark not yet entered. Missing marks are excluded from all statistics and are never counted as zero.`);
  if (model.incompleteCount > 0) notes.push(`* = results incomplete (fewer subjects entered than examined; ${model.incompleteCount} learner${model.incompleteCount === 1 ? "" : "s"}). Averages use entered subjects only.`);
  if (model.showRanking) notes.push(`Avg % = mean of each entered subject's score as a percentage of its maximum, so subjects with different maximums count equally. Position is by Avg %; learners with equal averages share a position${model.multiStream ? ". Stream position is within the stream, class position across all streams" : ""}.`);
  if (model.kind === "cbc") notes.push("Competency-based assessment: performance levels are descriptors, so no totals, averages or positions are calculated.");
  if (model.kind === "mixed") notes.push("This sheet mixes marks and competency levels, so no average or position is calculated.");
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(70);
  const wrapped = notes.flatMap((n) => doc.splitTextToSize(n, pageW - 2 * MARGIN) as string[]);
  const blockH = wrapped.length * 3.5 + 8 + 16;
  if (ny + blockH > pageH - 18) {
    doc.addPage();
    ny = 18;
  }
  doc.text(wrapped, MARGIN, ny);
  ny += wrapped.length * 3.5 + 8;

  // ---- Verification block (compact: one row per signatory) ----
  doc.setTextColor(0);
  doc.setFontSize(8.5);
  const fields = [
    { label: "Prepared by", value: model.preparedBy },
    { label: "Verified by (HOD / Deputy)", value: null },
  ];
  const colW = (pageW - 2 * MARGIN) / 2;
  fields.forEach((f, i) => {
    const x = MARGIN + i * colW;
    doc.setFont("helvetica", "bold");
    doc.text(f.label, x, ny);
    doc.setFont("helvetica", "normal");
    const ly = ny + 7;
    const seg = (colW - 6) / 3;
    ["Name:", "Signature:", "Date:"].forEach((lab, j) => {
      const sx = x + j * seg;
      doc.text(lab, sx, ly);
      doc.setDrawColor(120);
      doc.setLineWidth(0.2);
      const lx = sx + doc.getTextWidth(lab) + 1.5;
      doc.line(lx, ly + 1, sx + seg - 3, ly + 1);
      if (j === 0 && f.value) doc.text(doc.splitTextToSize(f.value, sx + seg - 3 - lx)[0] as string, lx + 0.5, ly - 0.5);
    });
  });

  // ---- Footer with page X of Y on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, pageH - 12, pageW - MARGIN, pageH - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(90);
    doc.text(`${model.school.name}  ·  ${model.exam.name}  ·  ${model.classLabel}`, MARGIN, pageH - 8);
    doc.text(`Generated ${formatDate(model.generatedAt)}   ·   Page ${p} of ${pages}`, pageW - MARGIN, pageH - 8, { align: "right" });
  }
  return doc;
}
