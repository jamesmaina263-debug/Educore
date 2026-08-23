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
export type BotIntent = "greeting" | "fee_balance" | "attendance" | "switch_child" | "escalate" | "unknown";

const GREETING_WORDS = ["hi", "hello", "hey", "mambo", "habari", "sasa", "vipi", "niaje"];
const FEE_WORDS = ["balance", "fee", "fees", "bakaa", "salio", "ada", "amount owed", "how much"];
const ATTENDANCE_WORDS = ["attendance", "absent", "present", "mahudhurio", "shule leo", "went to school"];
const ESCALATE_WORDS = ["agent", "human", "person", "staff", "principal", "complaint", "mwalimu", "help me", "talk to someone", "speak to"];

export function classifyIntent(rawText: string): BotIntent {
  const text = rawText.trim().toLowerCase();
  if (!text) return "unknown";

  if (ESCALATE_WORDS.some((w) => text.includes(w))) return "escalate";
  if (/^(switch|change)\b/.test(text)) return "switch_child";
  if (FEE_WORDS.some((w) => text.includes(w))) return "fee_balance";
  if (ATTENDANCE_WORDS.some((w) => text.includes(w))) return "attendance";
  if (GREETING_WORDS.some((w) => text === w || text.startsWith(w + " ") || text.startsWith(w + ","))) return "greeting";

  return "unknown";
}

// Intents that need a resolved student before a tool can run. Kept as an explicit list (rather
// than "anything not in a hardcoded switch") so a new intent added to the registry automatically
// gets disambiguation for free just by being added here -- see dispatcher.ts.
export const STUDENT_SCOPED_INTENTS: ReadonlySet<BotIntent> = new Set(["fee_balance", "attendance", "switch_child"]);
