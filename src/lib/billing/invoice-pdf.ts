import "server-only";
import { jsPDF } from "jspdf";
import { BRAND, COMPANY, DEFAULT_THANK_YOU } from "./company";
import { PAYMENT_INSTRUCTION_FIELDS, formatDateOnly, formatInstantDate, formatKes, statusLabel } from "./format";
import { invoiceDescription, type InvoiceRecord } from "./invoice-types";
import {
  BODY_BOTTOM,
  BODY_TOP,
  CONTENT_RIGHT,
  CONTENT_WIDTH,
  FONT,
  PAGE,
  drawFooter,
  drawHeader,
  labelStyle,
  registerBrandFonts,
  setStyle,
  text,
  textWidth,
} from "./letterhead";

// Official EduCore invoice, generated server-side as a real vector PDF (selectable text,
// embedded brand fonts, A4, print-safe margins). The invoice record is the single source of truth:
// every figure, the bill-to block and the payment instructions come from the snapshot stored on
// the invoice, so a PDF re-generated next year is identical to the one sent today.

const META_LABEL_X = 118;
const COL = { students: 126, rate: 156, amount: CONTENT_RIGHT } as const;
const DESC_WIDTH = 84;

const body = (size = 8.5, color: string = BRAND.navy900) => ({ font: FONT.sans, size, color });

function badgeColors(status: string): { fill: string | null; stroke: string; text: string } {
  switch (status) {
    case "paid":
      return { fill: BRAND.navy900, stroke: BRAND.navy900, text: "#FFFFFF" };
    case "overdue":
      return { fill: null, stroke: BRAND.danger, text: BRAND.danger };
    case "partially_paid":
      return { fill: null, stroke: BRAND.gold500, text: BRAND.navy900 };
    case "issued":
    case "sent":
      return { fill: null, stroke: BRAND.navy900, text: BRAND.navy900 };
    default:
      return { fill: null, stroke: BRAND.ink50, text: BRAND.ink50 };
  }
}

function summaryBandLabel(inv: InvoiceRecord): { label: string; amount: number } {
  if (inv.status === "paid") return { label: "PAID IN FULL", amount: inv.amount_kes };
  if (inv.status === "cancelled") return { label: "TOTAL (CANCELLED)", amount: inv.amount_kes };
  if (inv.amount_paid_kes > 0) return { label: "BALANCE DUE", amount: inv.balance_kes };
  return { label: "TOTAL DUE", amount: inv.amount_kes };
}

type InstructionRow = { label: string; value: string };

function instructionRows(inv: InvoiceRecord): { rows: InstructionRow[]; reference: string | null; other: string | null } {
  const pi = inv.payment_instructions ?? {};
  const rows: InstructionRow[] = [];
  for (const f of PAYMENT_INSTRUCTION_FIELDS) {
    if (f.key === "reference_note" || f.key === "other_instructions") continue;
    const v = pi[f.key]?.toString().trim();
    if (v) rows.push({ label: f.label, value: v });
  }
  const hasAny = rows.length > 0 || !!pi.other_instructions?.trim();
  const reference = hasAny ? pi.reference_note?.trim() || `Please quote invoice number ${inv.invoice_number} when making payment.` : null;
  return { rows, reference, other: pi.other_instructions?.trim() || null };
}

export function buildInvoicePdf(inv: InvoiceRecord): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  registerBrandFonts(doc);
  const billTo = inv.bill_to ?? {};
  const schoolName = billTo.name?.trim() || "School";

  doc.setProperties({
    title: `Invoice ${inv.invoice_number}`,
    subject: `EduCore invoice for ${schoolName} — ${inv.billing_period_label ?? ""}`.trim(),
    author: COMPANY.tradingName,
    creator: COMPANY.tradingName,
    keywords: `invoice, ${inv.invoice_number}`,
  });

  let y = drawHeader(doc, "full");
  const newPageIfNeeded = (needed: number) => {
    if (y + needed > BODY_BOTTOM) {
      doc.addPage();
      y = BODY_TOP.compact;
    }
  };

  // ---- Title + status -------------------------------------------------------------------
  text(doc, "INVOICE", PAGE.marginX, y + 6, { font: FONT.sans, weight: "bold", size: 22, color: BRAND.navy900 });
  {
    const label = statusLabel(inv.status).toUpperCase();
    const c = badgeColors(inv.status);
    const style = labelStyle({ size: 6.8, color: c.text, track: 1.1 });
    const w = textWidth(doc, label, style);
    doc.setLineWidth(0.25);
    doc.setDrawColor(c.stroke);
    if (c.fill) doc.setFillColor(c.fill);
    doc.roundedRect(CONTENT_RIGHT - w - 6.8, y + 0.9, w + 6.8, 6.2, 1.2, 1.2, c.fill ? "FD" : "S");
    text(doc, label, CONTENT_RIGHT - 3.4, y + 5.2, style, "right");
  }
  y += 15;

  // ---- Bill to (left) + identification (right) -----------------------------------------
  const blockTop = y;
  text(doc, "BILL TO", PAGE.marginX, y, labelStyle());
  let by = y + 5.6;
  setStyle(doc, { font: FONT.semibold, size: 11, color: BRAND.navy900 });
  for (const line of doc.splitTextToSize(schoolName, 86) as string[]) {
    doc.text(line, PAGE.marginX, by);
    by += 5;
  }
  setStyle(doc, body(8.2, BRAND.ink70));
  const contactLines = [
    billTo.address?.trim(),
    billTo.email?.trim(),
    billTo.phone?.trim(),
    billTo.kra_pin?.trim() ? `KRA PIN: ${billTo.kra_pin.trim()}` : undefined,
  ].filter((v): v is string => !!v);
  for (const raw of contactLines) {
    for (const line of doc.splitTextToSize(raw, 86) as string[]) {
      doc.text(line, PAGE.marginX, by + 0.4);
      by += 4.1;
    }
  }

  const meta: { label: string; value: string; sub?: string; strong?: boolean }[] = [
    { label: "INVOICE NO.", value: inv.invoice_number, strong: true },
    { label: "INVOICE DATE", value: formatDateOnly(inv.invoice_date) },
    { label: "BILLING PERIOD", value: inv.billing_period_label ?? "—", sub: `${formatDateOnly(inv.period_start)} – ${formatDateOnly(inv.period_end)}` },
    { label: "DUE DATE", value: formatInstantDate(inv.due_at) },
  ];
  let my = blockTop;
  for (const m of meta) {
    text(doc, m.label, META_LABEL_X, my, labelStyle());
    text(doc, m.value, CONTENT_RIGHT, my, m.strong ? { font: FONT.semibold, size: 9, color: BRAND.navy900 } : body(8.8), "right");
    my += 6;
    if (m.sub) {
      text(doc, m.sub, CONTENT_RIGHT, my - 1.2, body(7.4, BRAND.ink70), "right");
      my += 3.6;
    }
  }
  y = Math.max(by, my) + 9;

  // ---- Itemised calculation -------------------------------------------------------------
  const rate = inv.unit_price_kes ?? (inv.student_count > 0 ? inv.subtotal_kes / inv.student_count : 0);
  const descLines = doc.splitTextToSize(invoiceDescription(inv), DESC_WIDTH) as string[];
  const subLines = [
    `${inv.student_count.toLocaleString("en-KE")} student${inv.student_count === 1 ? "" : "s"} × ${formatKes(rate)} per student`,
    `Billing period: ${formatDateOnly(inv.period_start)} – ${formatDateOnly(inv.period_end)}`,
    ...(inv.plan_name ? [`${inv.plan_name} plan`] : []),
  ];
  const rowHeight = 7 + descLines.length * 4.6 + subLines.length * 3.8;
  newPageIfNeeded(8 + rowHeight + 60);

  doc.setDrawColor(BRAND.navy900);
  doc.setLineWidth(0.35);
  doc.line(PAGE.marginX, y, CONTENT_RIGHT, y);
  text(doc, "DESCRIPTION", PAGE.marginX, y + 5.2, labelStyle());
  text(doc, "STUDENTS", COL.students, y + 5.2, labelStyle(), "right");
  text(doc, "RATE", COL.rate, y + 5.2, labelStyle(), "right");
  text(doc, "AMOUNT", COL.amount, y + 5.2, labelStyle(), "right");
  doc.line(PAGE.marginX, y + 8, CONTENT_RIGHT, y + 8);
  y += 8;

  let ry = y + 6;
  setStyle(doc, { font: FONT.semibold, size: 9.2, color: BRAND.navy900 });
  for (const line of descLines) {
    doc.text(line, PAGE.marginX, ry);
    ry += 4.6;
  }
  setStyle(doc, body(7.6, BRAND.ink70));
  for (const line of subLines) {
    doc.text(line, PAGE.marginX, ry);
    ry += 3.8;
  }
  const firstBaseline = y + 6;
  text(doc, inv.student_count.toLocaleString("en-KE"), COL.students, firstBaseline, body(9), "right");
  text(doc, formatKes(rate), COL.rate, firstBaseline, body(9), "right");
  text(doc, formatKes(inv.subtotal_kes), COL.amount, firstBaseline, { font: FONT.semibold, size: 9, color: BRAND.navy900 }, "right");
  y = Math.max(ry, y + rowHeight) - 1;
  doc.setDrawColor(BRAND.rule);
  doc.setLineWidth(0.2);
  doc.line(PAGE.marginX, y, CONTENT_RIGHT, y);
  y += 7;

  // ---- Summary --------------------------------------------------------------------------
  const sumLeft = META_LABEL_X;
  const sumRows: { label: string; value: string }[] = [{ label: "Subtotal", value: formatKes(inv.subtotal_kes) }];
  if (inv.discount_kes > 0) sumRows.push({ label: "Discount", value: `- ${formatKes(inv.discount_kes)}` });
  if (inv.tax_kes > 0) sumRows.push({ label: `${inv.tax_label ?? "Tax"} (${inv.tax_rate_percent}%)`, value: formatKes(inv.tax_kes) });
  if (inv.amount_paid_kes > 0 && inv.status !== "paid") {
    sumRows.push({ label: "Invoice total", value: formatKes(inv.amount_kes) });
    sumRows.push({ label: "Amount paid", value: `- ${formatKes(inv.amount_paid_kes)}` });
  }
  newPageIfNeeded(sumRows.length * 5.6 + 22);
  for (const r of sumRows) {
    text(doc, r.label, sumLeft, y, body(8.5, BRAND.ink70));
    text(doc, r.value, CONTENT_RIGHT, y, body(8.5), "right");
    y += 5.6;
  }
  y += 1.5;
  const band = summaryBandLabel(inv);
  doc.setFillColor(BRAND.navy900);
  doc.roundedRect(sumLeft, y, CONTENT_RIGHT - sumLeft, 13.5, 1.2, 1.2, "F");
  doc.setFillColor(BRAND.gold500);
  doc.rect(sumLeft, y + 1.5, 1.1, 10.5, "F");
  text(doc, band.label, sumLeft + 5, y + 8.3, labelStyle({ size: 6.6, color: BRAND.gold300, track: 1.2 }));
  text(doc, formatKes(band.amount), CONTENT_RIGHT - 4, y + 8.9, { font: FONT.sans, weight: "bold", size: 15, color: "#FFFFFF" }, "right");
  y += 13.5 + 10;

  // ---- Payment information --------------------------------------------------------------
  if (inv.status !== "paid" && inv.status !== "cancelled") {
    const { rows, reference, other } = instructionRows(inv);
    const innerW = CONTENT_WIDTH - 12;
    const otherLines = other ? (setStyle(doc, body(8)), doc.splitTextToSize(other, innerW) as string[]) : [];
    const fallbackLines = rows.length === 0 && !other
      ? (setStyle(doc, body(8, BRAND.ink70)),
        doc.splitTextToSize(
          `Payment details for this invoice are available from EduCore billing: ${COMPANY.email.label} or WhatsApp ${COMPANY.whatsapp.label}. Please quote invoice number ${inv.invoice_number}.`,
          innerW,
        ) as string[])
      : [];
    const gridRows = Math.ceil(rows.length / 2);
    const panelH = 12 + gridRows * 9.6 + (otherLines.length ? otherLines.length * 4 + 2 : 0) + (reference ? 6 : 0) + fallbackLines.length * 4;
    newPageIfNeeded(panelH + 14);

    doc.setFillColor(BRAND.panel);
    doc.rect(PAGE.marginX, y, CONTENT_WIDTH, panelH, "F");
    doc.setFillColor(BRAND.gold500);
    doc.rect(PAGE.marginX, y, 1.1, panelH, "F");
    text(doc, "PAYMENT INFORMATION", PAGE.marginX + 6, y + 6, labelStyle({ color: BRAND.navy900 }));
    let py = y + 12.6;
    rows.forEach((r, i) => {
      const col = i % 2;
      const x = PAGE.marginX + 6 + col * (innerW / 2 + 2);
      const rowY = py + Math.floor(i / 2) * 9.6;
      text(doc, r.label.toUpperCase(), x, rowY, labelStyle({ size: 5.2 }));
      setStyle(doc, { font: FONT.semibold, size: 8.8, color: BRAND.navy900 });
      doc.text(r.value, x, rowY + 4.2, { maxWidth: innerW / 2 - 2 });
    });
    py += gridRows * 9.6;
    if (otherLines.length) {
      setStyle(doc, body(8));
      for (const l of otherLines) {
        doc.text(l, PAGE.marginX + 6, py);
        py += 4;
      }
      py += 2;
    }
    if (reference) {
      text(doc, reference, PAGE.marginX + 6, py, body(7.8, BRAND.ink70));
      py += 6;
    }
    if (fallbackLines.length) {
      setStyle(doc, body(8, BRAND.ink70));
      for (const l of fallbackLines) {
        doc.text(l, PAGE.marginX + 6, py);
        py += 4;
      }
    }
    y += panelH + 9;
  }

  // ---- Notes + thank you ----------------------------------------------------------------
  if (inv.notes?.trim()) {
    const lines = (setStyle(doc, body(8.2)), doc.splitTextToSize(inv.notes.trim(), CONTENT_WIDTH) as string[]);
    newPageIfNeeded(lines.length * 4 + 14);
    text(doc, "NOTES", PAGE.marginX, y, labelStyle());
    y += 4.6;
    setStyle(doc, body(8.2));
    for (const l of lines) {
      doc.text(l, PAGE.marginX, y);
      y += 4;
    }
    y += 6;
  }
  newPageIfNeeded(12);
  text(doc, inv.payment_instructions?.footer_note?.trim() || DEFAULT_THANK_YOU, PAGE.marginX, y + 1, { font: FONT.semibold, size: 9, color: BRAND.navy900 });

  // ---- Per-page chrome (done last so page counts and watermarks are right) ---------------
  const pages = doc.getNumberOfPages();
  const GState = (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (p > 1) drawHeader(doc, "compact", `${inv.invoice_number} · Page ${p} of ${pages}`);
    drawFooter(doc);
    const mark = inv.status === "draft" ? "DRAFT" : inv.status === "cancelled" ? "CANCELLED" : null;
    if (mark) {
      doc.saveGraphicsState();
      doc.setGState(new GState({ opacity: 0.07 }) as never);
      setStyle(doc, { font: FONT.sans, weight: "bold", size: mark === "DRAFT" ? 110 : 84, color: BRAND.navy900 });
      doc.text(mark, PAGE.width / 2, 170, { align: "center", angle: 35 });
      doc.restoreGraphicsState();
    }
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
