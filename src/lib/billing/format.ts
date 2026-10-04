// Presentation helpers shared by the invoice PDF, admin screens and school screens, so an amount
// or status never reads differently in two places.

const NAIROBI = "Africa/Nairobi";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** KES 50,000 (no decimals when the amount is whole) / KES 1,234.50 */
export function formatKes(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `KES ${n.toLocaleString("en-KE", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** "2026-08-07" (a calendar date, no timezone shifting) -> "07 Aug 2026" */
export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "—";
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A timestamptz rendered as a Nairobi calendar date: "07 Aug 2026" */
export function formatInstantDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NAIROBI,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}

/** Nairobi calendar date (YYYY-MM-DD) for an instant, e.g. to pre-fill a date input. */
export function nairobiDateISO(value: string | Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: NAIROBI, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const INVOICE_STATUSES = ["draft", "issued", "sent", "partially_paid", "paid", "overdue", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as InvoiceStatus] ?? status;
}

/** Visual tone used by status pills (screens) and the PDF badge. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export function statusTone(status: string): StatusTone {
  switch (status) {
    case "paid":
      return "success";
    case "overdue":
      return "danger";
    case "partially_paid":
      return "warning";
    case "issued":
    case "sent":
      return "info";
    default:
      return "neutral";
  }
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  mpesa: "M-Pesa",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
  unspecified: "Not specified",
};

/** Human labels for the payment-instruction fields an administrator can configure. */
export const PAYMENT_INSTRUCTION_FIELDS: { key: string; label: string; long?: boolean }[] = [
  { key: "mpesa_paybill", label: "M-Pesa Paybill" },
  { key: "mpesa_paybill_account", label: "Paybill account no." },
  { key: "mpesa_till", label: "M-Pesa Till" },
  { key: "bank_name", label: "Bank" },
  { key: "bank_branch", label: "Branch" },
  { key: "account_name", label: "Account name" },
  { key: "account_number", label: "Account number" },
  { key: "swift_code", label: "SWIFT code" },
  { key: "reference_note", label: "Payment reference" },
  { key: "other_instructions", label: "Other instructions", long: true },
];

export type PaymentInstructions = Record<string, string> & { footer_note?: string };
