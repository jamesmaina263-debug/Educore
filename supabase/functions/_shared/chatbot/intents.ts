// Deliberately simple keyword-based intent matching, not an LLM/NLU pipeline -- a real scope
// decision, not a corner cut silently. The two data-backed intents in scope (fee balance,
// attendance) each have a small, predictable vocabulary in English and common Sheng/Swahili
// phrasing, and a wrong bot answer about a child's fee balance is worse than an unnecessary
// escalation. Anything that doesn't clearly match falls through to escalation rather than a
// guessed answer.
//
// This is intentionally the ONLY place that needs to change if intent classification is later
// upgraded to an LLM: classifyIntent's contract (raw text in, BotIntent out) doesn't change, and
// nothing downstream (dispatcher.ts, the tool registry, tools themselves) knows or cares how the
// intent was determined. An LLM classifier still only ever picks a BotIntent + extracts a
// parameter (e.g. which child) -- it never generates the reply text itself; that still comes from
// a tool's verified data. If the vocabulary needs to grow, extend the keyword lists below; if the
// query patterns get genuinely open-ended, that's the point to bring in real NLU, not before.
export type BotIntent =
  | "greeting"
  | "fee_balance"
  | "attendance"
  | "switch_child"
  | "report_card"
  | "statement"
  | "bus"
  | "escalate"
  | "unknown";

const GREETING_WORDS = ["hi", "hello", "hey", "mambo", "habari", "sasa", "vipi", "niaje"];
const FEE_WORDS = ["balance", "fee", "fees", "bakaa", "salio", "ada", "amount owed", "how much"];
const ATTENDANCE_WORDS = ["attendance", "absent", "present", "mahudhurio", "shule leo", "went to school"];
// Document requests (WhatsApp bot documents, feature.bot.documents). Only ever consulted when the
// school has the feature on, so a school without it classifies these messages exactly as before.
const STATEMENT_WORDS = ["statement", "fee statement", "statement of account"];
const REPORT_CARD_WORDS = ["report card", "reportcard", "report", "results", "result", "matokeo", "ripoti"];
const ESCALATE_WORDS = ["agent", "human", "person", "staff", "principal", "complaint", "mwalimu", "help me", "talk to someone", "speak to"];

export function classifyIntent(rawText: string, opts: { documents?: boolean; bus?: boolean } = {}): BotIntent {
  const text = rawText.trim().toLowerCase();
  if (!text) return "unknown";

  if (ESCALATE_WORDS.some((w) => text.includes(w))) return "escalate";
  if (/^(switch|change)\b/.test(text)) return "switch_child";
  // Before the fee words on purpose: "fee statement" must not be answered as a balance.
  if (opts.documents && STATEMENT_WORDS.some((w) => text.includes(w))) return "statement";
  if (FEE_WORDS.some((w) => text.includes(w))) return "fee_balance";
  if (ATTENDANCE_WORDS.some((w) => text.includes(w))) return "attendance";
  // WP 5.3 bot part: only produced when the school has live bus tracking AND the parent bus view on (see
  // dispatcher.ts). Placed after fees and attendance so "bus fee balance" stays a fee question. With the
  // option off, a bus message classifies exactly as before (unknown, so it goes to the school office).
  if (opts.bus && /(^|[^a-z])(bus|buses|basi|school bus|school van|schoolbus)([^a-z]|$)/.test(text)) return "bus";
  // After fee and attendance so "attendance report" stays an attendance question.
  if (opts.documents && REPORT_CARD_WORDS.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text))) return "report_card";
  if (GREETING_WORDS.some((w) => text === w || text.startsWith(w + " ") || text.startsWith(w + ","))) return "greeting";

  return "unknown";
}

// Intents that need a resolved student before a tool can run. Kept as an explicit list (rather
// than "anything not in a hardcoded switch") so a new intent added to the registry automatically
// gets disambiguation for free just by being added here -- see dispatcher.ts.
export const STUDENT_SCOPED_INTENTS: ReadonlySet<BotIntent> = new Set(["fee_balance", "attendance", "switch_child", "report_card", "statement", "bus"]);
