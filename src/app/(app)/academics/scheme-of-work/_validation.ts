// Deliberately NOT "use server": actions.ts requires every export to be an
// async Server Action (Next.js enforces this at build time -- next build
// caught this the hard way when validateEntryInput was first added there
// directly as a plain sync export: "Server Actions must be async
// functions"). This pure, synchronous validator -- and the plain data shape
// it validates -- live here instead, imported by actions.ts for internal
// use and by actions.test.ts for direct unit testing.

export interface SchemeEntryInput {
  scheme_id: string;
  week_number: number;
  lesson_number: number;
  entry_date: string;
  topic: string;
  subtopic: string;
  learning_outcomes: string;
  content: string;
  activities: string;
  teaching_methods: string;
  resources: string;
  assessment_methods: string;
  references: string;
  remarks: string;
}

export function validateEntryInput(input: SchemeEntryInput): string | null {
  if (!input.scheme_id?.trim()) return "Missing scheme.";
  if (!Number.isInteger(input.week_number) || input.week_number <= 0 || input.week_number > 52) return "Invalid week number.";
  if (!Number.isInteger(input.lesson_number) || input.lesson_number <= 0 || input.lesson_number > 20) return "Invalid lesson number.";
  if (!input.topic?.trim()) return "A topic is required.";
  if (input.entry_date?.trim() && Number.isNaN(Date.parse(input.entry_date))) return "Invalid entry date.";
  return null;
}
