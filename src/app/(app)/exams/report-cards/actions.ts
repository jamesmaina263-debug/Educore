"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReportCardCommentPrompt, geminiGenerateContentUrl, parseGeminiCommentResponse } from "@/lib/ai/report-card-comment";

type ActionResult = { error: string } | { success: true };

export async function generateReportCards(examId: string, classId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_report_cards", { p_exam_id: examId, p_class_id: classId });
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}

export async function approveComment(input: { exam_id: string; student_id: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  const { error } = await supabase
    .from("report_cards")
    .update({ comment_source: "teacher_approved", approved_by: schoolUser?.id ?? null, approved_at: new Date().toISOString() })
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}

export async function writeComment(input: { exam_id: string; student_id: string; comment: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id")
    .eq("auth_user_id", user?.id ?? "")
    .maybeSingle();

  const { error } = await supabase
    .from("report_cards")
    .update({
      comment: input.comment,
      comment_source: "teacher_written",
      approved_by: schoolUser?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/report-cards");
  return { success: true };
}

// ---------------------------------------------------------------------------
// AI-drafted comments (Google Gemini — free tier, no credit card required:
// https://aistudio.google.com/apikey). The draft is written with
// comment_source='ai' and is never shown to a parent as final — a teacher
// must explicitly approve() or overwrite it via writeComment() first.
// ---------------------------------------------------------------------------

export async function draftCommentWithAI(input: {
  exam_id: string;
  student_id: string;
  student_name: string;
}): Promise<ActionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "AI drafting isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  const supabase = await createClient();

  // SECURITY: unlike the other actions in this file, this one makes a real,
  // cost-incurring outbound call (Gemini) before ever touching a
  // report_cards row -- the RLS policy on the eventual .update() below
  // (report_cards.approve) does NOT stop an authenticated user who lacks
  // that permission from *reaching* this point, since Supabase's RLS-scoped
  // update simply silently affects 0 rows rather than throwing. That left
  // any authenticated user (any role, any school -- parent/student portal
  // accounts included) able to call this Server Action directly with
  // arbitrary arguments and burn Gemini API quota/cost with no server-side
  // authorization or throttling at all. Fixed with the same two-layer
  // pattern already used for login/signup/communication: an explicit
  // permission check up front, plus a per-user rate limit via
  // increment_and_check_rate_limit(), before any network call is made.
  const { data: canApprove } = await supabase.rpc("auth_has_permission", { p_permission_key: "report_cards.approve" });
  if (!canApprove) {
    return { error: "You don't have permission to draft report card comments." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `ai-report-comment:${user.id}`,
      p_max_events: 60,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      return { error: "Too many AI drafting requests. Please wait a while and try again." };
    }
  } catch {
    // If the admin client isn't configured in this environment, fall through
    // rather than blocking a legitimate, permission-checked request over a
    // missing rate-limit layer.
  }

  const { data: marks } = await supabase
    .from("marks")
    .select("raw_score, subjects(name), grading_scale_bands(label)")
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id);

  const prompt = buildReportCardCommentPrompt(
    input.student_name,
    (marks ?? []).map((m) => ({
      raw_score: m.raw_score,
      subject_name: (m.subjects as unknown as { name: string } | null)?.name ?? "Subject",
      band_label: (m.grading_scale_bands as unknown as { label: string } | null)?.label ?? null,
    })),
  );

  try {
    const res = await fetch(geminiGenerateContentUrl(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200 },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`draftCommentWithAI: Gemini returned ${res.status}: ${body.slice(0, 500)}`);
      return { error: `AI drafting failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const parsed = parseGeminiCommentResponse(data);
    if ("error" in parsed) {
      console.error("draftCommentWithAI: Gemini response had no text", JSON.stringify(data).slice(0, 500));
      return { error: parsed.error };
    }

    const { error } = await supabase
      .from("report_cards")
      .update({ comment: parsed.comment, comment_source: "ai", approved_by: null, approved_at: null })
      .eq("exam_id", input.exam_id)
      .eq("student_id", input.student_id);
    if (error) return { error: error.message };
  } catch (e) {
    console.error("draftCommentWithAI: fetch failed", e);
    return { error: e instanceof Error ? e.message : "Could not reach the AI drafting service." };
  }

  revalidatePath("/exams/report-cards");
  return { success: true };
}
