import type { CellDef, RowInput } from "jspdf-autotable";
import { MARGIN, drawPageFooters, drawSchoolHeader, drawSignatureBlock, formatDate, hexToRgb, type LoadedLogo } from "@/lib/pdf/pdf-common";
import type { MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import { MISSING, NOT_TAKEN, assessmentTitle as sharedAssessmentTitle, gradingLabel } from "@/lib/academics/mark-sheet-model";

// Lays out a MarkSheetModel as a real, text-selectable PDF with jsPDF + jspdf-autotable (the same
// libraries the generic export already used; no new dependency). It does no calculation of its
// own. Everything printed comes from the model, so the PDF, Excel and CSV agree.

export type { LoadedLogo };

function assessmentTitle(model: MarkSheetModel): string {
  return sharedAssessmentTitle(model.exam.name, model.exam.examType);
}

export async function buildMarkSheetPdf(model: MarkSheetModel, logo: LoadedLogo | null) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const numeric = model.kind === "numeric" || model.kind === "mixed";
  const posCols = (model.showAverage ? 1 : 0) + (model.showPositions ? (model.multiStream ? 2 : 1) : 0); // Average + position(s)
  const columnCount = 3 + (model.multiStream ? 1 : 0) + model.subjects.length + (numeric ? 1 : 0) + posCols;
  // A4 portrait fits about 8 columns legibly; wider sheets go landscape.
  const doc = new jsPDF({ orientation: columnCount > 8 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const accent = hexToRgb(model.school.primaryColor);

  // ---- School header (first page) ----
  const ruleY = drawSchoolHeader(doc, model.school, logo);

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
  const grading = gradingLabel(model.kind);
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
  if (model.showAverage) head.push("Avg %");
  if (model.showPositions) {
    head.push(model.multiStream ? "Pos\n(stream)" : "Pos");
    if (model.multiStream) head.push("Pos\n(class)");
  }
  const body = model.learners.map((l) => {
    const row: string[] = [String(l.no), l.admissionNumber, l.incomplete && model.kind !== "empty" ? `${l.name} *` : l.name];
    if (model.multiStream) row.push(l.streamName);
    for (const s of model.subjects) row.push(l.cells[s.id].text);
    if (numeric) row.push(l.total === null ? MISSING : String(l.total));
    if (model.showAverage) row.push(l.average === null ? MISSING : l.average.toFixed(2));
    if (model.showPositions) {
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
    const trail = (avg?: string): string[] => [...(numeric ? [""] : []), ...(model.showAverage ? [avg ?? ""] : []), ...(model.showPositions ? (model.multiStream ? ["", ""] : [""]) : [])];
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
    if (numeric && model.options.showClassStatistics) {
      foot.push(mk("Class mean", stat((st) => st.mean), model.classMean === null ? undefined : String(model.classMean)));
      foot.push(mk("Highest", stat((st) => st.highest)));
      foot.push(mk("Lowest", stat((st) => st.lowest)));
    }
    if ((model.kind === "cbc" || model.kind === "mixed") && model.options.showClassStatistics) {
      foot.push(mk("Performance levels", model.subjects.map((sub) => model.subjectStats[sub.id].distribution.map((d) => `${d.code} ${d.count}`).join("  ") || MISSING)));
    }
    // entered + missing = the learners who take the subject (all of them unless it is a selective subject).
    foot.push(mk("Marks entered", model.subjects.map((sub) => `${model.subjectStats[sub.id].entered}/${model.subjectStats[sub.id].entered + model.subjectStats[sub.id].missing}`)));
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
        if (data.cell.text.join("") === MISSING || data.cell.text.join("") === NOT_TAKEN) data.cell.styles.textColor = 130;
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
  if (model.learners.some((l) => Object.values(l.cells).some((c) => c.notApplicable))) notes.push(`${NOT_TAKEN} = the learner does not take this subject. It is not counted as missing or as zero.`);
  if (model.incompleteCount > 0) notes.push(`* = results incomplete (fewer subjects entered than examined; ${model.incompleteCount} learner${model.incompleteCount === 1 ? "" : "s"}). Averages use entered subjects only.`);
  if (model.showAverage) notes.push(`Avg % = mean of each entered subject's score as a percentage of its maximum, so subjects with different maximums count equally. ${model.showPositions ? ` Position is by Avg %; learners with equal averages share a position${model.multiStream ? ". Stream position is within the stream, class position across all streams" : ""}.` : ""}`);
  if (model.kind === "cbc") notes.push("Competency-based assessment: performance levels are descriptors, so no totals, averages or positions are calculated.");
  if (model.kind === "mixed") notes.push("This sheet mixes marks and competency levels, so no average or position is calculated.");
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(70);
  const wrapped = notes.flatMap((n) => doc.splitTextToSize(n, pageW - 2 * MARGIN) as string[]);
  const blockH = wrapped.length * 3.5 + 8 + (model.options.showSignatures ? 16 : 0);
  if (ny + blockH > pageH - 18) {
    doc.addPage();
    ny = 18;
  }
  doc.text(wrapped, MARGIN, ny);
  ny += wrapped.length * 3.5 + 8;

  // ---- Verification block (compact: one row per signatory); a school can switch it off ----
  if (model.options.showSignatures) {
    drawSignatureBlock(doc, ny, [
      { label: "Prepared by", value: model.preparedBy },
      { label: "Verified by (HOD / Deputy)", value: null },
    ]);
  }

  // ---- Footer with page X of Y on every page ----
  drawPageFooters(doc, `${model.school.name}  ·  ${model.exam.name}  ·  ${model.classLabel}`, model.generatedAt);
  return doc;
}
