// Staff loans and salary advances (WP 7.2). Pure helpers shared by the page, the server actions and tests.
// The database functions (create_staff_loan, approve_staff_loan, record_staff_loan_repayment, staff_loan_due_for_record)
// re-check every rule here and are the only authority, including the Employment Act deduction limits. This file only
// gives people a clear message before a round trip and keeps the arithmetic exact. It moves no money.

export const STAFF_LOANS_FLAG = "feature.hr.staff_loans";

export const LOAN_KINDS = ["loan", "advance"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const KIND_LABELS: Record<LoanKind, string> = { loan: "Loan", advance: "Salary advance" };

export const LOAN_STATUSES = ["pending", "active", "paid_off", "cancelled"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Waiting for approval",
  active: "Active",
  paid_off: "Paid off",
  cancelled: "Cancelled",
};

export const MAX_PRINCIPAL = 5_000_000;
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatPeriod(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? "?"} ${year}`;
}

/** Whole cents, so 0.1 + 0.2 style float noise never reaches a balance. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function validateMoney(raw: string, max: number): { error: string } | { value: number } {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter an amount in shillings, with at most 2 decimal places." };
  const v = Number(t);
  if (v <= 0) return { error: "The amount must be more than zero." };
  if (v > max) return { error: `The most allowed here is KES ${max.toLocaleString("en-KE")}.` };
  return { value: v };
}

export interface LoanInput {
  staffId: string;
  kind: LoanKind;
  principal: string;
  installment: string;
  firstYear: number;
  firstMonth: number;
  reason: string;
}

export function validateLoan(i: LoanInput): { error: string } | { value: { staffId: string; kind: LoanKind; principal: number; installment: number; firstYear: number; firstMonth: number; reason: string } } {
  if (!i.staffId) return { error: "Choose the staff member." };
  if (!LOAN_KINDS.includes(i.kind)) return { error: "Choose loan or salary advance." };
  const principal = validateMoney(i.principal, MAX_PRINCIPAL);
  if ("error" in principal) return { error: `Amount lent: ${principal.error}` };
  const installment = validateMoney(i.installment, MAX_PRINCIPAL);
  if ("error" in installment) return { error: `Monthly deduction: ${installment.error}` };
  if (toCents(installment.value) > toCents(principal.value)) return { error: "The monthly deduction cannot be more than the amount lent." };
  if (!Number.isInteger(i.firstYear) || i.firstYear < 2000 || i.firstYear > 2100) return { error: "Choose a valid first deduction year." };
  if (!Number.isInteger(i.firstMonth) || i.firstMonth < 1 || i.firstMonth > 12) return { error: "Choose a valid first deduction month." };
  if (i.reason.length > 200) return { error: "The reason is too long (200 characters at most)." };
  return { value: { staffId: i.staffId, kind: i.kind, principal: principal.value, installment: installment.value, firstYear: i.firstYear, firstMonth: i.firstMonth, reason: i.reason.trim() } };
}

/** How many monthly deductions it takes, if every one is the full instalment (the legal caps may stretch this). */
export function monthsToClear(balance: number, installment: number): number {
  if (balance <= 0 || installment <= 0) return 0;
  return Math.ceil(toCents(balance) / toCents(installment));
}

/** The month the last full-size deduction would fall in, counting from the first deduction month. */
export function expectedLastPeriod(firstYear: number, firstMonth: number, months: number): { year: number; month: number } | null {
  if (months < 1) return null;
  const index = firstYear * 12 + (firstMonth - 1) + (months - 1);
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function validateAgreementDate(raw: string, todayIso: string): { error: string } | { value: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Enter the date the staff member signed the written agreement." };
  if (raw > todayIso) return { error: "The agreement cannot be dated in the future." };
  return { value: raw };
}

export function validateReason(raw: string): { error: string } | { value: string } {
  const t = raw.trim();
  if (t.length < 3 || t.length > 200) return { error: "Give a reason (3 to 200 characters)." };
  return { value: t };
}

export interface DueResult {
  total: number;
  capped: boolean;
  cap: number;
  lines: { loanId: string; kind: LoanKind; amount: number; name: string }[];
}

export function parseDue(raw: unknown): DueResult | null {
  const d = raw as { total?: number | string; capped?: boolean; cap?: number | string; lines?: { loan_id: string; kind: LoanKind; amount: number | string; name: string }[] } | null;
  if (!d || d.total === undefined) return null;
  return {
    total: Number(d.total),
    capped: !!d.capped,
    cap: Number(d.cap ?? 0),
    lines: (d.lines ?? []).map((l) => ({ loanId: l.loan_id, kind: l.kind, amount: Number(l.amount), name: l.name })),
  };
}
