// Pure helpers for the Finance > Reconciliation "Check an M-Pesa code" panel (WP 1.2).
// Mirrors the validation inside the database function public.check_mpesa_code(text), which
// remains the authority; this only avoids a round trip for obviously malformed input.

export type MpesaCodeVerdict = "recorded" | "seen_not_recorded" | "not_found";

export interface MpesaCodePayment {
  payment_id: string;
  amount: number;
  status: string;
  source: string;
  recorded_at: string | null;
  student_id: string | null;
  student_name: string | null;
  admission_number: string | null;
}

export interface MpesaCodeStatementLine {
  amount: number;
  match_status: string;
  transaction_time: string | null;
  matched_payment_id: string | null;
  uploaded_at: string;
}

export interface MpesaCodeC2bEvent {
  amount: number;
  outcome: string;
  match_rule: string | null;
  transaction_time: string | null;
  payment_id: string | null;
  received_at: string;
}

export interface MpesaCodeResult {
  code: string;
  verdict: MpesaCodeVerdict;
  payments: MpesaCodePayment[];
  statement_lines: MpesaCodeStatementLine[];
  c2b_events: MpesaCodeC2bEvent[];
  c2b_checked: boolean;
}

const CODE_RE = /^[A-Z0-9]{8,16}$/;

/** Uppercase and strip all whitespace, the same normalisation the database applies. */
export function normalizeMpesaCode(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

export function isValidMpesaCode(input: string): boolean {
  return CODE_RE.test(normalizeMpesaCode(input));
}

export function verdictMessage(verdict: MpesaCodeVerdict): string {
  switch (verdict) {
    case "recorded":
      return "Recorded: this code is already a payment in the system.";
    case "seen_not_recorded":
      return "Seen but not recorded: this code appears on a statement or was received by auto-capture, but no payment has been recorded for it.";
    case "not_found":
      return "Not found: nothing in the system, uploaded statements or auto-capture matches this code.";
  }
}

/** Narrow an untrusted RPC payload to MpesaCodeResult; returns null if the shape is wrong. */
export function parseMpesaCodeResult(data: unknown): MpesaCodeResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const verdict = d.verdict;
  if (verdict !== "recorded" && verdict !== "seen_not_recorded" && verdict !== "not_found") return null;
  if (typeof d.code !== "string") return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    code: d.code,
    verdict,
    payments: arr(d.payments) as MpesaCodePayment[],
    statement_lines: arr(d.statement_lines) as MpesaCodeStatementLine[],
    c2b_events: arr(d.c2b_events) as MpesaCodeC2bEvent[],
    c2b_checked: d.c2b_checked === true,
  };
}
