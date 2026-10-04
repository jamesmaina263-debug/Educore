import type { PaymentInstructions } from "./format";

export type InvoiceBillTo = {
  school_id?: string;
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  kra_pin?: string | null;
};

/** Columns every invoice screen / the PDF route selects, so they cannot drift apart. */
export const INVOICE_COLUMNS =
  "id, school_id, invoice_number, status, invoice_date, issued_at, due_at, paid_at, period_start, period_end, " +
  "billing_period_label, term_id, plan_name, billable_statuses, student_count, unit_price_kes, subtotal_kes, discount_kes, tax_label, " +
  "tax_rate_percent, tax_kes, amount_kes, amount_paid_kes, balance_kes, currency, notes, bill_to, payment_instructions, " +
  "pdf_version, pdf_generated_at, sent_at, sent_to, cancelled_at, cancel_reason, source, replaces_invoice_id, created_at";

export type InvoiceRecord = {
  id: string;
  school_id: string;
  invoice_number: string;
  status: string;
  invoice_date: string;
  issued_at: string | null;
  due_at: string;
  paid_at: string | null;
  period_start: string;
  period_end: string;
  billing_period_label: string | null;
  term_id: string | null;
  plan_name: string | null;
  billable_statuses: string[] | null;
  student_count: number;
  unit_price_kes: number | null;
  subtotal_kes: number;
  discount_kes: number;
  tax_label: string | null;
  tax_rate_percent: number;
  tax_kes: number;
  amount_kes: number;
  amount_paid_kes: number;
  balance_kes: number;
  currency: string;
  notes: string | null;
  bill_to: InvoiceBillTo | null;
  payment_instructions: PaymentInstructions | null;
  pdf_version: number;
  pdf_generated_at: string | null;
  sent_at: string | null;
  sent_to: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  source: string;
  replaces_invoice_id: string | null;
  created_at: string;
};

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Normalises a PostgREST row (numerics may arrive as strings) into an InvoiceRecord. */
export function toInvoiceRecord(row: Record<string, unknown>): InvoiceRecord {
  const r = row as Record<string, never>;
  return {
    ...(row as unknown as InvoiceRecord),
    student_count: num(r.student_count),
    unit_price_kes: row.unit_price_kes == null ? null : num(r.unit_price_kes),
    subtotal_kes: num(r.subtotal_kes),
    discount_kes: num(r.discount_kes),
    tax_rate_percent: num(r.tax_rate_percent),
    tax_kes: num(r.tax_kes),
    amount_kes: num(r.amount_kes),
    amount_paid_kes: num(r.amount_paid_kes),
    balance_kes: num(r.balance_kes, num(r.amount_kes) - num(r.amount_paid_kes)),
    pdf_version: num(r.pdf_version),
  };
}

export function invoicePdfFileName(inv: Pick<InvoiceRecord, "invoice_number">): string {
  return `EduCore-Invoice-${inv.invoice_number.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

/** What the invoice line reads, derived from the stored period label so it is never hand-typed. */
export function invoiceDescription(inv: Pick<InvoiceRecord, "billing_period_label">): string {
  return `EduCore School Management Platform — ${inv.billing_period_label ?? "Subscription"}`;
}
