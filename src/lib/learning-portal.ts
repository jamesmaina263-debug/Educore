// Learning portal lite (WP 8.1). Pure helpers shared by the staff page, the learner portal section, the
// server actions and tests. The database functions (save_learning_resource, save_learning_quiz,
// submit_learning_quiz) re-check every rule here; this file only gives people a clear message before a
// round trip. Nothing here sends a message, takes a payment or uploads a file: links only.

export const LEARNING_FLAG = "feature.learning.portal";

export const RESOURCE_KINDS = ["note", "video", "past_paper", "live_lesson", "link"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  note: "Note",
  video: "Video",
  past_paper: "Past paper",
  live_lesson: "Live lesson",
  link: "Link",
};

export const QUIZ_STATUSES = ["draft", "published", "closed"] as const;
export type QuizStatus = (typeof QUIZ_STATUSES)[number];
export const QUIZ_STATUS_LABELS: Record<QuizStatus, string> = { draft: "Draft", published: "Published", closed: "Closed" };

export const MAX_QUESTIONS = 50;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

const HTTPS_RE = /^https:\/\/\S+$/i;

export function isHttpsUrl(v: string): boolean {
  return v.length <= 500 && HTTPS_RE.test(v);
}

export interface ResourceInput {
  id: string | null;
  streamId: string;
  subjectId: string;
  kind: ResourceKind;
  title: string;
  body: string;
  url: string;
  startsAt: string; // datetime-local string or ""
  paperYear: string; // "" or digits
  published: boolean;
}

export function validateResource(i: ResourceInput): { error: string } | { value: ResourceInput } {
  const title = i.title.trim();
  const body = i.body.trim();
  const url = i.url.trim();
  if (!i.streamId) return { error: "Choose a class." };
  if (!i.subjectId) return { error: "Choose a subject." };
  if (!RESOURCE_KINDS.includes(i.kind)) return { error: "Choose what kind of material this is." };
  if (title.length < 1 || title.length > 150) return { error: "Give it a title (150 characters at most)." };
  if (i.kind === "note") {
    if (!body) return { error: "Write the note." };
    if (body.length > 8000) return { error: "The note is too long (8000 characters at most)." };
  } else {
    if (!url) return { error: "Add the link." };
    if (!isHttpsUrl(url)) return { error: "The link must start with https:// and have no spaces." };
  }
  if (i.kind === "live_lesson" && !i.startsAt) return { error: "Give the live lesson a start time." };
  if (i.kind === "past_paper" && i.paperYear) {
    const y = Number(i.paperYear);
    if (!Number.isInteger(y) || y < 1990 || y > 2100) return { error: "Enter a year between 1990 and 2100." };
  }
  return { value: { ...i, title, body, url } };
}

export interface QuestionDraft {
  prompt: string;
  options: string[];
  correctIndex: number;
  marks: number;
}

export function blankQuestion(): QuestionDraft {
  return { prompt: "", options: ["", ""], correctIndex: 0, marks: 1 };
}

export interface QuizInput {
  id: string | null;
  streamId: string;
  subjectId: string;
  title: string;
  description: string;
  maxAttempts: number;
  showAnswers: boolean;
  status: QuizStatus;
  /** null on an existing quiz means "leave the questions as they are". */
  questions: QuestionDraft[] | null;
}

export function validateQuiz(i: QuizInput): { error: string } | { value: QuizInput } {
  const title = i.title.trim();
  if (!i.streamId) return { error: "Choose a class." };
  if (!i.subjectId) return { error: "Choose a subject." };
  if (title.length < 1 || title.length > 150) return { error: "Give the quiz a title (150 characters at most)." };
  if (i.description.length > 2000) return { error: "The description is too long (2000 characters at most)." };
  if (!Number.isInteger(i.maxAttempts) || i.maxAttempts < 1 || i.maxAttempts > 10) return { error: "Attempts must be a whole number from 1 to 10." };
  if (!QUIZ_STATUSES.includes(i.status)) return { error: "Choose a status." };
  if (i.questions === null) {
    if (!i.id) return { error: "Add at least one question." };
  } else {
    if (i.questions.length < 1) return { error: "Add at least one question." };
    if (i.questions.length > MAX_QUESTIONS) return { error: `A quiz can have at most ${MAX_QUESTIONS} questions.` };
    for (let n = 0; n < i.questions.length; n++) {
      const q = i.questions[n];
      const label = `Question ${n + 1}`;
      if (q.prompt.trim().length < 1 || q.prompt.length > 1000) return { error: `${label} needs a question (1000 characters at most).` };
      if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) return { error: `${label} needs between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.` };
      if (q.options.some((o) => o.trim().length < 1 || o.length > 200)) return { error: `${label} has an empty or too long option.` };
      if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) return { error: `${label}: mark which option is correct.` };
      if (!Number.isInteger(q.marks) || q.marks < 1 || q.marks > 10) return { error: `${label}: marks must be 1 to 10.` };
    }
  }
  return { value: { ...i, title } };
}

/** Shape the database function expects. */
export function questionsPayload(qs: QuestionDraft[]): { prompt: string; options: string[]; correct_index: number; marks: number }[] {
  return qs.map((q) => ({
    prompt: q.prompt.trim(),
    options: q.options.map((o) => o.trim()),
    correct_index: q.correctIndex,
    marks: q.marks,
  }));
}

export interface AttemptLite {
  quizId: string;
  studentId: string;
  score: number;
  total: number;
}

export function percent(score: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((score / total) * 100);
}

export interface QuizStats {
  attempts: number;
  learners: number;
  averagePercent: number | null;
}

export function quizStats(attempts: AttemptLite[]): QuizStats {
  if (attempts.length === 0) return { attempts: 0, learners: 0, averagePercent: null };
  const learners = new Set(attempts.map((a) => a.studentId)).size;
  const sum = attempts.reduce((n, a) => n + percent(a.score, a.total), 0);
  return { attempts: attempts.length, learners, averagePercent: Math.round(sum / attempts.length) };
}

/** Best attempt per quiz, for a learner's own list. */
export function bestAttempt(attempts: { score: number; total: number }[]): { score: number; total: number } | null {
  let best: { score: number; total: number } | null = null;
  for (const a of attempts) {
    if (!best || percent(a.score, a.total) > percent(best.score, best.total)) best = a;
  }
  return best;
}

/** A live lesson is "upcoming" until an hour after it starts. */
export function isUpcomingLesson(startsAtIso: string, now: Date = new Date()): boolean {
  const t = Date.parse(startsAtIso);
  return Number.isFinite(t) && t + 3_600_000 >= now.getTime();
}
