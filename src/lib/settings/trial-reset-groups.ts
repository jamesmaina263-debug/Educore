// "Start fresh" for trial schools: the groups of test data an owner can tick, which groups depend on which,
// and which Storage buckets hold each group's uploaded files.
//
// This mirrors the database function public.reset_trial_school_data (migration 20261031190000). The function is
// the authority -- it re-checks every rule -- but the UI needs the same map to auto-tick dependencies and the
// server action needs it to know which files to remove. trial-reset-groups.test.ts reads the migration and
// fails if the two ever drift apart.

export const RESET_GROUP_KEYS = ["fees", "academics", "applications", "other", "students", "setup"] as const;
export type ResetGroupKey = (typeof RESET_GROUP_KEYS)[number];

export interface ResetGroup {
  key: ResetGroupKey;
  label: string;
  description: string;
  /** Groups that must be removed together with this one (they point at it). Direct requirements only. */
  requires: ResetGroupKey[];
  /** Storage buckets whose `<school id>/...` files belong to this group. */
  buckets: string[];
}

export const RESET_GROUPS: ResetGroup[] = [
  {
    key: "fees",
    label: "Fees, invoices and payments",
    description:
      "Invoices, payments, receipts, M-Pesa payment requests, fee waivers and discounts, and admission enrolment records.",
    requires: [],
    buckets: [],
  },
  {
    key: "academics",
    label: "Exams, marks and attendance",
    description: "Exams, marks, report cards, competency records, assignments and student attendance.",
    requires: [],
    buckets: ["assignment-attachments", "competency-evidence"],
  },
  {
    key: "applications",
    label: "Admission applications",
    description: "Applications received through the admission form, including their uploaded documents.",
    requires: [],
    buckets: ["application-documents"],
  },
  {
    key: "other",
    label: "Other module records",
    description:
      "Health and sick-bay, discipline and welfare, library, certificates, announcements, schemes of work, staff reviews and NEMIS batches.",
    requires: [],
    buckets: ["announcement-attachments"],
  },
  {
    key: "students",
    label: "Students and parents",
    description:
      "Student records and everything attached to them, plus parent and guardian records. Needs fees, exams and attendance, applications and other module records removed too.",
    requires: ["fees", "academics", "applications", "other"],
    buckets: ["student-documents"],
  },
  {
    key: "setup",
    label: "Classes, terms, subjects and fee structures",
    description:
      "Your set-up: academic years, terms, classes, streams, subjects, timetables, grading scales and fee structures. Only tick this if you want to rebuild your set-up from scratch.",
    requires: ["students"],
    buckets: ["curriculum-documents"],
  },
];

/** Never touched by a reset, shown to the owner so they know what stays. */
export const ALWAYS_KEPT: string[] = [
  "Your school profile, logo and branding",
  "Staff accounts, roles and permissions",
  "Your subscription and plan",
  "Your admission form template",
  "M-Pesa and other integration settings",
];

/** Buckets a reset must never empty, even if a group list is edited by mistake. */
export const PROTECTED_BUCKETS = ["admission-form-templates", "school-logos", "staff-documents"] as const;

export function isGroupKey(v: unknown): v is ResetGroupKey {
  return typeof v === "string" && (RESET_GROUP_KEYS as readonly string[]).includes(v);
}

const BY_KEY = new Map(RESET_GROUPS.map((g) => [g.key, g]));

/** Validate untrusted input. Returns de-duplicated, canonically ordered keys, or null if anything is invalid. */
export function sanitizeGroups(input: unknown): ResetGroupKey[] | null {
  if (!Array.isArray(input)) return null;
  if (!input.every(isGroupKey)) return null;
  const set = new Set<ResetGroupKey>(input);
  return RESET_GROUP_KEYS.filter((k) => set.has(k));
}

/**
 * Everything that has to be removed together with `selected` (transitively). `added` is what the caller
 * did not tick but is required, so the UI can tick it and say why.
 */
export function withDependencies(selected: ResetGroupKey[]): { groups: ResetGroupKey[]; added: ResetGroupKey[] } {
  const closed = new Set<ResetGroupKey>(selected);
  const stack = [...selected];
  while (stack.length > 0) {
    const key = stack.pop() as ResetGroupKey;
    for (const dep of BY_KEY.get(key)?.requires ?? []) {
      if (!closed.has(dep)) {
        closed.add(dep);
        stack.push(dep);
      }
    }
  }
  const groups = RESET_GROUP_KEYS.filter((k) => closed.has(k));
  const added = groups.filter((k) => !selected.includes(k));
  return { groups, added };
}

/** Storage buckets to empty (this school's folder only) for the given groups. */
export function bucketsFor(groups: ResetGroupKey[]): string[] {
  const out = new Set<string>();
  for (const key of groups) {
    for (const b of BY_KEY.get(key)?.buckets ?? []) {
      if (!(PROTECTED_BUCKETS as readonly string[]).includes(b)) out.add(b);
    }
  }
  return [...out];
}

/**
 * Unticking `key` also unticks every ticked group that requires it. For example, if "Fees" is unticked then
 * "Students" must be unticked too, because removing students needs the fees that point at them removed first.
 */
export function removeWithDependents(selected: ResetGroupKey[], key: ResetGroupKey): ResetGroupKey[] {
  return selected.filter((k) => k !== key && !withDependencies([k]).groups.includes(key));
}
