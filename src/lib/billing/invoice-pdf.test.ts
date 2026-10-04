import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractPdfText } from "@/lib/pdf/extract-text";

vi.mock("server-only", () => ({}));

import { buildInvoicePdf } from "./invoice-pdf";
import { invoicePdfFileName, toInvoiceRecord, type InvoiceRecord } from "./invoice-types";

// Real jsPDF + real fonts, no mocks: guards against font/asset regressions and checks that the
// document is a genuine text PDF (selectable/searchable), not an image.

function makeInvoice(over: Partial<Record<string, unknown>> = {}): InvoiceRecord {
  return toInvoiceRecord({
    id: "11111111-1111-1111-1111-111111111111",
    school_id: "22222222-2222-2222-2222-222222222222",
    invoice_number: "EDC-INV-2026-0001",
    status: "issued",
    invoice_date: "2026-08-10",
    issued_at: "2026-08-10T07:00:00Z",
    due_at: "2026-08-24T20:59:59Z",
    paid_at: null,
    period_start: "2026-05-04",
    period_end: "2026-08-07",
    billing_period_label: "Term 2 2026",
    term_id: null,
    plan_name: "Growth",
    student_count: 500,
    unit_price_kes: 100,
    subtotal_kes: 50000,
    discount_kes: 0,
    tax_label: null,
    tax_rate_percent: 0,
    tax_kes: 0,
    amount_kes: 50000,
    amount_paid_kes: 0,
    balance_kes: 50000,
    currency: "KES",
    notes: null,
    bill_to: { name: "Sunrise Academy", address: "P.O. Box 123-00100, Nairobi", email: "bursar@sunrise.example", phone: "+254 700 000 000", kra_pin: null },
    payment_instructions: {
      mpesa_paybill: "123456",
      mpesa_paybill_account: "SUNRISE",
      bank_name: "Example Bank",
      account_name: "EduCore Technologies Ltd",
      account_number: "0123456789",
      footer_note: "Thank you for partnering with EduCore Africa.",
    },
    pdf_version: 1,
    pdf_generated_at: null,
    sent_at: null,
    sent_to: null,
    cancelled_at: null,
    cancel_reason: null,
    source: "auto",
    replaces_invoice_id: null,
    created_at: "2026-08-10T07:00:00Z",
    ...over,
  });
}

// Small letter-spaced labels (mono "eyebrow" style) extract with gaps between letters; compare
// them whitespace-insensitively. Names, numbers and amounts are never tracked and are matched exactly.
const squash = (s: string) => s.replace(/\s+/g, "");

const previewDir = process.env.INVOICE_PDF_PREVIEW_DIR;
function preview(name: string, bytes: Uint8Array) {
  if (!previewDir) return;
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(path.join(previewDir, `${name}.pdf`), bytes);
}

describe("buildInvoicePdf", () => {
  it("produces an A4 text PDF with the invoice identity, calculation and total", async () => {
    const bytes = buildInvoicePdf(makeInvoice());
    preview("issued", bytes);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const text = await extractPdfText(bytes);
    for (const needle of [
      "INVOICE",
      "EDC-INV-2026-0001",
      "Sunrise Academy",
      "EduCore School Management Platform",
      "Term 2 2026",
      "500",
      "KES 100",
      "KES 50,000",
      "123456",
      "Thank you for partnering with EduCore Africa.",
      "EduCore Technologies Ltd",
      "PVT-93SSQEELA",
      "educoreafrica.com",
      "+254 702 904 562",
    ]) {
      expect(text, `missing "${needle}"`).toContain(needle);
    }
    expect(squash(text)).toContain("TOTALDUE");
    expect(squash(text)).toContain("PAYMENTINFORMATION");
  });

  it("is one A4 page for a normal invoice", () => {
    const bytes = buildInvoicePdf(makeInvoice());
    const pageCount = (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBe(1);
  });

  it("shows discount, tax and part-payment lines with a balance-due band", async () => {
    const bytes = buildInvoicePdf(
      makeInvoice({
        status: "partially_paid",
        subtotal_kes: 600, student_count: 4, unit_price_kes: 150,
        discount_kes: 60, tax_label: "VAT", tax_rate_percent: 16, tax_kes: 86.4,
        amount_kes: 626.4, amount_paid_kes: 200, balance_kes: 426.4,
      }),
    );
    preview("partial-discount-tax", bytes);
    const text = await extractPdfText(bytes);
    expect(text).toContain("Discount");
    expect(text).toContain("VAT (16%)");
    expect(text).toContain("Amount paid");
    expect(squash(text)).toContain("BALANCEDUE");
    expect(text).toContain("KES 426.40");
  });

  it("shows PAID IN FULL and hides payment instructions for a paid invoice", async () => {
    const bytes = buildInvoicePdf(makeInvoice({ status: "paid", amount_paid_kes: 50000, balance_kes: 0, paid_at: "2026-08-12T09:00:00Z" }));
    preview("paid", bytes);
    const text = await extractPdfText(bytes);
    expect(squash(text)).toContain("PAIDINFULL");
    expect(squash(text)).not.toContain("PAYMENTINFORMATION");
  });

  it("falls back to a contact line, never invented bank/M-Pesa details, when none are configured", async () => {
    const bytes = buildInvoicePdf(makeInvoice({ payment_instructions: {} }));
    preview("no-payment-instructions", bytes);
    const text = await extractPdfText(bytes);
    expect(squash(text)).toContain("PAYMENTINFORMATION");
    expect(text).toContain("available from EduCore billing");
    expect(text).not.toMatch(/Paybill|Account number|SWIFT/i);
  });

  it("marks drafts and cancelled invoices with a watermark and status", async () => {
    const draft = buildInvoicePdf(makeInvoice({ status: "draft" }));
    preview("draft", draft);
    expect(squash(await extractPdfText(draft))).toContain("DRAFT");
    const cancelled = buildInvoicePdf(makeInvoice({ status: "cancelled" }));
    preview("cancelled", cancelled);
    expect(squash(await extractPdfText(cancelled))).toContain("CANCELLED");
  });

  it("shows the school's KRA PIN only when present", async () => {
    const without = await extractPdfText(buildInvoicePdf(makeInvoice()));
    expect(without).not.toContain("KRA PIN");
    const withPin = await extractPdfText(buildInvoicePdf(makeInvoice({ bill_to: { name: "Sunrise Academy", kra_pin: "P051234567Z" } })));
    expect(withPin).toContain("KRA PIN: P051234567Z");
  });

  it("copes with a very long school name, long notes and singular student count", async () => {
    const bytes = buildInvoicePdf(
      makeInvoice({
        student_count: 1, subtotal_kes: 100, amount_kes: 100, balance_kes: 100,
        bill_to: { name: "St. Bartholomew's Mixed Day and Boarding Primary and Junior Secondary School of Excellence", address: "P.O. Box 4455-00200, Along a Very Long Road Name, Opposite The Big Market, Nairobi County", email: "very.long.billing.address@school-with-a-long-domain.example" },
        notes: "Please note that this invoice covers the full term. ".repeat(6),
        payment_instructions: { other_instructions: "Pay by Paybill 123456 and send the confirmation message to billing. ".repeat(4) },
      }),
    );
    preview("long-content", bytes);
    const text = await extractPdfText(bytes);
    expect(text).toContain("1 student ×");
    expect(text).toContain("St. Bartholomew");
  });

  it("builds a stable download file name", () => {
    expect(invoicePdfFileName({ invoice_number: "EDC-INV-2026-0001" })).toBe("EduCore-Invoice-EDC-INV-2026-0001.pdf");
    expect(invoicePdfFileName({ invoice_number: "A/B C" })).toBe("EduCore-Invoice-ABC.pdf");
  });
});
