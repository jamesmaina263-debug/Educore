// Kept out of remark-bank-actions.ts on purpose: a "use server" module can only export async
// functions, so a constant exported from there throws at runtime and takes down every server
// action bundled with it (e.g. report-card generation).
export const REMARK_BANK_CATEGORIES = [
  { value: "strength", label: "Strength" },
  { value: "progress", label: "Progress" },
  { value: "needs_support", label: "Needs Support" },
  { value: "communication_and_collaboration", label: "Communication & Collaboration" },
  { value: "critical_thinking_and_problem_solving", label: "Critical Thinking & Problem Solving" },
  { value: "creativity_and_imagination", label: "Creativity & Imagination" },
  { value: "citizenship", label: "Citizenship" },
  { value: "digital_literacy", label: "Digital Literacy" },
  { value: "learning_to_learn", label: "Learning to Learn" },
  { value: "self_efficacy", label: "Self-Efficacy" },
  { value: "general", label: "General" },
] as const;

export type RemarkBankCategory = (typeof REMARK_BANK_CATEGORIES)[number]["value"];
