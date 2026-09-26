"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import {
  SCHEME_OF_WORK_PROMPT_VERSION,
  SCHEME_OF_WORK_ENTRY_ASSIST_PROMPT_VERSION,
  GEMINI_SCHEME_MODEL,
  buildSchemeOfWorkPrompt,
  buildCurriculumContext,
  buildEntryAssistPrompt,
  schemeOfWorkResponseSchema,
  entryAssistResponseSchema,
  parseSchemeOfWorkResponse,
  parseEntryAssistResponse,
  checkSchemeOfWorkQuality,
  weeksGenerated as countWeeksGenerated,
  type SchemeOfWorkDraft,
  type SchemeOfWorkDraftWeek,
  type CurriculumSubStrandRow,
  type EntryAssistMode,
  type EntryAssistDraft,
} from "@/lib/ai/scheme-of-work";
import { geminiGenerateContentUrl } from "@/lib/ai/report-card-comment";
import { validateEntryInput, type SchemeEntryInput } from "./_validation";

// ---------------------------------------------------------------------------
// generateSchemeWithAI
//
// Deliberately never writes to schemes_of_work / scheme_of_work_entries.
// It returns a validated draft for the teacher to review; only
// saveGeneratedScheme (below), called on an explicit "Save" click, persists
// anything. This is what makes "never silently overwrite an existing
// scheme" and "never save a failed/malformed response" true by
// construction rather than by a check that could be missed.
// ---------------------------------------------------------------------------

export interface GenerateSchemeInput {
  academic_year_id: string;
  term_id: string;
  class_id: string;
  stream_id: string | null;
  subject_id: string;
  total_weeks: number;
  lessons_per_week: number;
  curriculum_framework: string | null;
  /** Client-generated once per "Generate"/"Regenerate" click; reused across
   *  that click's own retries so a double-click or network retry can't
   *  create two concurrent generations (enforced by the unique index on
   *  scheme_of_work_ai_requests(requested_by, idempotency_key)). */
  idempotency_key: string;
}

export type GenerateSchemeResult =
  | { error: string }
  | {
      success: true;
      requestId: string;
      draft: SchemeOfWorkDraft;
      warnings: string[];
      partial: boolean;
      weeksRequested: number;
      weeksGenerated: number;
      /** How many of this school's own recorded curriculum sub-strands for
       *  this subject were fed into the prompt as grounding -- 0 when the
       *  school has none recorded, in which case generation behaved exactly
       *  as it did before curriculum-awareness existed. Surfaced so
       *  "curriculum-aware" is a visible fact, not an invisible claim. */
      curriculumItemsUsed: number;
    };

function isNonEmptyUuidLike(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function generateSchemeWithAI(input: GenerateSchemeInput): Promise<GenerateSchemeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  // ---- 1. Validate the request before anything else touches the network or DB. ----
  if (
    !isNonEmptyUuidLike(input.academic_year_id) ||
    !isNonEmptyUuidLike(input.term_id) ||
    !isNonEmptyUuidLike(input.class_id) ||
    !isNonEmptyUuidLike(input.subject_id) ||
    !isNonEmptyUuidLike(input.idempotency_key)
  ) {
    return { error: "Please select the academic year, term, class and subject before generating the scheme." };
  }
  if (!Number.isInteger(input.total_weeks) || input.total_weeks <= 0 || input.total_weeks > 52) {
    return { error: "Please enter a valid number of teaching weeks (1–52)." };
  }
  if (!Number.isInteger(input.lessons_per_week) || input.lessons_per_week <= 0 || input.lessons_per_week > 20) {
    return { error: "Please enter a valid number of lessons per week (1–20)." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  // ---- 2. Permission. ----
  const { data: canGenerate } = await supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.generate_ai" });
  if (!canGenerate) {
    return { error: "You don't have permission to generate a scheme with AI." };
  }

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) {
    return { error: "You must be signed in." };
  }

  // ---- 3. Validate the referenced entities exist, belong to this school (RLS-scoped
  //         select), and fetch the names the prompt needs, in one round trip each. ----
  const [{ data: yearRow }, { data: termRow }, { data: classRow }, { data: subjectRow }, streamResult] = await Promise.all([
    supabase.from("academic_years").select("name").eq("id", input.academic_year_id).maybeSingle(),
    supabase.from("terms").select("name").eq("id", input.term_id).maybeSingle(),
    supabase.from("classes").select("name").eq("id", input.class_id).maybeSingle(),
    supabase.from("subjects").select("name").eq("id", input.subject_id).maybeSingle(),
    input.stream_id
      ? supabase.from("streams").select("name").eq("id", input.stream_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!yearRow || !termRow || !classRow || !subjectRow || (input.stream_id && !streamResult.data)) {
    return { error: "Please select the academic year, term, class and subject before generating the scheme." };
  }

  // ---- 4. Idempotency: claim this request before doing anything cost-incurring. ----
  const { error: idempotencyError } = await supabase.from("scheme_of_work_ai_requests").insert({
    school_id: schoolUser.school_id,
    requested_by: schoolUser.id,
    idempotency_key: input.idempotency_key,
    prompt_version: SCHEME_OF_WORK_PROMPT_VERSION,
    weeks_requested: input.total_weeks,
  });
  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      return { error: "This generation request was already submitted. Please wait for it to finish, or start a new one." };
    }
    return { error: "Something went wrong while preparing your scheme. No existing scheme data was changed. Please try again." };
  }

  const { data: requestRow } = await supabase
    .from("scheme_of_work_ai_requests")
    .select("id")
    .eq("requested_by", schoolUser.id)
    .eq("idempotency_key", input.idempotency_key)
    .single();
  const requestId: string | undefined = requestRow?.id;

  const startedAt = Date.now();
  const markRequestFailed = async (failureCategory: string) => {
    if (!requestId) return;
    await supabase
      .from("scheme_of_work_ai_requests")
      .update({ status: "failed", failure_category: failureCategory, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() })
      .eq("id", requestId);
  };

  // ---- 5. Rate limit (per-teacher, independent of the general write permission). ----
  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `ai-scheme-generation:${user.id}`,
      p_max_events: 20,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      await markRequestFailed("rate_limit");
      return { error: "AI generation is temporarily busy. Please wait a moment and try again." };
    }
  } catch {
    // If the admin client isn't configured in this environment, fall through rather
    // than blocking a legitimate, permission-checked, idempotency-claimed request.
  }

  // ---- 6. Look up this school's own recorded curriculum content for this
  //         subject (curriculum_strands/curriculum_sub_strands -- populated,
  //         if at all, via the CBC competency-marking feature). RLS already
  //         scopes this to the caller's school; the explicit school_id filter
  //         is just defense-in-depth. Never fatal: if this school has nothing
  //         recorded, curriculumContext stays null and the prompt falls back
  //         to exactly its pre-existing behavior. ----
  const { data: strandsRaw } = await supabase
    .from("curriculum_strands")
    .select("name, curriculum_sub_strands(name, learning_outcomes, key_inquiry_questions, rubric_text, content_source)")
    .eq("subject_id", input.subject_id)
    .eq("school_id", schoolUser.school_id)
    .order("level_order");

  const curriculumContext = buildCurriculumContext(
    (strandsRaw ?? []).map((s) => ({
      name: s.name,
      sub_strands: (s.curriculum_sub_strands ?? []) as CurriculumSubStrandRow[],
    })),
  );

  // ---- 7. Build the prompt server-side, from validated DB fields only (never raw
  //         teacher free-text -- see the doc comment on buildSchemeOfWorkPrompt). ----
  const prompt = buildSchemeOfWorkPrompt({
    subjectName: subjectRow.name,
    className: classRow.name,
    streamName: streamResult.data?.name ?? null,
    termName: termRow.name,
    academicYearName: yearRow.name,
    totalWeeks: input.total_weeks,
    lessonsPerWeek: input.lessons_per_week,
    curriculumFramework: input.curriculum_framework,
    curriculumContext: curriculumContext?.text ?? null,
  });

  // ---- 8. Call Gemini. Same Vercel Hobby ~10s hard cap noted in
  //         draftCommentWithAI applies here -- a large scheme (many weeks x many
  //         lessons) is a known risk of hitting that cap; see the PR notes. ----
  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_SCHEME_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 8000,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: schemeOfWorkResponseSchema,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await markRequestFailed(isTimeout ? "timeout" : "network");
    return isTimeout
      ? { error: "Generation timed out. The AI took too long to respond. No changes were made to your existing scheme." }
      : { error: "Connection interrupted. We couldn't complete the AI request. Your existing work is safe. Please check your connection and try again." };
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`generateSchemeWithAI: Gemini returned ${res.status} (request ${requestId}): ${body.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) {
      await markRequestFailed("auth_config");
      return { error: "AI generation is currently unavailable. Please contact your school administrator if the problem continues." };
    }
    if (res.status === 429) {
      await markRequestFailed("rate_limit");
      return { error: "AI generation is temporarily busy. Please wait a moment and try again." };
    }
    if (res.status >= 500) {
      await markRequestFailed("ai_unavailable");
      return { error: "AI generation is temporarily unavailable. Your existing scheme data has not been affected. Please try again shortly." };
    }
    await markRequestFailed("server_error");
    return { error: "Something went wrong while preparing your scheme. No existing scheme data was changed. Please try again." };
  }

  const data = await res.json();
  const parsed = parseSchemeOfWorkResponse(data);
  if ("error" in parsed) {
    console.error(`generateSchemeWithAI: response failed validation (request ${requestId}): ${parsed.error}`, JSON.stringify(data).slice(0, 500));
    await markRequestFailed(parsed.error.includes("no content") || parsed.error.includes("no weeks") ? "empty_response" : "malformed_response");
    return { error: "We couldn't prepare the scheme correctly. The AI returned an unexpected result. Please try generating it again." };
  }

  const generated = countWeeksGenerated(parsed.draft);
  const partial = generated < input.total_weeks;
  const warnings = checkSchemeOfWorkQuality(parsed.draft, input.total_weeks, input.lessons_per_week);

  if (requestId) {
    await supabase
      .from("scheme_of_work_ai_requests")
      .update({
        status: partial ? "partial" : "succeeded",
        weeks_generated: generated,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", requestId);
  }

  return {
    success: true,
    requestId: requestId ?? "",
    draft: parsed.draft,
    warnings,
    partial,
    weeksRequested: input.total_weeks,
    weeksGenerated: generated,
    curriculumItemsUsed: curriculumContext?.itemCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// saveGeneratedScheme
//
// The only action that writes to schemes_of_work / scheme_of_work_entries
// for AI-originated content, called on the teacher's explicit "Save" click
// after they've reviewed (and possibly edited) the draft. If scheme_id is
// omitted, a new scheme is created -- and if one already exists for this
// exact teacher+class+stream+subject+term, the unique constraint on
// schemes_of_work rejects the insert rather than silently creating a
// duplicate or merging into the existing one; the caller is told to open
// the existing scheme and save into it (by passing its id) instead.
// ---------------------------------------------------------------------------

export interface SaveGeneratedSchemeInput {
  request_id: string | null;
  academic_year_id: string;
  term_id: string;
  class_id: string;
  stream_id: string | null;
  subject_id: string;
  total_weeks: number;
  lessons_per_week: number;
  weeks: SchemeOfWorkDraftWeek[];
  /** Save into this existing scheme instead of creating a new one. */
  scheme_id?: string;
}

export type SaveGeneratedSchemeResult = { error: string } | { success: true; schemeId: string };

export async function saveGeneratedScheme(input: SaveGeneratedSchemeInput): Promise<SaveGeneratedSchemeResult> {
  if (!Array.isArray(input.weeks) || input.weeks.length === 0) {
    return { error: "There's nothing to save — generate or add scheme content first." };
  }
  for (const week of input.weeks) {
    if (!Number.isInteger(week.week) || week.week <= 0 || !Array.isArray(week.entries) || week.entries.length === 0) {
      return { error: "We couldn't prepare the scheme correctly. Please try generating it again." };
    }
    for (const entry of week.entries) {
      if (!Number.isInteger(entry.lesson) || entry.lesson <= 0 || !entry.topic?.trim()) {
        return { error: "We couldn't prepare the scheme correctly. Please try generating it again." };
      }
    }
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  let schemeId: string;

  if (!input.scheme_id) {
    const { data: created, error: createError } = await supabase
      .from("schemes_of_work")
      .insert({
        school_id: schoolUser.school_id,
        academic_year_id: input.academic_year_id,
        term_id: input.term_id,
        class_id: input.class_id,
        stream_id: input.stream_id,
        subject_id: input.subject_id,
        teacher_id: schoolUser.id,
        total_weeks: input.total_weeks,
        lessons_per_week: input.lessons_per_week,
        origin: "ai_generated",
        status: "draft",
        created_by: schoolUser.id,
      })
      .select("id")
      .single();

    if (createError) {
      if (createError.code === "23505") {
        return {
          error: "A scheme already exists for this class, subject and term. Open it and save into it instead of creating a new one.",
        };
      }
      return { error: "Something went wrong while preparing your scheme. No existing scheme data was changed. Please try again." };
    }
    schemeId = created.id;
  } else {
    // Ownership/permission is enforced by RLS on the update below (or the
    // entries upsert), not by this select -- this is only to fail fast with
    // a clear message instead of a confusing empty-write result.
    const { data: existing } = await supabase.from("schemes_of_work").select("id").eq("id", input.scheme_id).maybeSingle();
    if (!existing) {
      return { error: "You don't have permission to save this scheme, or it no longer exists." };
    }
    schemeId = existing.id;
  }

  const rows = input.weeks.flatMap((week) =>
    week.entries.map((entry) => ({
      scheme_id: schemeId,
      week_number: week.week,
      lesson_number: entry.lesson,
      topic: entry.topic,
      subtopic: entry.subtopic || null,
      learning_outcomes: entry.learning_outcomes || null,
      content: entry.content || null,
      activities: entry.activities || null,
      teaching_methods: entry.methods || null,
      resources: entry.resources || null,
      assessment_methods: entry.assessment || null,
      source: "ai_generated",
    })),
  );

  const { error: entriesError } = await supabase
    .from("scheme_of_work_entries")
    .upsert(rows, { onConflict: "scheme_id,week_number,lesson_number" });

  if (entriesError) {
    return { error: "Something went wrong while saving your scheme. Please try again." };
  }

  if (input.request_id) {
    await supabase.from("scheme_of_work_ai_requests").update({ scheme_id: schemeId }).eq("id", input.request_id);
  }

  revalidatePath("/academics/scheme-of-work");
  return { success: true, schemeId };
}

// ---------------------------------------------------------------------------
// Manual fallback + shared editing actions.
//
// None of this depends on AI in any way -- per spec item 23/30, the module
// must be fully usable with AI completely unavailable. This is that path:
// create a scheme by hand, add/edit/delete/duplicate/complete entries one
// at a time, then submit for review.
// ---------------------------------------------------------------------------

export interface CreateManualSchemeInput {
  academic_year_id: string;
  term_id: string;
  class_id: string;
  stream_id: string | null;
  subject_id: string;
  total_weeks: number;
  lessons_per_week: number;
}

export async function createManualScheme(input: CreateManualSchemeInput): Promise<SaveGeneratedSchemeResult> {
  if (
    !isNonEmptyUuidLike(input.academic_year_id) ||
    !isNonEmptyUuidLike(input.term_id) ||
    !isNonEmptyUuidLike(input.class_id) ||
    !isNonEmptyUuidLike(input.subject_id)
  ) {
    return { error: "Please select the academic year, term, class and subject." };
  }
  if (!Number.isInteger(input.total_weeks) || input.total_weeks <= 0 || input.total_weeks > 52) {
    return { error: "Please enter a valid number of teaching weeks (1–52)." };
  }
  if (!Number.isInteger(input.lessons_per_week) || input.lessons_per_week <= 0 || input.lessons_per_week > 20) {
    return { error: "Please enter a valid number of lessons per week (1–20)." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  const { data: created, error: createError } = await supabase
    .from("schemes_of_work")
    .insert({
      school_id: schoolUser.school_id,
      academic_year_id: input.academic_year_id,
      term_id: input.term_id,
      class_id: input.class_id,
      stream_id: input.stream_id,
      subject_id: input.subject_id,
      teacher_id: schoolUser.id,
      total_weeks: input.total_weeks,
      lessons_per_week: input.lessons_per_week,
      origin: "manual",
      status: "draft",
      created_by: schoolUser.id,
    })
    .select("id")
    .single();

  if (createError) {
    if (createError.code === "23505") {
      return { error: "A scheme already exists for this class, subject and term. Open it instead of creating a new one." };
    }
    return { error: "Something went wrong while creating the scheme. Please try again." };
  }

  revalidatePath("/academics/scheme-of-work");
  return { success: true, schemeId: created.id };
}

export type { SchemeEntryInput };

export type EntryResult = { error: string } | { success: true; entryId: string };

export async function addSchemeEntry(input: SchemeEntryInput): Promise<EntryResult> {
  const validationError = validateEntryInput(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase
    .from("scheme_of_work_entries")
    .insert({
      scheme_id: input.scheme_id,
      week_number: input.week_number,
      lesson_number: input.lesson_number,
      entry_date: input.entry_date || null,
      topic: input.topic.trim(),
      subtopic: input.subtopic || null,
      learning_outcomes: input.learning_outcomes || null,
      content: input.content || null,
      activities: input.activities || null,
      teaching_methods: input.teaching_methods || null,
      resources: input.resources || null,
      assessment_methods: input.assessment_methods || null,
      references: input.references || null,
      remarks: input.remarks || null,
      source: "manual",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "There's already a lesson at that week and lesson number." };
    }
    return { error: "You don't have permission to edit this scheme, or something went wrong. Please try again." };
  }

  // First lesson added to a fresh scheme: draft -> in_progress. Guarded on
  // the current status so this is a no-op once the scheme has moved past
  // draft (submitted/under_review/approved schemes can still get entries
  // added by write_any holders without being silently reset). Deliberately
  // fire-and-forget on error -- the entry itself already saved successfully,
  // and a missed status flip is cosmetic, not data loss.
  await supabase.from("schemes_of_work").update({ status: "in_progress" }).eq("id", input.scheme_id).eq("status", "draft");

  revalidatePath("/academics/scheme-of-work");
  return { success: true, entryId: data.id };
}

export async function updateSchemeEntry(entryId: string, input: SchemeEntryInput): Promise<EntryResult> {
  if (!isNonEmptyUuidLike(entryId)) return { error: "Missing entry." };
  const validationError = validateEntryInput(input);
  if (validationError) return { error: validationError };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase
    .from("scheme_of_work_entries")
    .update({
      week_number: input.week_number,
      lesson_number: input.lesson_number,
      entry_date: input.entry_date || null,
      topic: input.topic.trim(),
      subtopic: input.subtopic || null,
      learning_outcomes: input.learning_outcomes || null,
      content: input.content || null,
      activities: input.activities || null,
      teaching_methods: input.teaching_methods || null,
      resources: input.resources || null,
      assessment_methods: input.assessment_methods || null,
      references: input.references || null,
      remarks: input.remarks || null,
    })
    .eq("id", entryId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { error: "There's already a lesson at that week and lesson number." };
    }
    return { error: "Something went wrong while saving. Please try again." };
  }
  if (!data) {
    return { error: "You don't have permission to edit this entry, or it no longer exists." };
  }

  revalidatePath("/academics/scheme-of-work");
  return { success: true, entryId: data.id };
}

export async function deleteSchemeEntry(entryId: string): Promise<{ error: string } | { success: true }> {
  if (!isNonEmptyUuidLike(entryId)) return { error: "Missing entry." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase.from("scheme_of_work_entries").delete().eq("id", entryId).select("id").maybeSingle();
  if (error) return { error: "Something went wrong while deleting. Please try again." };
  if (!data) return { error: "You don't have permission to delete this entry, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true };
}

export async function duplicateSchemeEntry(
  entryId: string,
  target: { week_number: number; lesson_number: number },
): Promise<EntryResult> {
  if (!isNonEmptyUuidLike(entryId)) return { error: "Missing entry." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data: source } = await supabase.from("scheme_of_work_entries").select("*").eq("id", entryId).maybeSingle();
  if (!source) return { error: "You don't have permission to duplicate this entry, or it no longer exists." };

  return addSchemeEntry({
    scheme_id: source.scheme_id,
    week_number: target.week_number,
    lesson_number: target.lesson_number,
    // entry_date is intentionally not copied: it's tied to the specific
    // calendar date of the source lesson, which doesn't carry over to a
    // different week/lesson slot. The teacher sets a new date if needed.
    entry_date: "",
    topic: source.topic ?? "",
    subtopic: source.subtopic ?? "",
    learning_outcomes: source.learning_outcomes ?? "",
    content: source.content ?? "",
    activities: source.activities ?? "",
    teaching_methods: source.teaching_methods ?? "",
    resources: source.resources ?? "",
    assessment_methods: source.assessment_methods ?? "",
    references: source.references ?? "",
    remarks: source.remarks ?? "",
  });
}

// Repositions an entry to a different week/lesson slot in place, touching
// only week_number/lesson_number -- unlike duplicateSchemeEntry (which
// inserts a new row) this updates the existing row, so its id, source,
// completion_status and all lesson content are preserved untouched. Same
// unique-constraint-conflict handling as updateSchemeEntry/addSchemeEntry.
export async function moveSchemeEntry(
  entryId: string,
  target: { week_number: number; lesson_number: number },
): Promise<EntryResult> {
  if (!isNonEmptyUuidLike(entryId)) return { error: "Missing entry." };
  if (!Number.isInteger(target.week_number) || target.week_number <= 0 || target.week_number > 52) {
    return { error: "Invalid week number." };
  }
  if (!Number.isInteger(target.lesson_number) || target.lesson_number <= 0 || target.lesson_number > 20) {
    return { error: "Invalid lesson number." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase
    .from("scheme_of_work_entries")
    .update({ week_number: target.week_number, lesson_number: target.lesson_number })
    .eq("id", entryId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { error: "There's already a lesson at that week and lesson number." };
    }
    return { error: "Something went wrong while moving. Please try again." };
  }
  if (!data) return { error: "You don't have permission to edit this entry, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true, entryId: data.id };
}

// ---------------------------------------------------------------------------
// assistSchemeEntry (gap #5)
//
// A scoped, single-entry counterpart to generateSchemeWithAI: no entry point
// for AI exists once a scheme is saved (only on the create screen, before
// anything is persisted). This lets a teacher ask for a targeted rewrite of
// one already-saved lesson -- reusing the same permission check, rate limit,
// idempotency/audit table, structured-output call and failure-category
// taxonomy as the whole-scheme generator, at a smaller scope. Like
// generateSchemeWithAI, this never writes to scheme_of_work_entries itself
// -- it only returns a suggestion for the teacher to review; applying it
// into the edit form and persisting it goes through the existing, unchanged
// updateSchemeEntry on an explicit Save click.
// ---------------------------------------------------------------------------

export interface AssistSchemeEntryInput {
  entry_id: string;
  mode: EntryAssistMode;
  /** Same one-per-click contract as GenerateSchemeInput.idempotency_key. */
  idempotency_key: string;
}

export type AssistSchemeEntryResult = { error: string } | { success: true; requestId: string; suggestion: EntryAssistDraft };

export async function assistSchemeEntry(input: AssistSchemeEntryInput): Promise<AssistSchemeEntryResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  if (!isNonEmptyUuidLike(input.entry_id) || !isNonEmptyUuidLike(input.idempotency_key)) {
    return { error: "Missing lesson entry." };
  }
  if (input.mode !== "improve" && input.mode !== "expand" && input.mode !== "generate_activities") {
    return { error: "Invalid AI Assist option." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: canGenerate } = await supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.generate_ai" });
  if (!canGenerate) {
    return { error: "You don't have permission to use AI Assist." };
  }

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  // Entry + everything the prompt needs about its parent scheme, in one
  // round trip. RLS on scheme_of_work_entries already scopes reads to
  // entries the caller can see; the explicit school_id check below is
  // defense-in-depth, same as generateSchemeWithAI's entity checks.
  const { data: entryRow } = await supabase
    .from("scheme_of_work_entries")
    .select(
      "id, topic, subtopic, learning_outcomes, content, activities, teaching_methods, resources, assessment_methods, scheme_id, schemes_of_work!inner(school_id, subject_id, subjects(name), classes(name), streams(name), terms(name, academic_years(name)))",
    )
    .eq("id", input.entry_id)
    .maybeSingle();

  if (!entryRow) {
    return { error: "This lesson entry doesn't exist, or you don't have access to it." };
  }

  const scheme = entryRow.schemes_of_work as unknown as {
    school_id: string;
    subject_id: string;
    subjects: { name: string } | null;
    classes: { name: string } | null;
    streams: { name: string } | null;
    terms: { name: string; academic_years: { name: string } | null } | null;
  };
  if (scheme.school_id !== schoolUser.school_id) {
    return { error: "This lesson entry doesn't exist, or you don't have access to it." };
  }

  // Idempotency: claim this request before doing anything cost-incurring.
  // Reuses scheme_of_work_ai_requests -- weeks_requested is NOT NULL there
  // for the whole-scheme case, so 0 is used here as an explicit "not
  // applicable" sentinel; prompt_version is what actually distinguishes an
  // entry-assist row from a full-generation row in the audit log.
  const { error: idempotencyError } = await supabase.from("scheme_of_work_ai_requests").insert({
    school_id: schoolUser.school_id,
    scheme_id: entryRow.scheme_id,
    requested_by: schoolUser.id,
    idempotency_key: input.idempotency_key,
    prompt_version: SCHEME_OF_WORK_ENTRY_ASSIST_PROMPT_VERSION,
    weeks_requested: 0,
  });
  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      return { error: "This AI Assist request was already submitted. Please wait for it to finish, or try again." };
    }
    return { error: "Something went wrong. No existing lesson data was changed. Please try again." };
  }

  const { data: requestRow } = await supabase
    .from("scheme_of_work_ai_requests")
    .select("id")
    .eq("requested_by", schoolUser.id)
    .eq("idempotency_key", input.idempotency_key)
    .single();
  const requestId: string | undefined = requestRow?.id;

  const startedAt = Date.now();
  const markRequestFailed = async (failureCategory: string) => {
    if (!requestId) return;
    await supabase
      .from("scheme_of_work_ai_requests")
      .update({ status: "failed", failure_category: failureCategory, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() })
      .eq("id", requestId);
  };

  // Rate limit -- a separate bucket from ai-scheme-generation so bulk
  // whole-scheme generation and per-entry assist don't share one quota.
  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `ai-scheme-entry-assist:${user.id}`,
      p_max_events: 30,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      await markRequestFailed("rate_limit");
      return { error: "AI generation is temporarily busy. Please wait a moment and try again." };
    }
  } catch {
    // Same fallthrough as generateSchemeWithAI: don't block a legitimate,
    // permission-checked, idempotency-claimed request over admin-client config.
  }

  const { data: strandsRaw } = await supabase
    .from("curriculum_strands")
    .select("name, curriculum_sub_strands(name, learning_outcomes, key_inquiry_questions, rubric_text, content_source)")
    .eq("subject_id", scheme.subject_id)
    .eq("school_id", schoolUser.school_id)
    .order("level_order");

  const curriculumContext = buildCurriculumContext(
    (strandsRaw ?? []).map((s) => ({
      name: s.name,
      sub_strands: (s.curriculum_sub_strands ?? []) as CurriculumSubStrandRow[],
    })),
  );

  const prompt = buildEntryAssistPrompt({
    mode: input.mode,
    subjectName: scheme.subjects?.name ?? "the subject",
    className: scheme.classes?.name ?? "the class",
    streamName: scheme.streams?.name ?? null,
    termName: scheme.terms?.name ?? "",
    academicYearName: scheme.terms?.academic_years?.name ?? "",
    curriculumContext: curriculumContext?.text ?? null,
    entry: {
      topic: entryRow.topic ?? "",
      subtopic: entryRow.subtopic ?? "",
      learning_outcomes: entryRow.learning_outcomes ?? "",
      content: entryRow.content ?? "",
      activities: entryRow.activities ?? "",
      teaching_methods: entryRow.teaching_methods ?? "",
      resources: entryRow.resources ?? "",
      assessment_methods: entryRow.assessment_methods ?? "",
    },
  });

  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(apiKey, GEMINI_SCHEME_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: entryAssistResponseSchema,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await markRequestFailed(isTimeout ? "timeout" : "network");
    return isTimeout
      ? { error: "Generation timed out. The AI took too long to respond. No changes were made to your lesson." }
      : { error: "Connection interrupted. We couldn't complete the AI request. Your existing work is safe. Please check your connection and try again." };
  }

  if (!res.ok) {
    const body = await res.text();
    console.error(`assistSchemeEntry: Gemini returned ${res.status} (request ${requestId}): ${body.slice(0, 500)}`);
    if (res.status === 401 || res.status === 403) {
      await markRequestFailed("auth_config");
      return { error: "AI generation is currently unavailable. Please contact your school administrator if the problem continues." };
    }
    if (res.status === 429) {
      await markRequestFailed("rate_limit");
      return { error: "AI generation is temporarily busy. Please wait a moment and try again." };
    }
    if (res.status >= 500) {
      await markRequestFailed("ai_unavailable");
      return { error: "AI generation is temporarily unavailable. Your existing lesson data has not been affected. Please try again shortly." };
    }
    await markRequestFailed("server_error");
    return { error: "Something went wrong. No existing lesson data was changed. Please try again." };
  }

  const data = await res.json();
  const parsed = parseEntryAssistResponse(data);
  if ("error" in parsed) {
    console.error(`assistSchemeEntry: response failed validation (request ${requestId}): ${parsed.error}`, JSON.stringify(data).slice(0, 500));
    await markRequestFailed(parsed.error.includes("no content") ? "empty_response" : "malformed_response");
    return { error: "We couldn't prepare the suggestion correctly. The AI returned an unexpected result. Please try again." };
  }

  if (requestId) {
    await supabase
      .from("scheme_of_work_ai_requests")
      .update({ status: "succeeded", weeks_generated: 0, duration_ms: Date.now() - startedAt, completed_at: new Date().toISOString() })
      .eq("id", requestId);
  }

  return { success: true, requestId: requestId ?? "", suggestion: parsed.suggestion };
}

export async function toggleEntryComplete(entryId: string, completed: boolean): Promise<EntryResult> {
  if (!isNonEmptyUuidLike(entryId)) return { error: "Missing entry." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const { data, error } = await supabase
    .from("scheme_of_work_entries")
    .update({ completion_status: completed ? "completed" : "pending", completed_at: completed ? new Date().toISOString() : null })
    .eq("id", entryId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Something went wrong. Please try again." };
  if (!data) return { error: "You don't have permission to edit this entry, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true, entryId: data.id };
}

export async function submitScheme(schemeId: string): Promise<{ error: string } | { success: true }> {
  if (!isNonEmptyUuidLike(schemeId)) return { error: "Missing scheme." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  const { data, error } = await supabase
    .from("schemes_of_work")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: schoolUser.id })
    .eq("id", schemeId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Something went wrong while submitting. Please try again." };
  if (!data) return { error: "You don't have permission to submit this scheme, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true };
}

// Lets a reviewer explicitly claim a submitted scheme, same pattern as
// markUnderReviewAction in admissions/actions.ts. Guarded to only advance
// from "submitted" so it can't clobber a scheme another reviewer already
// approved/returned in the meantime.
export async function startSchemeReview(schemeId: string): Promise<{ error: string } | { success: true }> {
  if (!isNonEmptyUuidLike(schemeId)) return { error: "Missing scheme." };

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: canReview } = await supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.review" });
  if (!canReview) return { error: "You don't have permission to review schemes." };

  const { data, error } = await supabase
    .from("schemes_of_work")
    .update({ status: "under_review" })
    .eq("id", schemeId)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();

  if (error) return { error: "Something went wrong. Please try again." };
  if (!data) return { error: "This scheme isn't awaiting review, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true };
}

export async function reviewScheme(
  schemeId: string,
  action: "approve" | "return",
  comment: string | null,
): Promise<{ error: string } | { success: true }> {
  if (!isNonEmptyUuidLike(schemeId)) return { error: "Missing scheme." };
  if (action === "return" && !comment?.trim()) {
    return { error: "Please add a comment explaining what needs to change before returning it." };
  }

  const supabase = await createClient();
  await tagSentryRequestContext(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: canReview } = await supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.review" });
  if (!canReview) return { error: "You don't have permission to review schemes." };

  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!schoolUser) return { error: "You must be signed in." };

  const { data, error } = await supabase
    .from("schemes_of_work")
    .update(
      action === "approve"
        ? { status: "approved", reviewed_by: schoolUser.id, reviewed_at: new Date().toISOString(), review_comment: comment || null }
        : { status: "draft", reviewed_by: schoolUser.id, reviewed_at: new Date().toISOString(), review_comment: comment },
    )
    .eq("id", schemeId)
    .select("id")
    .maybeSingle();

  if (error) return { error: "Something went wrong while reviewing. Please try again." };
  if (!data) return { error: "You don't have permission to review this scheme, or it no longer exists." };

  revalidatePath("/academics/scheme-of-work");
  return { success: true };
}
