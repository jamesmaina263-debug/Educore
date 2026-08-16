"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

  const lines = (marks ?? [])
    .map((m) => {
      const subject = (m.subjects as unknown as { name: string } | null)?.name ?? "Subject";
      const band = (m.grading_scale_bands as unknown as { label: string } | null)?.label;
      return m.raw_score !== null ? `${subject}: ${m.raw_score} (${band})` : `${subject}: ${band}`;
    })
    .join("\n");

  const prompt = `You are helping a Kenyan primary/secondary school teacher draft a short report card comment.
Student: ${input.student_name}
Results this exam:
${lines || "No subject results recorded."}

Write a warm, specific, 2-3 sentence comment on this student's academic performance for the term. Mention at least one specific subject or result. Avoid generic filler. Do not mention numeric scores directly in the prose (refer to strengths/areas to improve instead). Output only the comment text, no preamble.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 200 },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { error: `AI drafting failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const draft: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!draft) return { error: "AI drafting returned no text." };

    const { error } = await supabase
      .from("report_cards")
      .update({ comment: draft.trim(), comment_source: "ai", approved_by: null, approved_at: null })
      .eq("exam_id", input.exam_id)
      .eq("student_id", input.student_id);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach the AI drafting service." };
  }

  revalidatePath("/exams/report-cards");
  return { success: true };
}
