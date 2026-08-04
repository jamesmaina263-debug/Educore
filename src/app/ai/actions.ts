"use server";

import { createClient } from "@/lib/supabase/server";

// Phase 4, Item 1: Natural-language analytics ("Ask Trimora AI").
//
// Deliberately NOT text-to-SQL. Gemini's only job is to classify the question into one of a
// fixed, small set of pre-defined intents below — it never sees the database schema and never
// generates SQL. The actual data retrieval is done by ordinary RLS-respecting queries run as the
// caller (via the session-scoped `createClient()`, same as every other page in this app), and the
// answer is built from a plain template, not a second LLM call — so nothing in the answer can be
// invented. This mirrors the report-cards AI feature's rule: AI never reaches the user un-grounded.

type Intent =
  | "total_students"
  | "attendance_rate_today"
  | "fee_collection_rate"
  | "outstanding_balance_total"
  | "at_risk_count"
  | "exam_average";

const INTENTS: { key: Intent; description: string }[] = [
  { key: "total_students", description: "How many active students are enrolled" },
  { key: "attendance_rate_today", description: "What percentage of students were marked present today" },
  { key: "fee_collection_rate", description: "What percentage of this term's invoiced fees have been collected so far, and the projected end-of-term rate" },
  { key: "outstanding_balance_total", description: "The total outstanding (unpaid) fee balance across all students" },
  { key: "at_risk_count", description: "How many students are currently flagged at-risk, and why" },
  { key: "exam_average", description: "The school-wide average exam score for the most recent closed exam this term" },
];

export interface AskAIResult {
  answer?: string;
  error?: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function classifyIntent(question: string): Promise<Intent | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a strict classifier. Given a school administrator's question, respond with ONLY a JSON object of the form {"intent": "<key>"} where <key> is exactly one of the following, or "unrecognized" if none fit:

${INTENTS.map((i) => `- ${i.key}: ${i.description}`).join("\n")}

Question: "${question.replace(/"/g, "'")}"

Respond with ONLY the JSON object, nothing else.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 40 },
      }),
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const match = text.match(/\{[^}]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    const candidate = parsed?.intent as string | undefined;
    if (candidate && INTENTS.some((i) => i.key === candidate)) return candidate as Intent;
    return null;
  } catch {
    return null;
  }
}

export async function askTrimoraAI(question: string): Promise<AskAIResult> {
  const trimmed = question.trim();
  if (!trimmed) return { error: "Ask a question first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: canAskAI } = await supabase.rpc("auth_has_permission", { p_permission_key: "ai.read" });
  if (!canAskAI) return { error: "You don't have access to Trimora AI." };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "Trimora AI isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  const intent = await classifyIntent(trimmed);
  let answer: string;

  if (!intent) {
    answer =
      "I can't answer that yet. Right now I can answer questions about: " +
      INTENTS.map((i) => i.description.toLowerCase()).join("; ") +
      ".";
  } else {
    answer = await runIntent(supabase, intent);
  }

  await supabase.from("ai_query_logs").insert({
    school_id: schoolUser.school_id,
    asked_by: schoolUser.id,
    question_text: trimmed,
    matched_intent: intent,
    answer_text: answer,
  });

  return { answer };
}

async function runIntent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  intent: Intent,
): Promise<string> {
  switch (intent) {
    case "total_students": {
      const { count } = await supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");
      return `There are ${count ?? 0} active students enrolled.`;
    }

    case "attendance_rate_today": {
      const today = todayISO();
      const { data } = await supabase
        .from("student_attendance")
        .select("status")
        .eq("attendance_date", today);
      const total = data?.length ?? 0;
      const present = (data ?? []).filter((r) => r.status === "present").length;
      if (total === 0) return "No attendance has been marked for today yet.";
      return `${present} of ${total} students marked present today (${Math.round((100 * present) / total)}%).`;
    }

    case "fee_collection_rate": {
      const { data } = await supabase
        .from("v_fee_collection_forecast")
        .select("term_name, current_collection_rate_pct, projected_collection_rate_pct")
        .maybeSingle();
      if (!data) return "No active term with fee data was found.";
      const projected = Math.min(100, Number(data.projected_collection_rate_pct ?? 0));
      return `${data.term_name}: ${data.current_collection_rate_pct ?? 0}% of fees collected so far, on pace for roughly ${projected}% by term end (linear projection).`;
    }

    case "outstanding_balance_total": {
      const { data } = await supabase.from("v_student_balances").select("balance");
      const total = (data ?? []).reduce((sum, r) => sum + Math.max(0, Number(r.balance)), 0);
      return `Total outstanding fee balance across all students is KES ${total.toLocaleString()}.`;
    }

    case "at_risk_count": {
      const { data } = await supabase
        .from("v_at_risk_students")
        .select("first_name, last_name, risk_reasons")
        .order("risk_score", { ascending: false })
        .limit(5);
      if (!data || data.length === 0) return "No students are currently flagged at-risk.";
      const names = data.map((s) => `${s.first_name} ${s.last_name}`).join(", ");
      return `${data.length} student(s) currently flagged at-risk, most concerning first: ${names}.`;
    }

    case "exam_average": {
      const { data: exam } = await supabase
        .from("exams")
        .select("id, name")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!exam) return "No closed exam was found for the current term.";
      const { data: rankings } = await supabase
        .from("class_rankings")
        .select("average_score")
        .eq("exam_id", exam.id);
      if (!rankings || rankings.length === 0) return `${exam.name}: no rankings have been computed yet.`;
      const avg =
        rankings.reduce((sum, r) => sum + Number(r.average_score), 0) / rankings.length;
      return `${exam.name}: school-wide average score is ${avg.toFixed(1)}.`;
    }
  }
}
