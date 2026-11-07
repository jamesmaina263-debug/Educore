// Pure helpers for Finance > Refunds (WP 4.3). The database functions create_refund_request,
// decide_refund_request, cancel_refund_request and record_refund_payout do ALL the accounting and
// all the permission checks; these helpers only shape what the page shows and what it sends.
// A refund returns money held as CREDIT (the part of a payment not applied to an invoice).

export const REFUNDS_FLAG = "feature.finance.refunds";
export const REFUND_APPROVE_PERMISSION = "finance.refund.approve";

export type RefundStatus = "requested" | "approved" | "rejected" | "cancelled" | "paid";
export type RefundReason = "overpayment" | "duplicate_payment" | "paid_in_error" | "other";
export type PayoutMethod = "mpesa" | "bank" | "cash" | "cheque";

export const REASON_OPTIONS: { value: RefundReason; label: string }[] = [
  { value: "overpayment", label: "Overpayment" },
  { value: "duplicate_payment", label: "Duplicate payment" },
  { value: "paid_in_error", label: "Paid in error" },
  { value: "other", label: "Other (describe below)" },
];

export const METHOD_OPTIONS: { value: PayoutMethod; label: string; referenceHint: string }[] = [
  { value: "mpesa", label: "M-Pesa", referenceHint: "M-Pesa confirmation code" },
  { value: "bank", label: "Bank transfer", referenceHint: "Bank reference" },
  { value: "cash", label: "Cash", referenceHint: "Voucher number" },
  { value: "cheque", label: "Cheque", referenceHint: "Cheque number" },
];

const STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "Waiting for approval",
  approved: "Approved, not paid out yet",
  rejected: "Rejected",
  cancelled: "Cancelled",
  paid: "Paid out",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as RefundStatus] ?? status;
}

export function reasonLabel(code: string): string {
  return REASON_OPTIONS.find((r) => r.value === code)?.label.replace(" (describe below)", "") ?? code;
}

export function methodLabel(method: string): string {
  return METHOD_OPTIONS.find((m) => m.value === method)?.label ?? method;
}

/** A request that is still open can be cancelled; a paid one never can. */
export function canCancel(status: string): boolean {
  return status === "requested" || status === "approved";
}

export const canDecide = (status: string): boolean => status === "requested";
export const canRecordPayout = (status: string): boolean => status === "approved";

/**
 * Whole shillings only, greater than zero. Returns the number, or null when the text is not a
 * plain whole amount (so "100.5", "1e3", "-5", "", "0" and "12abc" are all refused before anything
 * is sent). Commas and spaces typed as thousand separators are tolerated.
 */
export function parseWholeKes(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 ? n : null;
}

export interface RequestFormInput {
  paymentId: string;
  amountText: string;
  reason: RefundReason | "";
  note: string;
}

/** Returns an error message, or null when the form can be sent. The database re-checks all of it. */
export function validateRequestForm(f: RequestFormInput): string | null {
  if (!f.paymentId) return "Choose the payment to refund from.";
  if (parseWholeKes(f.amountText) === null) return "Enter the refund as a whole number of shillings, greater than zero.";
  if (!f.reason) return "Choose a reason.";
  if (f.reason === "other" && f.note.trim() === "") return "Describe the reason for this refund.";
  if (f.note.length > 500) return "The note is too long (500 characters at most).";
  return null;
}

export interface PayoutFormInput {
  method: PayoutMethod | "";
  reference: string;
}

export function validatePayoutForm(f: PayoutFormInput): string | null {
  if (!f.method) return "Choose how the refund was paid.";
  const ref = f.reference.trim();
  if (ref.length < 1) return "Enter the payment reference.";
  if (ref.length > 100) return "The reference is too long (100 characters at most).";
  return null;
}

/**
 * The database raises plain-language messages for every rule; show those. Only transport-level
 * noise (a missing message, or a message from outside our functions) is replaced.
 */
export function refundErrorMessage(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "Something went wrong. Nothing was changed. Please try again.";
  if (/^(fetch failed|network|failed to fetch)/i.test(msg)) return "Could not reach the server. Nothing was changed. Please try again.";
  return msg;
}

export interface RefundSummaryRow {
  status: string;
  amount: number;
}

/** Totals for the header: open (waiting or approved) and paid out. Rejected/cancelled count as neither. */
export function summarise(rows: RefundSummaryRow[]): { openCount: number; openAmount: number; paidCount: number; paidAmount: number } {
  let openCount = 0, openAmount = 0, paidCount = 0, paidAmount = 0;
  for (const r of rows) {
    if (r.status === "requested" || r.status === "approved") { openCount += 1; openAmount += r.amount; }
    else if (r.status === "paid") { paidCount += 1; paidAmount += r.amount; }
  }
  return { openCount, openAmount, paidCount, paidAmount };
}
