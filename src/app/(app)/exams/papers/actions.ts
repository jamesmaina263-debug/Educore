"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";
import { loadExamSourceOptions } from "@/lib/ai/exam-paper-sources";
import {
  EXAM_PAPER_PROMPT_VERSION,
  EXAM_SOURCE_LABELS,
  GEMINI_EXAM_PAPER_MODEL,
  buildExamPaperPrompt,
  buildSourceAttribution,
  checkSubStrandUsable,
  examPaperResponseSchema,
  isExamSourceKind,
  parseExamPaperResponse,
  partitionSelectedSubStrands,
  unusableReasonText,
  validateExamPaperSpec,
  type ExamPaperSpec,
  type ExamQuestionType,
  type ExamSourceKind,
} from "@/lib/ai/exam-paper";

// ---------------------------------------------------------------------------
// Exam paper generator.
//
// Reads curriculum content only (loadExamSourceOptions is read-only); the sole
// tables written here are exam_papers / exam_paper_questions /
// exam_paper_ai_requests. Nothing in this file writes to curriculum_strands,
// curriculum_sub_strands, curriculum_extraction_batches or any kicd_* table,
// and it never merges curriculum sources: one paper = one chosen source.
// ---------------------------------------------------------------------------

type ActionError = { error: string };

export interface SourceOptionSummary {
  kind: ExamSourceKind;
  sourceId: string | null;
  label: string;
  name: string;
  licenceReference: string | null;
  attribution: string | null;
  subStrands: { ref: string; strand: string; name: string; usable: boolean; unusableReason: string | null }[];
}

export type SourceOptionsResult = ActionError | { options: SourceOptionSummary[]; notes: string[] };

function isId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function getCaller() {
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, schoolUser: null } as const;
  const { data: schoolUser } = await supabase.from("school_users").select("id, school_id").eq("auth_user_id", user.id).maybeSingle();
  return { supabase, user, schoolUser: schoolUser as { id: string; school_id: string } | null } as const;
}

export async function getExamPaperSourceOptions(classId: string, subjectId: string): Promise<SourceOptionsResult> {
  if (!isId(classId) || !isId(subjectId)) return { error: "Select a class and subject first." };
  const { supabase, user, schoolUser } = await getCaller();
  if (!user || !schoolUser) return { error: "You must be signed in." };
  const { data: canGenerate } = await supabase.rpc("auth_has_permission", { p_permission_key: "exams.generate_paper_ai" });
  if (!canGenerate) return { error: "You don't have permission to generate exam papers." };

  const loaded = await loadExamSourceOptions(supabase, { classId, subjectId, schoolId: schoolUser.school_id });
  if (!loaded) return { error: "Class or subject not found." };
  return {
    notes: loaded.notes,
    options: loaded.options.map((o) => ({
      kind: o.kind,
      sourceId: o.sourceId,
      label: EXAM_SOURCE_LABELS[o.kind],
      name: o.name,
      licenceReference: o.licenceReference,
      attribution: o.attribution,
      subStrands: o.subStrands.map((s) => {
        const check = checkSubStrandUsable(s);
        return { ref: s.ref, strand: s.strand, name: s.name, usable: check.usable, unusableReason: check.usable ? null : unusableReasonText(check.reason) };
      }),
    })),
  };
}

export interface GenerateExamPaperInput {
  class_id: string;
  subject_id: string;
  source_kind: ExamSourceKind;
  source_id: string | null;
  sub_strand_refs: string[];
  title: string;
  total_marks: number;
  question_count: number;
  question_types: ExamQuestionType[];
  teacher_notes: string | null;
  exam_id: string | null;
  /** Generated once per Generate click and reused across its retries. */
  idempotency_key: string;
}

export type GenerateExamPaperResult = ActionError | { success: true; paperId: string; warnings: string[] };

export async function generateExamPaper(input: GenerateExamPaperInput): Promise<GenerateExamPaperResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." };

  // ---- 1. Validate before touching the network or DB. ----
  if (!isId(input.class_id) || !isId(input.subject_id) || !isId(input.idempotency_key)) {
    return { error: "Select a class and subject before generating." };
  }
  if (!isExamSourceKind(input.source_kind)) return { error: "Choose which curriculum source to use." };
  if (!Array.isArray(input.sub_strand_refs) || input.sub_strand_refs.length === 0 || !input.sub_strand_refs.every(isId)) {
    return { error: "Select at least one sub-strand to examine." };
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 200) return { error: "Enter a paper title (up to 200 characters)." };
  const spec: ExamPaperSpec = {
    totalMarks: input.total_marks,
    questionCount: input.question_count,
    questionTypes: input.question_types,
    teacherNotes: input.teacher_notes?.trim() ? input.teacher_notes.trim() : null,
  };
  const specError = validateExamPaperSpec(spec);
  if (specError) return { error: specError };

  const { supabase, user, schoolUser } = await getCaller();
  if (!user || !schoolUser) return { error: "You must be signed in." };

  // ---- 2. Permission. ----
  const { data: canGenerate } = await supabase.rpc("auth_has_permission", { p_permission_key: "exams.generate_paper_ai" });
  if (!canGenerate) return { error: "You don't have permission to generate exam papers." };

  // ---- 3. Entities (RLS-scoped) and the optional exam link. ----
  const [{ data: classRow }, { data: subjectRow }, examResult] = await Promise.all([
    supabase.from("classes").select("name").eq("id", input.class_id).eq("school_id", schoolUser.school_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", input.subject_id).eq("school_id", schoolUser.school_id).maybeSingle(),
    input.exam_id
      ? supabase.from("exams").select("id").eq("id", input.exam_id).eq("school_id", schoolUser.school_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!classRow || !subjectRow) return { error: "Class or subject not found." };
  if (input.exam_id && !examResult.data) return { error: "The selected exam was not found." };

  // ---- 4. Idempotency claim, before anything cost-incurring. ----
  const { error: claimError } = await supabase.from("exam_paper_ai_requests").insert({
    school_id: schoolUser.school_id,
    requested_by: schoolUser.id,
    idempotency_key: input.idempotency_key,
    prompt_version: EXAM_PAPER_PROMPT_VERSION,
  });
  if (claimError) {
    if (claimError.code === "23505") return { error: "This request was already submitted. Please wait for it to finish, or start a new one." };
    return { error: "Something went wrong while preparing the paper. Nothing was saved. Please try again." };
  }
  const { data: requestRow } = await supabase
    .from("exam_paper_ai_requests")
    .select("id")
    .eq("requested_by", schoolUser.id)
    .eq("idempotency_key", input.idempotency_key)
    .single();
  const requestId: string | undefined = requestRow?.id;
  const startedAt = Date.now();
  const finish = async (status: "succeeded" | "failed", failureCategory: string | null, paperId?: string) => {
    if (!requestId) return;
    await supabase
      .from("exam_paper_ai_requests")
      .update({ status, failure_category: failureCategory, paper_id: paperId ?? null, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() })
      .eq("id", requestId);
  };

  // ---- 5. Rate limit. ----
  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `ai-exam-paper:${user.id}`,
      p_max_events: 20,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      await finish("failed", "rate_limit");
      return { error: "AI generation is temporarily busy. Please wait a moment and try again." };
    }
  } catch {
    // Admin client not configured here: don't block a permission-checked, idempotency-claimed request.
  }

  // ---- 6. Resolve the ONE chosen curriculum source (never merged). ----
  const loaded = await loadExamSourceOptions(supabase, { classId: input.class_id, subjectId: input.subject_id, schoolId: schoolUser.school_id });
  const source = loaded?.options.find((o) => o.kind === input.source_kind && (o.sourceId ?? null) === (input.source_id ?? null));
  if (!source) {
    await finish("failed", "source_unavailable");
    return { error: "The selected curriculum source isn't available for this class and subject any more. Reload and choose again." };
  }

  // ---- 7. Only reviewed content with stated learning outcomes may ground questions.
  //         Anything else is flagged for the teacher -- never filled in. ----
  const selection = partitionSelectedSubStrands(source, input.sub_strand_refs);
  if (selection.missing.length > 0) {
    await finish("failed", "sub_strand_not_in_source");
    return { error: "Some selected sub-strands don't belong to the chosen curriculum source. Reload and select again." };
  }
  if (selection.unusable.length > 0) {
    await finish("failed", "insufficient_curriculum");
    const lines = selection.unusable.map((u) => `${u.candidate.strand} › ${u.candidate.name} ${unusableReasonText(u.reason)}`);
    return { error: `Cannot generate yet. Teacher input needed: ${lines.join("; ")}.` };
  }

  // ---- 8. Generate. ----
  const prompt = buildExamPaperPrompt({
    subjectName: subjectRow.name,
    className: classRow.name,
    sourceLabel: `${EXAM_SOURCE_LABELS[source.kind]} — ${source.name}`,
    subStrands: selection.usable,
    spec,
  });
  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_EXAM_PAPER_MODEL), {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8000, temperature: 0.4, responseMimeType: "application/json", responseSchema: examPaperResponseSchema },
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await finish("failed", isTimeout ? "timeout" : "network");
    return { error: isTimeout ? "Generation timed out. Nothing was saved." : "Connection interrupted. Nothing was saved. Please try again." };
  }
  if (!res.ok) {
    console.error(`generateExamPaper: Gemini returned ${res.status}`);
    await finish("failed", res.status === 429 ? "rate_limit" : "ai_unavailable");
    return { error: res.status === 429 ? "AI generation is temporarily busy. Please wait a moment and try again." : "AI generation is currently unavailable. Nothing was saved." };
  }

  let parsedJson: unknown;
  try {
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      await finish("failed", "empty_response");
      return { error: "The AI returned an empty response. Nothing was saved. Please try again." };
    }
    parsedJson = JSON.parse(text);
  } catch {
    await finish("failed", "malformed_response");
    return { error: "The AI response could not be read. Nothing was saved. Please try again." };
  }
  const parsed = parseExamPaperResponse(
    parsedJson,
    selection.usable.map((s) => s.ref),
    spec,
  );
  if ("error" in parsed) {
    await finish("failed", "validation_failed");
    return { error: `${parsed.error} Nothing was saved. Please try again.` };
  }

  // ---- 9. Persist as a DRAFT with source attribution; roll back the paper if questions fail. ----
  const attribution = buildSourceAttribution(source, selection.usable);
  const labelByRef = new Map(selection.usable.map((s) => [s.ref, `${s.strand} › ${s.name}`]));
  const totalMarks = Math.round(parsed.questions.reduce((n, q) => n + q.marks, 0) * 100) / 100;
  const { data: paper, error: paperError } = await supabase
    .from("exam_papers")
    .insert({
      school_id: schoolUser.school_id,
      subject_id: input.subject_id,
      class_id: input.class_id,
      exam_id: input.exam_id || null,
      title,
      status: "draft",
      total_marks: totalMarks,
      source_kind: attribution.kind,
      source_id: attribution.sourceId,
      source_name: attribution.name,
      source_licence_reference: attribution.licenceReference,
      source_attribution: attribution.attribution,
      source_snapshot: attribution.snapshot,
      prompt_version: EXAM_PAPER_PROMPT_VERSION,
      created_by: schoolUser.id,
    })
    .select("id")
    .single();
  if (paperError || !paper) {
    await finish("failed", "save_failed");
    return { error: "The paper was generated but could not be saved. Please try again." };
  }
  const { error: questionsError } = await supabase.from("exam_paper_questions").insert(
    parsed.questions.map((q, i) => ({
      paper_id: paper.id,
      position: i + 1,
      question_type: q.question_type,
      question_text: q.question_text,
      marks: q.marks,
      marking_scheme: q.marking_scheme,
      sub_strand_ref: q.sub_strand_ref,
      sub_strand_label: labelByRef.get(q.sub_strand_ref) ?? "",
    })),
  );
  if (questionsError) {
    await supabase.from("exam_papers").delete().eq("id", paper.id);
    await finish("failed", "save_failed");
    return { error: "The paper was generated but could not be saved. Please try again." };
  }

  await finish("succeeded", null, paper.id);
  revalidatePath("/exams", "layout");
  return { success: true, paperId: paper.id, warnings: parsed.warnings };
}

// ---------------------------------------------------------------------------
// Review / edit. Row-level security decides who may change a paper (exams.write,
// or the creator with exams.generate_paper_ai); these actions add input checks
// and the rule that an approved paper must be reopened to draft before edits.
// ---------------------------------------------------------------------------

async function recomputeTotal(supabase: Awaited<ReturnType<typeof createClient>>, paperId: string) {
  const { data } = await supabase.from("exam_paper_questions").select("marks").eq("paper_id", paperId);
  const total = Math.round(((data ?? []) as { marks: number }[]).reduce((n, q) => n + Number(q.marks), 0) * 100) / 100;
  await supabase.from("exam_papers").update({ total_marks: total }).eq("id", paperId);
}

async function loadEditableQuestion(supabase: Awaited<ReturnType<typeof createClient>>, questionId: string): Promise<{ error: string } | { paperId: string }> {
  const { data } = await supabase.from("exam_paper_questions").select("id, paper_id, exam_papers(status)").eq("id", questionId).maybeSingle();
  if (!data) return { error: "Question not found." };
  const paper = (Array.isArray(data.exam_papers) ? data.exam_papers[0] : data.exam_papers) as { status: string } | null;
  if (!paper) return { error: "Question not found." };
  if (paper.status === "approved") return { error: "This paper is approved. Reopen it to draft before editing." };
  return { paperId: data.paper_id as string };
}

export async function updateExamPaperQuestion(
  questionId: string,
  patch: { question_text: string; marks: number; marking_scheme: string },
): Promise<{ success: true } | ActionError> {
  if (!isId(questionId)) return { error: "Missing question." };
  const text = patch.question_text?.trim();
  const scheme = patch.marking_scheme?.trim();
  if (!text || text.length > 4000) return { error: "Enter the question text (up to 4000 characters)." };
  if (!scheme || scheme.length > 4000) return { error: "Enter the marking scheme (up to 4000 characters)." };
  if (typeof patch.marks !== "number" || !Number.isFinite(patch.marks) || patch.marks <= 0 || patch.marks > 200) return { error: "Marks must be between 0 and 200." };

  const { supabase, user } = await getCaller();
  if (!user) return { error: "You must be signed in." };
  const found = await loadEditableQuestion(supabase, questionId);
  if ("error" in found) return { error: found.error };
  const { error } = await supabase
    .from("exam_paper_questions")
    .update({ question_text: text, marking_scheme: scheme, marks: Math.round(patch.marks * 100) / 100 })
    .eq("id", questionId);
  if (error) return { error: "Could not save this question." };
  await recomputeTotal(supabase, found.paperId);
  revalidatePath("/exams", "layout");
  return { success: true };
}

export async function deleteExamPaperQuestion(questionId: string): Promise<{ success: true } | ActionError> {
  if (!isId(questionId)) return { error: "Missing question." };
  const { supabase, user } = await getCaller();
  if (!user) return { error: "You must be signed in." };
  const found = await loadEditableQuestion(supabase, questionId);
  if ("error" in found) return { error: found.error };
  const { error } = await supabase.from("exam_paper_questions").delete().eq("id", questionId);
  if (error) return { error: "Could not remove this question." };
  await recomputeTotal(supabase, found.paperId);
  revalidatePath("/exams", "layout");
  return { success: true };
}

export async function setExamPaperStatus(paperId: string, status: "draft" | "approved"): Promise<{ success: true } | ActionError> {
  if (!isId(paperId)) return { error: "Missing paper." };
  if (status !== "draft" && status !== "approved") return { error: "Invalid status." };
  const { supabase, user } = await getCaller();
  if (!user) return { error: "You must be signed in." };
  if (status === "approved") {
    const { count } = await supabase.from("exam_paper_questions").select("id", { count: "exact", head: true }).eq("paper_id", paperId);
    if (!count) return { error: "A paper needs at least one question before it can be approved." };
  }
  const { error } = await supabase.from("exam_papers").update({ status }).eq("id", paperId);
  if (error) return { error: "Could not update this paper." };
  revalidatePath("/exams", "layout");
  return { success: true };
}

export async function deleteExamPaper(paperId: string): Promise<{ success: true } | ActionError> {
  if (!isId(paperId)) return { error: "Missing paper." };
  const { supabase, user } = await getCaller();
  if (!user) return { error: "You must be signed in." };
  const { error } = await supabase.from("exam_papers").delete().eq("id", paperId);
  if (error) return { error: "Could not delete this paper." };
  revalidatePath("/exams", "layout");
  return { success: true };
}
