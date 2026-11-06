"use server";

import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";
import { isUuid } from "@/lib/bus-live";
import {
  QA_MESSAGES, QA_PROMPT_VERSION, buildQaPrompt, checkQuestionShape, detectLang, maskPersonalData, normalizeQuestion,
  parseQaResponse, qaResponseSchema, selectGuides, triage, type QaGuide, type QaLang, type QaStatus,
} from "@/lib/ai/tutor-qa";

const GEMINI_QA_MODEL = "gemini-3.5-flash-lite";

export type AskResult =
  | { ok: true; status: QaStatus; text: string; sources: string[] }
  | { ok: false; error: string };

function aiSwitchedOff(): boolean {
  const v = (process.env.PLATFORM_AI_DISABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

function fixed(status: Exclude<QaStatus, "answered">, lang: QaLang): string {
  return QA_MESSAGES[status][lang];
}

// A learner (or a parent for their child) asks one short question. Order matters: identity and switches first, then the
// safety filters (a child in trouble always gets the safe message and is flagged for a teacher), then the guides, and
// only then the model. The database re-checks everything when the exchange is saved.
export async function askTutorQuestionAction(input: { studentId: string; question: string; idempotencyKey: string }): Promise<AskResult> {
  if (!isUuid(input.studentId)) return { ok: false, error: "Choose a learner." };
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 80) return { ok: false, error: "Something went wrong. Reload the page and try again." };
  if (typeof input.question !== "string") return { ok: false, error: "Type a question." };
  const question = normalizeQuestion(input.question);
  const lang = detectLang(question);
  const shape = checkQuestionShape(question);
  if (shape === "empty") return { ok: false, error: "Type a question first." };
  if (shape === "too_long") return { ok: false, error: "Please keep your question short (300 letters at most)." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You are signed out. Sign in again." };

  // A retry of the same submission returns the saved answer instead of asking the model again.
  const { data: existing } = await supabase.from("tutor_qa_questions").select("status, answer, cited_draft_ids").eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing) {
    const st = existing.status as QaStatus;
    if (st === "answered") {
      const ids = (existing.cited_draft_ids as string[] | null) ?? [];
      const { data: titles } = ids.length ? await supabase.from("tutor_drafts").select("title").in("id", ids) : { data: [] as { title: string }[] };
      return { ok: true, status: st, text: String(existing.answer ?? ""), sources: (titles ?? []).map((t) => t.title as string) };
    }
    return { ok: true, status: st, text: fixed(st, lang), sources: [] };
  }

  // Identity, switches, the school's confirmations and the daily limit are all checked in the database.
  const { data: streamId, error: checkError } = await supabase.rpc("tutor_qa_check", { p_student: input.studentId });
  const verdict = triage(question);
  if (checkError) {
    // A safeguarding message is always shown, even at the daily limit; it is still recorded below (the database allows it).
    if (!(checkError.code === "54000" && verdict.action === "safeguarding")) {
      if (checkError.code === "54000") return { ok: true, status: "not_covered", text: QA_MESSAGES.limit[lang], sources: [] };
      if (checkError.code === "55000") return { ok: false, error: "Questions are not switched on for your school." };
      return { ok: false, error: "You can't ask a question for this learner." };
    }
  }

  const save = async (status: QaStatus, text: string | null, cited: string[], tokens?: { prompt: number; output: number }): Promise<boolean> => {
    const stored = status === "answered" ? question : verdict.action === "continue" ? question : maskPersonalData(question);
    const { error } = await supabase.rpc("save_tutor_qa", {
      p_student: input.studentId, p_key: input.idempotencyKey, p_question: stored, p_status: status, p_answer: status === "answered" ? text : null,
      p_cited: cited, p_model: status === "answered" ? GEMINI_QA_MODEL : null, p_prompt_version: QA_PROMPT_VERSION,
      p_prompt_tokens: tokens?.prompt ?? null, p_output_tokens: tokens?.output ?? null,
    });
    return !error;
  };

  // 1. Safeguarding and personal details: never sent to the model, never answered by it.
  if (verdict.action === "safeguarding") {
    await save("safeguarding", null, []);
    return { ok: true, status: "safeguarding", text: QA_MESSAGES.safeguarding[lang], sources: [] };
  }
  if (verdict.action === "blocked_personal") {
    await save("blocked_personal", null, []);
    return { ok: true, status: "blocked_personal", text: QA_MESSAGES.blocked_personal[lang], sources: [] };
  }

  // 2. The learner's own class's approved guides (row-level security returns only those), then the relevant ones.
  if (typeof streamId !== "string") return { ok: false, error: "You can't ask a question for this learner." };
  const [{ data: guideRows }, { data: subjects }] = await Promise.all([
    supabase.from("tutor_drafts").select("id, subject_id, title, body").eq("stream_id", streamId).eq("status", "approved").order("created_at", { ascending: false }).limit(100),
    supabase.from("subjects").select("id, name"),
  ]);
  const subjectName = new Map((subjects ?? []).map((s) => [s.id as string, s.name as string]));
  const all: QaGuide[] = (guideRows ?? []).map((g) => ({ id: g.id as string, subject: subjectName.get(g.subject_id as string) ?? "Subject", title: g.title as string, body: g.body as string }));
  const chosen = selectGuides(question, all);
  if (chosen.length === 0) {
    await save("not_covered", null, []);
    return { ok: true, status: "not_covered", text: QA_MESSAGES.not_covered[lang], sources: [] };
  }

  // 3. The model. Failures are not saved and do not use up the learner's daily questions.
  if (aiSwitchedOff()) return { ok: false, error: QA_MESSAGES.unavailable[lang] };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: QA_MESSAGES.unavailable[lang] };
  let body: { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  try {
    const res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_QA_MODEL), {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildQaPrompt({ question, guides: chosen }) }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.2, responseMimeType: "application/json", responseSchema: qaResponseSchema },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { ok: false, error: QA_MESSAGES.unavailable[lang] };
    body = await res.json();
  } catch {
    return { ok: false, error: QA_MESSAGES.unavailable[lang] };
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "null");
  } catch {
    raw = null;
  }
  const parsed = parseQaResponse(raw, chosen.map((g) => g.id));
  if (parsed.status !== "answered") {
    await save("not_covered", null, []);
    return { ok: true, status: "not_covered", text: QA_MESSAGES.not_covered[lang], sources: [] };
  }
  const saved = await save("answered", parsed.answer, parsed.usedIds, { prompt: body.usageMetadata?.promptTokenCount ?? 0, output: body.usageMetadata?.candidatesTokenCount ?? 0 });
  // If the database refused to record it (a guide changed meanwhile), nothing is shown: fail closed.
  if (!saved) return { ok: true, status: "not_covered", text: QA_MESSAGES.not_covered[lang], sources: [] };
  const titles = chosen.filter((g) => parsed.usedIds.includes(g.id)).map((g) => g.title);
  return { ok: true, status: "answered", text: parsed.answer, sources: titles };
}
