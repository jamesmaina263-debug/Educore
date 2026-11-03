"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tagSentryRequestContext } from "@/lib/observability/sentry-context";
import { questionsPayload, validateQuiz, validateResource, type QuizInput, type ResourceInput } from "@/lib/learning-portal";

type ActionResult = { error: string } | { success: true };

// Learning portal lite. Each action is a thin call to a database function that checks the caller, the school
// and the feature flag itself. Nothing here sends a message, takes a payment or uploads a file.

export async function saveResourceAction(input: ResourceInput): Promise<ActionResult> {
  const checked = validateResource(input);
  if ("error" in checked) return { error: checked.error };
  const r = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_learning_resource", {
    p_id: r.id,
    p_stream_id: r.streamId,
    p_subject_id: r.subjectId,
    p_kind: r.kind,
    p_title: r.title,
    p_body: r.kind === "note" ? r.body : null,
    p_url: r.kind === "note" ? null : r.url,
    p_starts_at: r.kind === "live_lesson" && r.startsAt ? new Date(r.startsAt).toISOString() : null,
    p_paper_year: r.kind === "past_paper" && r.paperYear ? Number(r.paperYear) : null,
    p_published: r.published,
  });
  if (error) return { error: error.message };
  revalidatePath("/academics/learning");
  return { success: true };
}

export async function deleteResourceAction(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing material." };
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("delete_learning_resource", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/academics/learning");
  return { success: true };
}

export async function saveQuizAction(input: QuizInput): Promise<ActionResult> {
  const checked = validateQuiz(input);
  if ("error" in checked) return { error: checked.error };
  const q = checked.value;
  const supabase = await createClient();
  await tagSentryRequestContext(supabase);
  const { error } = await supabase.rpc("save_learning_quiz", {
    p_id: q.id,
    p_stream_id: q.streamId,
    p_subject_id: q.subjectId,
    p_title: q.title,
    p_description: q.description.trim() || null,
    p_max_attempts: q.maxAttempts,
    p_show_answers: q.showAnswers,
    p_status: q.status,
    p_questions: q.questions === null ? null : questionsPayload(q.questions),
  });
  if (error) return { error: error.message };
  revalidatePath("/academics/learning");
  return { success: true };
}
