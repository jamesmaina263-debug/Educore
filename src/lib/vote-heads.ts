// Pure helpers for Finance > Vote heads (Phase 6.2). Mirrors the validation in the database functions
// (create_vote_head / set_vote_head_mapping) so the form can explain a problem before calling them.

export const VOTE_HEAD_FLAG = "feature.finance.vote_heads";

export type VoteHeadKind = "income" | "expense";
export type MappingSource = "invoice_item" | "expense_category";

export const RESERVED_CODES = ["UNMAPPED", "UNITEMISED"] as const;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Same normalisation the database uses for matching: lower(btrim(name)). */
export function normaliseMatchKey(name: string): string {
  return name.trim().toLowerCase();
}

export function sourceForKind(kind: VoteHeadKind): MappingSource {
  return kind === "income" ? "invoice_item" : "expense_category";
}

export function validateVoteHead(input: { code: string; name: string; kind: string }):
  | { error: string }
  | { value: { code: string; name: string; kind: VoteHeadKind } } {
  const code = normaliseCode(input.code);
  const name = input.name.trim();
  if (!CODE_RE.test(code)) return { error: "Code must be 1-20 letters, digits, dash or underscore (e.g. TUITION)." };
  if ((RESERVED_CODES as readonly string[]).includes(code)) return { error: "That code is reserved." };
  if (name.length < 1 || name.length > 80) return { error: "Name must be 1-80 characters." };
  if (input.kind !== "income" && input.kind !== "expense") return { error: "Choose income or expense." };
  return { value: { code, name, kind: input.kind } };
}

/** Distinct names (case/space-insensitive) that have no mapping yet, first spelling kept, sorted. */
export function unmappedNames(names: string[], mappedKeys: Iterable<string>): string[] {
  const mapped = new Set(mappedKeys);
  const seen = new Map<string, string>();
  for (const n of names) {
    const key = normaliseMatchKey(n);
    if (!key || mapped.has(key) || seen.has(key)) continue;
    seen.set(key, n.trim());
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export interface LedgerLine {
  voteHeadId: string | null;
  code: string;
  name: string;
  kind: VoteHeadKind;
  lines: number;
  amount: number;
}

export function totalsByKind(rows: LedgerLine[]): { income: number; expense: number; net: number } {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.kind === "income") income += r.amount;
    else expense += r.amount;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when the ledger fully explains the source totals (both differences are zero). */
export function reconciles(r: { incomeDifference: number; expenseDifference: number }): boolean {
  return round2(r.incomeDifference) === 0 && round2(r.expenseDifference) === 0;
}
