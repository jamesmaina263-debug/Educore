// Pure helpers for Finance > Vote heads > "Export for accounting software" (Phase 6.3).
//
// File-based only: this turns the existing vote head ledger (WP 6.2, `vote_head_ledger`) into balanced
// journal lines and two CSV layouts (QuickBooks Online journal import, Sage 50 journal import). It reads
// nothing itself, writes nothing, calls no external service and moves no money. The ledger is accrual:
// income = what was invoiced, spending = approved expenses (payments are not part of it).
//
// All arithmetic is in integer cents so a journal always balances to the cent.

import type { LedgerLine } from "@/lib/vote-heads";

export type AccountingFormat = "quickbooks" | "sage";

export interface JournalLine {
  journalNo: string;
  /** ISO date, YYYY-MM-DD */
  date: string;
  account: string;
  debitCents: number;
  creditCents: number;
  description: string;
}

export interface ExportOptions {
  /** ISO date used on every line, YYYY-MM-DD */
  date: string;
  /** Short label for the period, e.g. "Term 1 2026" or "All time" (goes into descriptions) */
  periodLabel: string;
  /** Balancing account for income journals (what learners owe the school) */
  receivableAccount: string;
  /** Balancing account for spending journals (what the school owes suppliers) */
  payableAccount: string;
  /** Optional per-vote-head account names, keyed by vote head code (e.g. TUITION -> "4000 Tuition Income") */
  accountNames?: Record<string, string>;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateExportOptions(o: ExportOptions): string | null {
  if (!isValidIsoDate(o.date)) return "Choose a valid journal date.";
  const names: [string, string][] = [
    ["Receivable account", o.receivableAccount],
    ["Payable account", o.payableAccount],
    ...Object.entries(o.accountNames ?? {}).map(([code, n]) => [`Account for ${code}`, n] as [string, string]),
  ];
  for (const [label, value] of names) {
    const v = value.trim();
    if (v.length < 1 || v.length > 100) return `${label} must be 1-100 characters.`;
    if (CONTROL_RE.test(value)) return `${label} contains invalid characters.`;
  }
  if (o.periodLabel.length > 60 || CONTROL_RE.test(o.periodLabel)) return "Period label is invalid.";
  return null;
}

function accountFor(line: LedgerLine, names: Record<string, string> | undefined): string {
  const custom = line.voteHeadId ? names?.[line.code]?.trim() : undefined;
  if (custom) return custom;
  // UNMAPPED / UNITEMISED have no vote head, so they keep their explicit, self-describing names.
  return line.voteHeadId ? `${line.code} - ${line.name}` : line.name;
}

function compactDate(iso: string): string {
  return iso.replaceAll("-", "");
}

/** Dr/Cr sides for one amount: a positive amount takes the natural side, a negative one the opposite. */
function side(cents: number, natural: "debit" | "credit"): { debitCents: number; creditCents: number } {
  const abs = Math.abs(cents);
  const useNatural = cents >= 0;
  const isDebit = natural === "debit" ? useNatural : !useNatural;
  return isDebit ? { debitCents: abs, creditCents: 0 } : { debitCents: 0, creditCents: abs };
}

/**
 * Builds up to two balanced journals from the ledger:
 *  - income:   Cr each income vote head, Dr the receivable account for the net total
 *  - spending: Dr each expense vote head, Cr the payable account for the net total
 * Zero-amount lines are skipped. A journal whose lines are all zero is omitted.
 */
export function buildJournalLines(ledger: LedgerLine[], opts: ExportOptions): JournalLine[] {
  const out: JournalLine[] = [];
  const stamp = compactDate(opts.date);
  const period = opts.periodLabel.trim() || "All time";

  const make = (kind: "income" | "expense") => {
    const rows = ledger
      .map((l) => ({ l, cents: toCents(l.amount) }))
      .filter((r) => r.l.kind === kind && r.cents !== 0);
    if (rows.length === 0) return;
    const journalNo = `EDUCORE-${kind === "income" ? "INC" : "EXP"}-${stamp}`;
    const natural = kind === "income" ? "credit" : "debit";
    const verb = kind === "income" ? "Fees invoiced" : "Approved spending";
    let net = 0;
    for (const { l, cents } of rows) {
      net += cents;
      out.push({
        journalNo,
        date: opts.date,
        account: accountFor(l, opts.accountNames),
        ...side(cents, natural),
        description: `${verb} - ${l.name} (${period})`,
      });
    }
    if (net !== 0) {
      out.push({
        journalNo,
        date: opts.date,
        account: (kind === "income" ? opts.receivableAccount : opts.payableAccount).trim(),
        ...side(net, kind === "income" ? "debit" : "credit"),
        description: `${verb} - total (${period})`,
      });
    }
  };
  make("income");
  make("expense");
  return out;
}

/** Every journal must balance to the cent. Returns the journal numbers that do not (should be none). */
export function unbalancedJournals(lines: JournalLine[]): string[] {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.journalNo, (totals.get(l.journalNo) ?? 0) + l.debitCents - l.creditCents);
  return [...totals.entries()].filter(([, diff]) => diff !== 0).map(([no]) => no);
}

/** Stops spreadsheet formula injection: a text cell starting with = + - @ (or a control char) gets a leading '. */
export function csvSafe(value: string): string {
  const v = value.replace(/[\r\n]+/g, " ").trim();
  return /^[=+\-@\t]/.test(v) ? `'${v}` : v;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** QuickBooks Online "journal entries" CSV import columns. Dates are DD/MM/YYYY: pick that format on import. */
export function toQuickBooksRows(lines: JournalLine[]): Record<string, string | number>[] {
  return lines.map((l) => ({
    "*JournalNo": l.journalNo,
    "*JournalDate": ddmmyyyy(l.date),
    "*AccountName": csvSafe(l.account),
    "*Debits": l.debitCents ? money(l.debitCents) : "",
    "*Credits": l.creditCents ? money(l.creditCents) : "",
    Description: csvSafe(l.description),
  }));
}

/** Sage 50 journal import columns (JD = debit, JC = credit). Nominal codes must match the school's chart. */
export function toSageRows(lines: JournalLine[]): Record<string, string | number>[] {
  return lines.map((l) => ({
    Type: l.debitCents ? "JD" : "JC",
    "Account Reference": "",
    "Nominal A/C Ref": csvSafe(l.account),
    Date: ddmmyyyy(l.date),
    Reference: l.journalNo,
    Details: csvSafe(l.description),
    "Net Amount": money(l.debitCents || l.creditCents),
    "Tax Code": "T9",
    "Tax Amount": "0.00",
  }));
}

export function exportFilename(format: AccountingFormat, date: string): string {
  return `educore-journal-${format === "quickbooks" ? "quickbooks" : "sage"}-${compactDate(date)}.csv`;
}
