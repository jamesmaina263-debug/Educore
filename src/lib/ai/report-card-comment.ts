// Pure helpers for AI-drafted report card comments. Split out of
// exams/report-cards/actions.ts so the prompt/parsing logic can be unit
// tested without a live Supabase connection or network call. No behavior
// change from what draftCommentWithAI did inline.

export interface ReportCardMarkLine {
  raw_score: number | null;
  subject_name: string;
  band_label: string | null;
}

/**
 * Formats a student's marks for this exam into the "Subject: score (band)"
 * lines used in the AI prompt. A mark with no numeric score (e.g. absent,
 * exempted) falls back to "Subject: band" with no score.
 */
export function formatMarkLines(marks: ReportCardMarkLine[]): string {
  return marks
    .map((m) => {
      const subject = m.subject_name || "Subject";
      return m.raw_score !== null ? `${subject}: ${m.raw_score} (${m.band_label})` : `${subject}: ${m.band_label}`;
    })
    .join("\n");
}

/**
 * Builds the prompt sent to Gemini to draft a report card comment. Kept
 * deliberately conservative: no numeric scores in the output, 2-3 sentences,
 * must reference at least one specific subject/result so it can't be pure
 * filler.
 */
export function buildReportCardCommentPrompt(studentName: string, marks: ReportCardMarkLine[]): string {
  const lines = formatMarkLines(marks);
  return `You are helping a Kenyan primary/secondary school teacher draft a short report card comment.
Student: ${studentName}
Results this exam:
${lines || "No subject results recorded."}

Write a warm, specific, 2-3 sentence comment on this student's academic performance for the term. Mention at least one specific subject or result. Avoid generic filler. Do not mention numeric scores directly in the prose (refer to strengths/areas to improve instead). Output only the comment text, no preamble.`;
}

export const GEMINI_REPORT_CARD_MODEL = "gemini-3.5-flash-lite";

export function geminiGenerateContentUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_REPORT_CARD_MODEL}:generateContent?key=${apiKey}`;
}

export type GeminiParseResult = { comment: string } | { error: string };

/**
 * Extracts and trims the drafted comment text from a Gemini generateContent
 * response body, or returns an error describing what was missing. Does not
 * throw — a malformed/empty response is a normal failure mode to surface to
 * the teacher, not a bug.
 */
export function parseGeminiCommentResponse(data: unknown): GeminiParseResult {
  const draft = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]
    ?.content?.parts?.[0]?.text;
  if (!draft || !draft.trim()) {
    return { error: "AI drafting returned no text." };
  }
  return { comment: draft.trim() };
}
