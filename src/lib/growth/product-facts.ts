// Approved product knowledge for Growth Engine AI prompts (outreach drafts now; sales assistant later).
//
// Why this file exists: the outreach scoring prompt used to hard-code what EduCore "covers" inline, so
// nothing checked those claims against the product. Every claim below names the code that proves it
// (`evidence`), and product-facts.test.ts fails if an evidence file disappears or if the trial / price
// wording drifts from its existing source of truth. To add a claim, verify it in the repository first,
// then add it here with its evidence. Do NOT add anything you cannot point at.
//
// What is deliberately NOT here: discounts, custom prices, customer names, statistics, implementation
// timelines, integrations that are not live, and any regulator endorsement.

import { TRIAL_TERMS } from "@/lib/marketing/trial";

export type PitchLevel = "kindergarten" | "primary" | "secondary" | "other";

export type ProductFact = {
  id: string;
  /** Wording the AI is allowed to use, already phrased conservatively. */
  claim: string;
  /** Repo path (relative to the project root) that proves the claim. Checked to exist by the test. */
  evidence: string;
  /** Limit a claim to these levels. Omitted = every level. */
  levels?: PitchLevel[];
};

// The published headline rate. Mirrors `const PRICE_LINE = "From KES 100"` in the pricing page; a test
// compares the two so this cannot silently drift. Schools can have per-school billing terms, so the AI
// may only ever quote the published rate, never a discount or an override.
export const PUBLISHED_PRICE_KES_PER_STUDENT_TERM = 100;

export const VERIFIED_FACTS: readonly ProductFact[] = [
  {
    id: "kenya-first",
    claim: "EduCore is a cloud school management system built for Kenyan schools.",
    evidence: "src/lib/site.ts",
  },
  {
    id: "admissions",
    claim: "Admissions and student records.",
    evidence: "supabase/migrations/20260810064645_phase10_applications_core.sql",
  },
  {
    id: "attendance",
    claim: "Student attendance marking and records.",
    evidence: "supabase/migrations/20260729114422_phase1_item4_audit_log_and_attendance_schema.sql",
  },
  {
    id: "fees-mpesa",
    claim: "Fee management with M-Pesa collection (each school connects its own M-Pesa details).",
    evidence: "supabase/migrations/20260821235834_mpesa_stk_push_infrastructure.sql",
  },
  {
    id: "parent-comms",
    claim: "Parent communication by SMS and WhatsApp.",
    evidence: "supabase/migrations/20260823173623_whatsapp_chatbot_infrastructure.sql",
  },
  {
    id: "grading-scales",
    claim: "Exams and report cards with CBC (competency-based) and marks-based grading scales.",
    evidence: "supabase/migrations/20260730151424_exams_grading_scales.sql",
    levels: ["primary", "secondary", "other"],
  },
  {
    id: "competency-reports",
    claim: "Competency-based learner progress reports, with CBC competency ratings by sub-strand.",
    evidence: "src/components/exams/report-card-list.tsx",
  },
  {
    id: "pre-primary",
    claim: "Supports Pre-Primary (PP1 and PP2) classes and the pre-primary activity areas.",
    evidence: "supabase/migrations/20260929190358_lower_grade_subject_catalogue.sql",
    levels: ["kindergarten"],
  },
  {
    id: "trial",
    claim: `${TRIAL_TERMS} Sign-in pauses at the end of the trial until a plan is agreed.`,
    evidence: "src/lib/marketing/trial.ts",
  },
  {
    id: "price",
    claim: `Published pricing is from KES ${PUBLISHED_PRICE_KES_PER_STUDENT_TERM} per student per term.`,
    evidence: "src/app/(marketing)/pricing/page.tsx",
  },
];

// Hard rules for any outbound or sales wording. These are prompt instructions only; they are not a
// security boundary (a human still approves every message), but they stop the common failure modes.
export const PITCH_RULES: readonly string[] = [
  "Never claim approval, certification, endorsement or affiliation by KICD, the Ministry of Education, KNEC, Safaricom or any government body or regulator. Do not use the words 'approved', 'certified', 'accredited' or 'official' about EduCore.",
  "Never state any price other than the published rate above. Never offer or imply a discount, a free extension or custom terms. Never write any pricing or free-of-charge wording yourself: the only free offer is a fixed sentence the system adds for children's homes, outside your output.",
  "Never mention customer names, testimonials, statistics, awards or results.",
  "Never promise an integration, feature, timeline or availability that is not in the list above.",
  "Never mention competitors.",
];

const KINDERGARTEN_GUIDANCE =
  "This is a kindergarten / nursery. Pitch parent communication, attendance, fee collection with M-Pesa and competency-based learner progress reports. Do not mention exams, KCPE, KCSE, KJSEA, marks, grades or rankings. Do not claim the reports are designed specifically for pre-primary children.";

/** Facts that apply to a level. An unknown level gets only the level-neutral facts. */
export function factsForLevel(level: PitchLevel | null | undefined): ProductFact[] {
  return VERIFIED_FACTS.filter((f) => !f.levels || (level ? f.levels.includes(level) : false));
}

/** The block of text placed in an AI prompt. Everything the model may claim comes from here. */
export function renderProductFactsForPrompt(level: PitchLevel | null | undefined): string {
  const lines = factsForLevel(level).map((f) => `- ${f.claim}`);
  const parts = [
    "EduCore facts you may use. These are the ONLY product claims you may make:",
    ...lines,
    "",
    "Rules about claims:",
    ...PITCH_RULES.map((r) => `- ${r}`),
  ];
  if (level === "kindergarten") parts.push("", KINDERGARTEN_GUIDANCE);
  return parts.join("\n");
}
