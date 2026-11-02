import { MARGIN, drawPageFooters, drawSchoolHeader, drawSignatureBlock, hexToRgb } from "@/lib/pdf/pdf-common";
import type { ReportCardDocumentData } from "@/lib/academics/report-card-document";

// One learner's report card as a text-selectable PDF (jsPDF + jspdf-autotable, same libraries as the
// class mark sheet). It prints only what the loader returned: a card is never built from anything
// but released data, and the comment is already filtered to a teacher-approved one. Used by the
// WhatsApp bot document route (feature.bot.documents); no calculation happens here.

export async function buildReportCardPdf(data: ReportCardDocumentData) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const accent = hexToRgb(data.school.primaryColor);
  const lastY = (fallback: number) => ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback);
  const ensureSpace = (y: number, needed: number) => {
    if (y + needed > pageH - 18) {
      doc.addPage();
      return 16;
    }
    return y;
  };

  const ruleY = drawSchoolHeader(
    doc,
    { name: data.school.name, motto: null, address: data.school.address, phone: data.school.phone, email: null, primaryColor: data.school.primaryColor },
    null,
  );

  let y = ruleY + 8;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("LEARNER REPORT CARD", MARGIN, y);
  y += 6;

  const left = [
    ["Learner", data.student.fullName],
    ["Admission No.", data.student.admissionNumber ?? "—"],
    ["Class", data.student.classLabel],
  ];
  const right = [
    ["Assessment", data.details.assessment],
    ["Term / Year", data.details.termYear],
    ["Grading", data.details.grading],
  ];
  doc.setFontSize(8.5);
  left.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, MARGIN, y + i * 5);
    doc.setFont("helvetica", "normal");
    doc.text(String(v), MARGIN + 28, y + i * 5);
  });
  right.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, pageW / 2 + 2, y + i * 5);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(String(v), pageW / 2 - MARGIN - 30)[0] as string, pageW / 2 + 28, y + i * 5);
  });
  y += 3 * 5 + 3;

  const hasScores = data.subjects.some((s) => s.score !== null);
  const hasGrades = data.subjects.some((s) => s.grade !== null);
  const head = ["Subject", ...(hasScores ? ["Score"] : []), ...(hasGrades ? ["Grade"] : [])];
  const body = data.subjects.map((s) => [
    s.subject,
    ...(hasScores ? [s.score === null ? "—" : String(Math.round(s.score * 10) / 10)] : []),
    ...(hasGrades ? [s.grade ?? "—"] : []),
  ]);
  if (body.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 9, cellPadding: 1.6, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20, valign: "middle" },
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
      columnStyles: { 1: { halign: "center" }, 2: { halign: "center" } },
    });
    y = lastY(y) + 5;
  } else {
    doc.setFont("helvetica", "italic");
    doc.text("No subject marks recorded for this assessment.", MARGIN, y + 3);
    y += 9;
  }

  doc.setFontSize(9);
  const summary: string[] = [];
  if (data.average !== null) summary.push(`Average: ${Math.round(data.average * 10) / 10}`);
  if (data.options.showRank && data.rank !== null) summary.push(`Position: ${data.rank}${data.details.classSize ? ` of ${data.details.classSize}` : ""}`);
  if (summary.length > 0) {
    y = ensureSpace(y, 8);
    doc.setFont("helvetica", "bold");
    doc.text(summary.join("     "), MARGIN, y);
    y += 7;
  }

  if (data.options.showCompetencies && data.competencies.length > 0) {
    y = ensureSpace(y, 20);
    autoTable(doc, {
      startY: y,
      head: [["Subject", "Strand", "Sub-strand", "Rating"]],
      body: data.competencies.map((c) => [c.subject, c.strand, c.subStrand, c.rating]),
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 1.3, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20 },
      headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    });
    y = lastY(y) + 5;
  }

  if (data.attendance) {
    y = ensureSpace(y, 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Attendance:", MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(
      `${data.attendance.attendancePercent}%  (${data.attendance.presentDays} present, ${data.attendance.lateDays} late, ${data.attendance.absentDays} absent of ${data.attendance.recordedDays} days)`,
      MARGIN + 24,
      y,
    );
    y += 7;
  }

  const comments: [string, string | null][] = [
    ["Class teacher's comment", data.comment],
    ["Head teacher's comment", data.headTeacherComment],
  ];
  for (const [label, text] of comments) {
    if (!text) continue;
    const lines = doc.splitTextToSize(text, pageW - 2 * MARGIN) as string[];
    y = ensureSpace(y, 6 + lines.length * 4.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(lines, MARGIN, y + 5);
    y += 6 + lines.length * 4.2;
  }

  if (data.options.showSignatures) {
    y = ensureSpace(y + 4, 22);
    drawSignatureBlock(doc, y, [{ label: "Class teacher", value: null }, { label: "Head teacher", value: null }]);
  }

  drawPageFooters(doc, `${data.school.name}  ·  ${data.exam.name}  ·  ${data.student.fullName}`, data.details.generatedAt);
  doc.setProperties({ title: `Report card - ${data.student.fullName} - ${data.exam.name}` });
  return doc;
}
