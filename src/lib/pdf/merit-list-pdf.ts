import type { CellDef, RowInput } from "jspdf-autotable";
import { MISSING, assessmentTitle, type MarkSheetModel } from "@/lib/academics/mark-sheet-model";
import type { MeritList } from "@/lib/academics/merit-list";
import { MARGIN, drawPageFooters, drawSchoolHeader, drawSignatureBlock, formatDate, hexToRgb, type LoadedLogo } from "@/lib/pdf/pdf-common";

// Lays out a MeritList (derived from the mark sheet model) as a real, text-selectable A4 PDF.
// No calculation here: every number comes from buildMeritList / the model, so the PDF, Excel and
// the class mark sheet agree.

const names = (list: string[]) => (list.length <= 2 ? list.join(", ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`);

export async function buildMeritListPdf(model: MarkSheetModel, list: MeritList, logo: LoadedLogo | null) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const columnCount = (list.positioned ? (model.multiStream ? 2 : 1) : 0) + 2 + (model.multiStream ? 1 : 0) + model.subjects.length + 2;
  const doc = new jsPDF({ orientation: columnCount > 9 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const accent = hexToRgb(model.school.primaryColor);

  const ruleY = drawSchoolHeader(doc, model.school, logo);

  // ---- Title + details ----
  let y = ruleY + 8;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(list.title, MARGIN, y);
  if (model.provisional) {
    doc.setFontSize(8.5);
    doc.setTextColor(146, 64, 14);
    doc.text("PROVISIONAL: assessment not yet closed, positions are not final", pageW - MARGIN, y, { align: "right" });
    doc.setTextColor(0);
  }
  y += 5.5;
  const termYear = [model.exam.termName, model.exam.academicYearName].filter(Boolean).join(", ") || MISSING;
  const streams = [...new Set(model.learners.map((l) => l.streamName))];
  const ranked = list.rows.filter((r) => r.hasResult).length;
  const left = [
    ["Assessment", assessmentTitle(model.exam.name, model.exam.examType)],
    ["Term / Year", termYear],
    ["Class", `${model.classLabel}${streams.length ? `  (${streams.join(", ")})` : ""}`],
  ];
  const right = [
    ["Learners", `${model.learners.length}  (${ranked} with results)`],
    ["Class mean", model.classMean === null ? MISSING : `${model.classMean}%`],
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
    doc.text(v, rx + 22, y + i * 4.6);
  });
  y += 3 * 4.6 + 2;

  // ---- Main table ----
  const head: string[] = [];
  if (list.positioned) {
    head.push(model.multiStream ? "Pos\n(class)" : "Pos");
    if (model.multiStream) head.push("Pos\n(stream)");
  }
  head.push("Adm No", "Learner");
  if (model.multiStream) head.push("Stream");
  for (const s of model.subjects) head.push(`${s.name}\n/${s.maxScore}`);
  head.push("Total", "Avg %");
  const lead = (list.positioned ? (model.multiStream ? 2 : 1) : 0) + 2 + (model.multiStream ? 1 : 0); // columns before the subjects
  const body = list.rows.map((r) => {
    const row: string[] = [];
    if (list.positioned) {
      row.push(r.position === null ? MISSING : String(r.position));
      if (model.multiStream) row.push(r.streamPosition === null ? MISSING : String(r.streamPosition));
    }
    row.push(r.learner.admissionNumber, r.hasResult ? (r.learner.incomplete ? `${r.learner.name} *` : r.learner.name) : `${r.learner.name} (no result)`);
    if (model.multiStream) row.push(r.learner.streamName);
    for (const s of model.subjects) row.push(r.learner.cells[s.id].text);
    row.push(r.learner.total === null ? MISSING : String(r.learner.total), r.learner.average === null ? MISSING : r.learner.average.toFixed(2));
    return row;
  });
  const nameCol = lead - 1 - (model.multiStream ? 1 : 0);
  const fontSize = columnCount > 12 ? 7 : 8;
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    showHead: "everyPage",
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 18 },
    styles: { fontSize, cellPadding: 1.3, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20, valign: "middle" },
    headStyles: { fillColor: accent, textColor: 255, halign: "center", fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      const col = data.column.index;
      if (data.section === "head" && (col === nameCol || col === nameCol - 1)) data.cell.styles.halign = "left";
      if (data.section === "body") {
        data.cell.styles.halign = col === nameCol || col === nameCol - 1 ? "left" : "center";
        if (list.positioned && col === 0) data.cell.styles.fontStyle = "bold";
        if (data.cell.text.join("") === MISSING) data.cell.styles.textColor = 130;
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...accent);
        doc.text(`${model.school.name}  ·  ${list.title === "MERIT LIST" ? "Merit List" : "Examination Results"}  ·  ${model.exam.name}  ·  ${model.classLabel}`, MARGIN, 10);
        doc.setTextColor(0);
      }
    },
  });

  // ---- Subject performance summary (separate from overall position) ----
  type Last = { lastAutoTable?: { finalY: number } };
  let sy = ((doc as unknown as Last).lastAutoTable?.finalY ?? y) + 8;
  if (sy + 30 > pageH - 18) {
    doc.addPage();
    sy = 18;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(0);
  doc.text("Subject performance", MARGIN, sy);
  const subjectBody: RowInput[] = list.subjectSummary.map((s): CellDef[] => [
    { content: s.name, styles: { halign: "left" } },
    { content: String(s.maxScore) },
    { content: `${s.entered}/${model.learners.length}` },
    { content: s.mean === null ? MISSING : String(s.mean) },
    { content: s.meanPercent === null ? MISSING : `${s.meanPercent}%` },
    { content: s.highest === null ? MISSING : `${s.highest}  (${names(s.highestBy)})`, styles: { halign: "left" } },
    { content: s.lowest === null ? MISSING : `${s.lowest}  (${names(s.lowestBy)})`, styles: { halign: "left" } },
  ]);
  autoTable(doc, {
    startY: sy + 2,
    head: [["Subject", "Max", "Entered", "Mean", "Mean %", "Highest (by)", "Lowest (by)"]],
    body: subjectBody,
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 18 },
    styles: { fontSize: 7.5, cellPadding: 1.2, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20, halign: "center", valign: "middle" },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  // ---- Notes ----
  let ny = ((doc as unknown as Last).lastAutoTable?.finalY ?? sy) + 6;
  const notes: string[] = [];
  if (list.positioned) {
    notes.push("Position is by Avg % (the mean of each subject's score as a percentage of its maximum). Learners with equal Avg % share a position" + (list.tiesPresent ? ", as shown above." : "."));
    if (model.multiStream) notes.push("Pos (class) is across all streams; Pos (stream) is within the learner's stream.");
  } else {
    notes.push("Positions are not shown: this school has ranking switched off. Learners are listed alphabetically.");
  }
  notes.push("Subject performance above shows the best and lowest result in each subject, separate from the overall position.");
  notes.push(`${MISSING} = mark not yet entered. Missing marks are excluded from all statistics and are never counted as zero.`);
  if (list.incompleteCount > 0) notes.push(`* = results incomplete (fewer subjects entered than examined; ${list.incompleteCount} learner${list.incompleteCount === 1 ? "" : "s"}). Avg % uses entered subjects only.`);
  if (list.noResultCount > 0) notes.push(`${list.noResultCount} learner${list.noResultCount === 1 ? " has" : "s have"} no marks yet and ${list.noResultCount === 1 ? "is" : "are"} not ranked.`);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(70);
  const wrapped = notes.flatMap((n) => doc.splitTextToSize(n, pageW - 2 * MARGIN) as string[]);
  if (ny + wrapped.length * 3.5 + 8 + (model.options.showSignatures ? 16 : 0) > pageH - 18) {
    doc.addPage();
    ny = 18;
  }
  doc.text(wrapped, MARGIN, ny);
  ny += wrapped.length * 3.5 + 8;

  if (model.options.showSignatures) {
    drawSignatureBlock(doc, ny, [
      { label: "Prepared by", value: model.preparedBy },
      { label: "Approved by (Principal / Deputy)", value: null },
    ]);
  }

  drawPageFooters(doc, `${model.school.name}  ·  ${model.exam.name}  ·  ${model.classLabel}`, model.generatedAt);
  return doc;
}
