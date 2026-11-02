import { MARGIN, drawPageFooters, drawSchoolHeader, formatDate, hexToRgb } from "@/lib/pdf/pdf-common";
import { formatKes, type StatementModel } from "@/lib/bot-documents/student-statement";

// A learner's fee statement as a text-selectable PDF. Prints only what the statement model holds;
// the model has already been reconciled against the balance the rest of the system shows.

export async function buildStatementPdf(model: StatementModel) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const accent = hexToRgb(model.school.primaryColor);

  const ruleY = drawSchoolHeader(
    doc,
    { name: model.school.name, motto: null, address: model.school.address, phone: model.school.phone, email: null, primaryColor: model.school.primaryColor },
    null,
  );

  let y = ruleY + 8;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("FEE STATEMENT", MARGIN, y);
  y += 6;
  doc.setFontSize(8.5);
  const left = [
    ["Learner", model.student.fullName],
    ["Admission No.", model.student.admissionNumber ?? "—"],
    ["Class", model.student.classLabel || "—"],
  ];
  const right = [
    ["Term", model.termLabel],
    ["Statement date", formatDate(model.generatedAt)],
  ];
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
    doc.text(String(v), pageW / 2 + 30, y + i * 5);
  });
  y += 3 * 5 + 3;

  const rows: (string | { content: string; styles: Record<string, unknown> })[][] = [];
  rows.push(["", "Balance brought forward", "", "", formatKes(model.broughtForward)]);
  for (const l of model.lines) {
    rows.push([formatDate(l.date), l.description, l.charge === null ? "" : formatKes(l.charge), l.credit === null ? "" : formatKes(l.credit), ""]);
  }
  rows.push([
    { content: "", styles: { fillColor: [241, 245, 249] } },
    { content: "This term", styles: { fontStyle: "bold", fillColor: [241, 245, 249] } },
    { content: formatKes(model.totalCharged), styles: { fontStyle: "bold", fillColor: [241, 245, 249] } },
    { content: formatKes(model.totalCredited), styles: { fontStyle: "bold", fillColor: [241, 245, 249] } },
    { content: "", styles: { fillColor: [241, 245, 249] } },
  ]);
  autoTable(doc, {
    startY: y,
    head: [["Date", "Description", "Charged", "Paid / credited", "Balance"]],
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 1.8, lineColor: [200, 200, 200], lineWidth: 0.15, textColor: 20, valign: "middle" },
    headStyles: { fillColor: accent, textColor: 255, fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  y = (last?.finalY ?? y) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(model.closingBalance > 0 ? "Balance due:" : "Balance:", MARGIN, y);
  doc.text(formatKes(model.closingBalance), pageW - MARGIN, y, { align: "right" });
  if (model.creditBalance > 0) {
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Credit held on the account: ${formatKes(model.creditBalance)}`, MARGIN, y);
  }
  y += 10;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text("For any question about this statement, please contact the school office.", MARGIN, y);

  drawPageFooters(doc, `${model.school.name}  ·  Fee statement  ·  ${model.student.fullName}`, model.generatedAt);
  doc.setProperties({ title: `Fee statement - ${model.student.fullName}` });
  return doc;
}
