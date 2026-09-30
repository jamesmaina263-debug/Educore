export const MIN_COMPETENCY_SCORE = 1;
export const MAX_COMPETENCY_SCORE = 5;

/**
 * Validates a teacher performance review before it is saved.
 *
 * The form's number inputs carry min/max, but they aren't inside a <form>, so the browser never
 * enforces them -- a 9 or a -3 could be typed and saved. The database doesn't check either (its
 * overall-rating trigger even silently drops negative values from the average), so an out-of-range
 * score produced a nonsense "Overall: 9/5" on the review. Scores must be finite numbers within
 * 1-5, and a review must carry at least one score or a note.
 */
export function validateReviewInput(input: {
  academic_year_id: string;
  term_id: string | null;
  review_type: "termly" | "annual";
  teacher_id: string;
  competency_scores: Record<string, unknown>;
  notes: string;
}): { error: string } | { competency_scores: Record<string, number>; notes: string } {
  if (!input.teacher_id) return { error: "Select a staff member." };
  if (!input.academic_year_id) return { error: "There is no active academic year to attach this review to." };
  if (input.review_type === "termly" && !input.term_id) return { error: "Select a term for a termly review." };

  const scores: Record<string, number> = {};
  for (const [competency, raw] of Object.entries(input.competency_scores ?? {})) {
    const value = typeof raw === "number" ? raw : Number.NaN;
    if (!Number.isFinite(value) || value < MIN_COMPETENCY_SCORE || value > MAX_COMPETENCY_SCORE) {
      return { error: `"${competency}" must be a score between ${MIN_COMPETENCY_SCORE} and ${MAX_COMPETENCY_SCORE}.` };
    }
    scores[competency] = value;
  }

  const notes = (input.notes ?? "").trim();
  if (Object.keys(scores).length === 0 && !notes) {
    return { error: "Enter at least one competency score or a note." };
  }

  return { competency_scores: scores, notes };
}
