// Pure helpers for learners and parents taking a learning-portal quiz (WP 8.1 part 3).
// Marking happens in the database (submit_learning_quiz); nothing here ever sees an answer key.

export interface TakeAttempt {
  attemptNo: number;
  score: number;
  total: number;
}

/** Turns the selections into the payload the database wants: one entry per question, an option index or null. */
export function buildAnswers(selected: (number | null | undefined)[], optionCounts: number[]): (number | null)[] {
  return optionCounts.map((count, i) => {
    const s = selected[i];
    return typeof s === "number" && Number.isInteger(s) && s >= 0 && s < count ? s : null;
  });
}

export function unansweredCount(answers: (number | null)[]): number {
  return answers.filter((a) => a === null).length;
}

export function attemptsLeft(maxAttempts: number, attempts: TakeAttempt[]): number {
  return Math.max(0, maxAttempts - attempts.length);
}

export function bestOf(attempts: TakeAttempt[]): TakeAttempt | null {
  let best: TakeAttempt | null = null;
  for (const a of attempts) {
    if (a.total <= 0) continue;
    if (best === null || a.score / a.total > best.score / best.total) best = a;
  }
  return best;
}

export function formatScore(score: number, total: number): string {
  if (total <= 0) return "—";
  return `${score}/${total} (${Math.round((score / total) * 100)}%)`;
}

export interface SubmitResult {
  attemptNo: number;
  score: number;
  total: number;
  attemptsLeft: number;
  review: { position: number; correctIndex: number; yourAnswer: number | null }[] | null;
}

/** Defensive parse of the jsonb the database returns. */
export function parseSubmitResult(data: unknown): SubmitResult | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const attemptNo = num(d.attempt_no);
  const score = num(d.score);
  const total = num(d.total);
  const left = num(d.attempts_left);
  if (attemptNo === null || score === null || total === null || left === null) return null;
  let review: SubmitResult["review"] = null;
  if (Array.isArray(d.review)) {
    review = [];
    for (const r of d.review) {
      if (typeof r !== "object" || r === null) continue;
      const rr = r as Record<string, unknown>;
      const position = num(rr.position);
      const correctIndex = num(rr.correct_index);
      if (position === null || correctIndex === null) continue;
      review.push({ position, correctIndex, yourAnswer: num(rr.your_answer) });
    }
  }
  return { attemptNo, score, total, attemptsLeft: left, review };
}
