"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";
import { LEARNING_FLAG } from "@/lib/learning-portal";
import { isUuid } from "@/lib/bus-live";
import { MAX_NOTES, TUTOR_FLAG, TUTOR_PROMPT_VERSION, buildTutorPrompt, checkNotes, parseTutorResponse, tutorResponseSchema } from "@/lib/ai/tutor";

const GEMINI_TUTOR_MODEL = "gemini-3.5-flash-lite";

type Result<T = object> = ({ error: string }) | ({ success: true } & T);

function aiSwitchedOff(): boolean {
  const v = (process.env.PLATFORM_AI_DISABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

// Teacher asks for a study guide for one class + subject from chosen PUBLISHED NOTES. Everything that can be checked
// before spending money is checked first; the result is saved only as a DRAFT (the database re-validates the sources).
export async function generateTutorDraftAction(input: { streamId: string; subjectId: string; noteIds: string[]; idempotencyKey: string }): Promise<Result<{ draftId: string }>> {
  if (!isUuid(input.streamId) || !isUuid(input.subjectId)) return { error: "Choose a class and a subject." };
  if (!Array.isArray(input.noteIds) || input.noteIds.length === 0 || input.noteIds.length > MAX_NOTES || !input.noteIds.every(isUuid)) return { error: "Choose between 1 and 20 notes." };
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 80) return { error: "Something went wrong. Reload the page and try again." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Sign in again." };

  if (!(await hasFeatureFlag(supabase, LEARNING_FLAG)) || !(await hasFeatureFlag(supabase, TUTOR_FLAG))) return { error: "The AI tutor is not switched on for this school." };
  if (aiSwitchedOff()) return { error: "AI is switched off at the moment." };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "AI isn't configured on this server yet. Nothing was saved." };

  // 1. Idempotency claim (also proves the caller is staff with both flags on: the function re-checks everything).
  const { data: requestId, error: claimError } = await supabase.rpc("claim_tutor_request", { p_key: input.idempotencyKey, p_prompt_version: TUTOR_PROMPT_VERSION });
  if (claimError) {
    if (claimError.code === "23505") return { error: "This request was already submitted. Wait for it to finish, or start a new one." };
    if (claimError.code === "42501" || claimError.code === "55000") return { error: "You can't use the AI tutor here." };
    return { error: "Something went wrong while preparing the study guide. Nothing was saved." };
  }
  const startedAt = Date.now();
  const finish = async (status: "succeeded" | "failed", failure: string | null, tokens?: { prompt: number; output: number }, draftId?: string) => {
    await supabase.rpc("finish_tutor_request", {
      p_id: requestId as string, p_status: status, p_failure: failure, p_ms: Date.now() - startedAt,
      p_prompt_tokens: tokens?.prompt ?? null, p_output_tokens: tokens?.output ?? null, p_draft_id: draftId ?? null,
    });
  };

  // 2. Rate limit per teacher.
  try {
    const { data: within } = await createAdminClient().rpc("increment_and_check_rate_limit", { p_bucket: `ai-tutor:${user.id}`, p_max_events: 15, p_window_seconds: 3600 });
    if (within === false) { await finish("failed", "rate_limit"); return { error: "You have made several study guides in the last hour. Please wait a little and try again." }; }
  } catch {
    // admin client not configured here: don't block a permission-checked, idempotency-claimed request
  }

  // 3. Load the chosen notes through row-level security, then require every one to be a published note of THIS class + subject.
  const [{ data: stream }, { data: subject }, { data: noteRows }] = await Promise.all([
    supabase.from("streams").select("name, classes(name)").eq("id", input.streamId).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", input.subjectId).maybeSingle(),
    supabase.from("learning_resources").select("id, title, body, kind, published, stream_id, subject_id").in("id", input.noteIds),
  ]);
  const usable = (noteRows ?? []).filter((n) => n.kind === "note" && n.published === true && n.stream_id === input.streamId && n.subject_id === input.subjectId);
  if (!stream || !subject || usable.length !== new Set(input.noteIds).size) {
    await finish("failed", "source_unavailable");
    return { error: "One of the chosen notes isn't available for this class and subject any more. Reload and choose again." };
  }
  const notes = usable.map((n) => ({ id: n.id as string, title: n.title as string, body: (n.body as string | null) ?? "" }));
  const notesProblem = checkNotes(notes);
  if (notesProblem) { await finish("failed", "notes_not_usable"); return { error: notesProblem }; }

  // 4. Generate.
  const className = (stream.classes as unknown as { name: string } | null)?.name ?? "";
  const prompt = buildTutorPrompt({ subjectName: subject.name as string, className: `${className} ${stream.name as string}`.trim(), notes });
  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_TUTOR_MODEL), {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000, temperature: 0.3, responseMimeType: "application/json", responseSchema: tutorResponseSchema },
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await finish("failed", timeout ? "timeout" : "network");
    return { error: timeout ? "Generation timed out. Nothing was saved." : "Connection interrupted. Nothing was saved. Please try again." };
  }
  if (!res.ok) {
    console.error(`generateTutorDraft: Gemini returned ${res.status}`);
    await finish("failed", res.status === 429 ? "rate_limit" : "ai_unavailable");
    return { error: res.status === 429 ? "AI is busy right now. Please wait a moment and try again." : "AI is unavailable right now. Nothing was saved." };
  }

  let json: unknown;
  let tokens: { prompt: number; output: number } | undefined;
  try {
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    tokens = body.usageMetadata ? { prompt: body.usageMetadata.promptTokenCount ?? 0, output: body.usageMetadata.candidatesTokenCount ?? 0 } : undefined;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { await finish("failed", "empty_response", tokens); return { error: "The AI returned an empty response. Nothing was saved. Please try again." }; }
    json = JSON.parse(text);
  } catch {
    await finish("failed", "malformed_response", tokens);
    return { error: "The AI response could not be read. Nothing was saved. Please try again." };
  }
  const parsed = parseTutorResponse(json, notes.map((n) => n.id));
  if ("error" in parsed) { await finish("failed", "validation_failed", tokens); return { error: `${parsed.error} Nothing was saved. Please try again.` }; }

  // 5. Save as a DRAFT. The database copies and re-checks the sources.
  const { data: draftId, error: saveError } = await supabase.rpc("save_tutor_draft", {
    p_stream_id: input.streamId, p_subject_id: input.subjectId, p_title: parsed.title, p_body: parsed.body,
    p_source_ids: parsed.usedIds, p_model: GEMINI_TUTOR_MODEL, p_prompt_version: TUTOR_PROMPT_VERSION,
  });
  if (saveError || !draftId) { await finish("failed", "save_failed", tokens); return { error: "The study guide could not be saved. Please try again." }; }
  await finish("succeeded", null, tokens, draftId as string);
  revalidatePath("/academics/learning/tutor");
  return { success: true, draftId: draftId as string };
}

export async function updateTutorDraftAction(id: string, title: string, body: string): Promise<Result> {
  if (!isUuid(id)) return { error: "Draft not found." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("update_tutor_draft", { p_id: id, p_title: title, p_body: body });
  if (error) return { error: error.message };
  revalidatePath("/academics/learning/tutor");
  return { success: true };
}

export async function reviewTutorDraftAction(id: string, action: "approve" | "reject" | "withdraw"): Promise<Result> {
  if (!isUuid(id) || !["approve", "reject", "withdraw"].includes(action)) return { error: "Draft not found." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("review_tutor_draft", { p_id: id, p_action: action });
  if (error) return { error: error.message };
  revalidatePath("/academics/learning/tutor");
  revalidatePath("/portal/learning");
  return { success: true };
}
