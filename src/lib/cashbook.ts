// Pure helpers for Finance > Cashbook (WP 6.1, read-only). The database functions cashbook_entries,
// cashbook_summary and cashbook_reconciliation do the accounting; these helpers only shape what the
// page shows (dates, running balance, labels, the reconciliation verdict).

export const CASHBOOK_FLAG = "feature.finance.cashbook";

export type CashbookKind = "receipt" | "reversal" | "expense";

export interface CashbookEntry {
  entryDate: string; // YYYY-MM-DD, Kenya calendar day
  kind: CashbookKind;
  account: string;
  reference: string | null;
  description: string;
  moneyIn: number;
  moneyOut: number;
  sourceId: string;
}

export interface CashbookAccountSummary {
  account: string;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  entries: number;
}

export interface CashbookReconciliation {
  receiptsDifference: number;
  reversalsDifference: number;
  expensesDifference: number;
}

export interface CashbookRow extends CashbookEntry {
  balance: number;
}

export const ENTRY_LIMIT = 2000;

const ACCOUNT_LABELS: Record<string, string> = {
  cash: "Cash",
  mpesa: "M-Pesa",
  bank: "Bank",
  cheque: "Cheque",
  unspecified: "Not recorded (expenses)",
};

export function accountLabel(account: string): string {
  return ACCOUNT_LABELS[account] ?? account;
}

export const KIND_LABELS: Record<CashbookKind, string> = {
  receipt: "Receipt",
  reversal: "Reversal",
  expense: "Expense",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts only a real calendar date in YYYY-MM-DD form; anything else becomes null. */
export function parseDateParam(value: string | undefined | null): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return value;
}

/** Kenya calendar day for an instant, as YYYY-MM-DD. */
export function kenyaDay(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
}

/** Default window: the first day of the current Kenya month up to today. */
export function defaultWindow(now: Date = new Date()): { from: string; to: string } {
  const today = kenyaDay(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Resolves the requested window, swapping the dates if they were given the wrong way round. */
export function resolveWindow(
  fromParam: string | undefined,
  toParam: string | undefined,
  now: Date = new Date(),
): { from: string; to: string } {
  const fallback = defaultWindow(now);
  const from = parseDateParam(fromParam) ?? fallback.from;
  const to = parseDateParam(toParam) ?? fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Adds a running balance to date-ordered entries, starting from the opening balance. */
export function withRunningBalance(entries: CashbookEntry[], opening: number): CashbookRow[] {
  let balance = opening;
  return entries.map((e) => {
    balance = Math.round((balance + e.moneyIn - e.moneyOut) * 100) / 100;
    return { ...e, balance };
  });
}

export function summaryTotals(rows: CashbookAccountSummary[]): {
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
  entries: number;
} {
  const t = { opening: 0, moneyIn: 0, moneyOut: 0, closing: 0, entries: 0 };
  for (const r of rows) {
    t.opening += r.opening;
    t.moneyIn += r.moneyIn;
    t.moneyOut += r.moneyOut;
    t.closing += r.closing;
    t.entries += r.entries;
  }
  return {
    opening: Math.round(t.opening * 100) / 100,
    moneyIn: Math.round(t.moneyIn * 100) / 100,
    moneyOut: Math.round(t.moneyOut * 100) / 100,
    closing: Math.round(t.closing * 100) / 100,
    entries: t.entries,
  };
}

/** True only when every difference is exactly zero (the cashbook adds up to the raw records). */
export function reconciles(r: CashbookReconciliation): boolean {
  return r.receiptsDifference === 0 && r.reversalsDifference === 0 && r.expensesDifference === 0;
}

/** More entries in the window than the page asked for: say so instead of silently cutting the list. */
export function isTruncated(totalEntries: number, shown: number): boolean {
  return totalEntries > shown;
}
