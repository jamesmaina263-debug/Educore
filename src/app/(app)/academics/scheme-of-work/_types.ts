// Pure types + constants shared between _data.ts (server-only: imports
// createClient/getCachedUser) and the "use client" components in
// components/academics/scheme-of-work/. Client components must import from
// here, never from _data.ts directly -- importing a server-only module
// from a client component breaks the build (caught by `next build`, not by
// tsc/eslint, since it's a bundler-level boundary rule, not a type error).

export interface FilterOption {
  id: string;
  label: string;
}

export interface SchemeListRow {
  id: string;
  status: string;
  origin: "manual" | "ai_generated";
  total_weeks: number;
  lessons_per_week: number;
  updated_at: string;
  subject_name: string;
  class_name: string;
  stream_name: string | null;
  teacher_name: string;
  term_label: string;
  entries_total: number;
  entries_completed: number;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
};

export interface TeachingAssignmentOption {
  stream_id: string;
  subject_id: string;
  class_id: string;
  class_name: string;
  stream_name: string;
  subject_name: string;
  lessons_per_week: number | null;
}

export interface CreateSchemeOptions {
  userName: string;
  userRole?: string;
  schoolName?: string;
  canWrite: boolean;
  canGenerateAI: boolean;
  yearOptions: FilterOption[];
  termOptions: FilterOption[];
  classOptions: FilterOption[];
  streamOptions: (FilterOption & { class_id: string })[];
  subjectOptions: FilterOption[];
  assignments: TeachingAssignmentOption[];
}

export interface SchemeEntryRow {
  id: string;
  week_number: number;
  lesson_number: number;
  entry_date: string | null;
  topic: string;
  subtopic: string | null;
  learning_outcomes: string | null;
  content: string | null;
  activities: string | null;
  teaching_methods: string | null;
  resources: string | null;
  assessment_methods: string | null;
  references: string | null;
  remarks: string | null;
  completion_status: string;
  source: string;
}

export interface SchemeDetailContext {
  userName: string;
  userRole?: string;
  schoolName?: string;
  scheme: {
    id: string;
    status: string;
    origin: string;
    total_weeks: number;
    lessons_per_week: number;
    teacher_id: string;
    review_comment: string | null;
    subject_name: string;
    class_name: string;
    stream_name: string | null;
    teacher_name: string;
    term_label: string;
  } | null;
  entries: SchemeEntryRow[];
  canEdit: boolean;
  canReview: boolean;
  canGenerateAI: boolean;
  isOwner: boolean;
}
