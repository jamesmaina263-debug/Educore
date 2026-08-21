"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
