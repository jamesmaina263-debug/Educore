// Pure helpers for the Finance > Paybill screen (Phase 1.1d). No I/O, so vitest can cover them.

export type C2bOutcome =
  | "received"
  | "log_only"
  | "allocated"
  | "unallocated"
  | "duplicate"
  | "deferred_to_stk"
  | "failed";

export type C2bMode = "log_only" | "live";
export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const OUTCOME_META: Record<C2bOutcome, { label: string; tone: BadgeTone }> = {
  received: { label: "Received", tone: "info" },
  log_only: { label: "Logged only", tone: "neutral" },
  allocated: { label: "Allocated", tone: "success" },
  unallocated: { label: "Needs a person", tone: "warning" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  deferred_to_stk: { label: "Waiting for STK", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export function outcomeMeta(outcome: string): { label: string; tone: BadgeTone } {
  return OUTCOME_META[outcome as C2bOutcome] ?? { label: outcome, tone: "neutral" };
}

const MATCH_LABELS: Record<string, string> = {
  exact: "Exact admission number",
  typo_repair: "Repaired typo (one learner)",
  ambiguous: "More than one learner",
  none: "No learner found",
};

export function matchRuleLabel(rule: string | null): string {
  if (!rule) return "";
  return MATCH_LABELS[rule] ?? rule;
}

/**
 * In log-only mode the database records the plan as `would_be=<plan>` in `notes`. Returns the plan
 * text, or null when the notes carry none. Only the first token after `would_be=` up to a `;` or
 * line end is taken, and it is capped so a surprising value can never flood the table.
 */
export function parseWouldBe(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = /would_be=([^;\n]+)/.exec(notes);
  if (!m) return null;
  const plan = m[1].trim();
  return plan ? plan.slice(0, 120) : null;
}

/** The only accepted confirmation text for going live. Exact, case-sensitive, surrounding spaces ignored. */
export const LIVE_CONFIRMATION_WORD = "LIVE";

export function isLiveConfirmationValid(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim() === LIVE_CONFIRMATION_WORD;
}

/** Can the UI offer "go live"? (The database enforces the same rule; this only decides what to show.) */
export function canOfferLive(input: {
  exists: boolean;
  mode: C2bMode | null;
  registered: boolean;
  isOwner: boolean;
  isTill?: boolean;
}): boolean {
  // A till carries no account number, so auto-capture can never match it: never offer going live.
  if (input.isTill) return false;
  return input.isOwner && input.exists && input.registered && input.mode === "log_only";
}

/** Plain-language message for a failure from c2b_set_mode (SQLSTATE codes). Never echoes raw database text. */
export function describeModeError(code: string | null | undefined): string {
  switch (code) {
    case "42501":
      return "Only the school owner can change this, and paybill auto-capture must be switched on for your school.";
    case "55000":
      return "Cannot go live yet: the confirmation URL has not been registered with Safaricom.";
    case "P0002":
      return "Paybill auto-capture has not been set up for your school yet. Ask your EduCore administrator.";
    case "22023":
      return "That change was not understood. Please refresh and try again.";
    default:
      return "Could not change the mode. Please refresh and try again.";
  }
}
