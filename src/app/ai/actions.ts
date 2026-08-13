"use server";

import { createClient } from "@/lib/supabase/server";

// Phase 4, Item 1: Natural-language analytics ("Ask Educore AI").
//
// Deliberately NOT text-to-SQL. Gemini's only job is to classify the question into one of a
// fixed, small set of pre-defined intents below — it never sees the database schema and never
// generates SQL. The actual data retrieval is done by ordinary RLS-respecting queries run as the
// caller (via the session-scoped `createClient()`, same as every other page in this app), and the
// answer is built from a plain template, not a second LLM call — so nothing in the answer can be
// invented. This mirrors the report-cards AI feature's rule: AI never reaches the user un-grounded.
//
// Phase 16 addition: every intent now declares the permission key(s) that actually govern its
// underlying data (mirroring the real RLS policy on those tables/views), and askEducoreAI checks
// them explicitly before running the query. Previously only the page-level `ai.read` gate was
// checked; because the underlying views use `security_invoker`, a caller lacking (e.g.) finance.read
// would silently get a confident-looking "KES 0" instead of a refusal — technically no row ever
// crossed the RLS boundary, but the answer looked like real data rather than "no access". Brief
// 4.19 is explicit that "AI must never grant access beyond what the user's role already permits",
// so this closes that gap: the module permission is now checked up front and produces an honest
// "you don't have access to X" instead of a fabricated zero.

type Intent =
  | "total_students"
  | "attendance_rate_today"
  | "absent_today"
  | "low_attendance_students"
  | "fee_collection_rate"
  | "fees_collected_this_term"
  | "outstanding_balance_total"
  | "at_risk_count"
  | "exam_average"
  | "classes_below_average"
  | "beds_available"
  | "dormitory_at_capacity"
  | "students_in_sick_bay"
  | "low_stock_inventory"
  | "daily_summary";

// A daily_summary answer is assembled from whichever of these sections the caller is permitted
// to see — it has no single gating permission of its own.
type PermissionKey =
  | "students.read"
  | "attendance.read"
  | "finance.read"
  | "exams.read"
  | "hostel.read_any"
  | "health.read_any"
  | "inventory.read_any";

const INTENTS: { key: Intent; description: string; permission: PermissionKey | null }[] = [
  { key: "total_students", description: "How many active students are enrolled", permission: "students.read" },
  { key: "attendance_rate_today", description: "What percentage of students were marked present today", permission: "attendance.read" },
  { key: "absent_today", description: "How many students are absent today", permission: "attendance.read" },
  { key: "low_attendance_students", description: "Which students have low attendance", permission: "attendance.read" },
  {
    key: "fee_collection_rate",
    description: "What percentage of this term's invoiced fees have been collected so far, and the projected end-of-term rate",
    permission: "finance.read",
  },
  { key: "fees_collected_this_term", description: "How much money has been collected this term (a KES figure, not a percentage)", permission: "finance.read" },
  { key: "outstanding_balance_total", description: "The total outstanding (unpaid) fee balance across all students", permission: "finance.read" },
  { key: "at_risk_count", description: "How many students are currently flagged at-risk, and why", permission: "students.read" },
  { key: "exam_average", description: "The school-wide average exam score for the most recent closed exam this term", permission: "exams.read" },
  { key: "classes_below_average", description: "Which classes/streams are performing below the school average in the most recent exam", permission: "exams.read" },
  { key: "beds_available", description: "How many boarding beds are currently available", permission: "hostel.read_any" },
  { key: "dormitory_at_capacity", description: "Which boarding dormitory is at or over capacity", permission: "hostel.read_any" },
  { key: "students_in_sick_bay", description: "Which students are currently checked into sick bay", permission: "health.read_any" },
  { key: "low_stock_inventory", description: "Which inventory items are low in stock (at or below their reorder level)", permission: "inventory.read_any" },
  { key: "daily_summary", description: "Give me a summary of the school today (a general end-of-day/status overview)", permission: null },
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

const PERMISSION_LABEL: Record<PermissionKey, string> = {
  "students.read": "student records",
  "attendance.read": "attendance",
  "finance.read": "finance",
  "exams.read": "exam results",
  "hostel.read_any": "boarding",
  "health.read_any": "health/sick bay",
  "inventory.read_any": "inventory",
};

export async function askEducoreAI(question: string): Promise<AskAIResult> {
  const trimmed = question.trim();
  if (!trimmed) return { error: "Ask a question first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: canAskAI } = await supabase.rpc("auth_has_permission", { p_permission_key: "ai.read" });
  if (!canAskAI) return { error: "You don't have access to Educore AI." };

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, school_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!schoolUser) return { error: "Could not resolve your account." };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { error: "Educore AI isn't configured yet — GEMINI_API_KEY is missing from the server environment." };
  }

  const intent = await classifyIntent(trimmed);
  let answer: string;

  if (!intent) {
    answer =
      "I can't answer that yet. Right now I can answer questions about: " +
      INTENTS.map((i) => i.description.toLowerCase()).join("; ") +
      ".";
  } else {
    const definition = INTENTS.find((i) => i.key === intent)!;
    if (definition.permission) {
      const { data: hasModulePermission } = await supabase.rpc("auth_has_permission", {
        p_permission_key: definition.permission,
      });
      if (!hasModulePermission) {
        answer = `You don't have access to ${PERMISSION_LABEL[definition.permission]} data, so I can't answer that.`;
        await supabase.from("ai_query_logs").insert({
          school_id: schoolUser.school_id,
          asked_by: schoolUser.id,
          question_text: trimmed,
          matched_intent: intent,
          answer_text: answer,
        });
        return { answer };
      }
    }
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
        .eq("attendance_date", today)
        .eq("session", "class");
      const total = data?.length ?? 0;
      const present = (data ?? []).filter((r) => r.status === "present").length;
      if (total === 0) return "No attendance has been marked for today yet.";
      return `${present} of ${total} students marked present today (${Math.round((100 * present) / total)}%).`;
    }

    case "absent_today": {
      const today = todayISO();
      const { data } = await supabase
        .from("student_attendance")
        .select("status")
        .eq("attendance_date", today)
        .eq("session", "class");
      const total = data?.length ?? 0;
      if (total === 0) return "No attendance has been marked for today yet.";
      const absent = (data ?? []).filter((r) => r.status === "absent").length;
      return `${absent} student(s) marked absent today, out of ${total} marked so far.`;
    }

    case "low_attendance_students": {
      const { data } = await supabase
        .from("v_at_risk_students")
        .select("first_name, last_name, attendance_rate_30d")
        .not("attendance_rate_30d", "is", null)
        .lt("attendance_rate_30d", 75)
        .order("attendance_rate_30d", { ascending: true })
        .limit(10);
      if (!data || data.length === 0) return "No students currently have low attendance (below 75% over the last 30 days).";
      const list = data.map((s) => `${s.first_name} ${s.last_name} (${s.attendance_rate_30d}%)`).join(", ");
      return `${data.length} student(s) with attendance below 75% over the last 30 days: ${list}.`;
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

    case "fees_collected_this_term": {
      const { data } = await supabase
        .from("v_fee_collection_forecast")
        .select("term_name, total_collected, total_invoiced")
        .maybeSingle();
      if (!data) return "No active term with fee data was found.";
      return `${data.term_name}: KES ${Number(data.total_collected).toLocaleString()} collected so far, of KES ${Number(data.total_invoiced).toLocaleString()} invoiced.`;
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

    case "classes_below_average": {
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
        .select("average_score, streams(name, classes(name))")
        .eq("exam_id", exam.id);
      if (!rankings || rankings.length === 0) return `${exam.name}: no rankings have been computed yet.`;
      const schoolAvg = rankings.reduce((sum, r) => sum + Number(r.average_score), 0) / rankings.length;
      const below = rankings
        .filter((r) => Number(r.average_score) < schoolAvg)
        .map((r) => {
          const stream = r.streams as unknown as { name: string; classes: { name: string } | null } | null;
          const label = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : "Unknown class";
          return `${label} (${Number(r.average_score).toFixed(1)})`;
        });
      if (below.length === 0) return `${exam.name}: no classes are below the school average of ${schoolAvg.toFixed(1)}.`;
      return `${exam.name}: school average is ${schoolAvg.toFixed(1)}. Below average: ${below.join(", ")}.`;
    }

    case "beds_available": {
      const [{ data: beds }, { data: activeAllocations }] = await Promise.all([
        supabase.from("beds").select("id, status"),
        supabase.from("hostel_allocations").select("bed_id").eq("status", "active").not("bed_id", "is", null),
      ]);
      const occupiedBedIds = new Set((activeAllocations ?? []).map((a) => a.bed_id));
      const total = (beds ?? []).length;
      const available = (beds ?? []).filter((b) => b.status === "available" && !occupiedBedIds.has(b.id)).length;
      if (total === 0) return "No beds have been set up in Boarding yet.";
      return `${available} of ${total} boarding beds are currently available.`;
    }

    case "dormitory_at_capacity": {
      const [{ data: dormitories }, { data: rooms }, { data: activeAllocations }] = await Promise.all([
        supabase.from("dormitories").select("id, name, capacity"),
        supabase.from("hostel_rooms").select("id, dormitory_id"),
        supabase.from("hostel_allocations").select("hostel_room_id").eq("status", "active"),
      ]);
      if (!dormitories || dormitories.length === 0) return "No dormitories have been set up in Boarding yet.";
      const roomToDorm = new Map((rooms ?? []).map((r) => [r.id, r.dormitory_id]));
      const occupiedByDorm = new Map<string, number>();
      for (const a of activeAllocations ?? []) {
        const dormId = roomToDorm.get(a.hostel_room_id);
        if (!dormId) continue;
        occupiedByDorm.set(dormId, (occupiedByDorm.get(dormId) ?? 0) + 1);
      }
      const atCapacity = dormitories
        .filter((d) => d.capacity != null && (occupiedByDorm.get(d.id) ?? 0) >= d.capacity)
        .map((d) => `${d.name} (${occupiedByDorm.get(d.id) ?? 0}/${d.capacity})`);
      if (atCapacity.length === 0) return "No dormitory is currently at or over capacity.";
      return `At or over capacity: ${atCapacity.join(", ")}.`;
    }

    case "students_in_sick_bay": {
      const { data } = await supabase
        .from("sick_bay_visits")
        .select("reason, students(first_name, last_name)")
        .is("check_out_at", null)
        .order("check_in_at", { ascending: true });
      if (!data || data.length === 0) return "No students are currently in sick bay.";
      const list = data.map((v) => {
        const s = v.students as unknown as { first_name: string; last_name: string } | null;
        return `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim() + (v.reason ? ` (${v.reason})` : "");
      });
      return `${data.length} student(s) currently in sick bay: ${list.join(", ")}.`;
    }

    case "low_stock_inventory": {
      const { data } = await supabase
        .from("inventory_items")
        .select("name, quantity, reorder_level, unit")
        .not("reorder_level", "is", null);
      const low = (data ?? []).filter((i) => i.reorder_level !== null && i.quantity <= i.reorder_level);
      if (low.length === 0) return "No inventory items are currently at or below their reorder level.";
      const list = low.map((i) => `${i.name} (${i.quantity} ${i.unit} left, reorder at ${i.reorder_level})`).join(", ");
      return `${low.length} item(s) low in stock: ${list}.`;
    }

    case "daily_summary": {
      const parts: string[] = [];
      const [
        { data: canStudents },
        { data: canAttendance },
        { data: canFinance },
        { data: canHostel },
        { data: canHealth },
        { data: canInventory },
      ] = await Promise.all([
        supabase.rpc("auth_has_permission", { p_permission_key: "students.read" }),
        supabase.rpc("auth_has_permission", { p_permission_key: "attendance.read" }),
        supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
        supabase.rpc("auth_has_permission", { p_permission_key: "hostel.read_any" }),
        supabase.rpc("auth_has_permission", { p_permission_key: "health.read_any" }),
        supabase.rpc("auth_has_permission", { p_permission_key: "inventory.read_any" }),
      ]);

      if (canStudents) {
        const { count } = await supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active");
        parts.push(`${count ?? 0} students enrolled`);
      }
      if (canAttendance) {
        const today = todayISO();
        const { data } = await supabase
          .from("student_attendance")
          .select("status")
          .eq("attendance_date", today)
          .eq("session", "class");
        const total = data?.length ?? 0;
        const present = (data ?? []).filter((r) => r.status === "present").length;
        parts.push(total > 0 ? `attendance today ${Math.round((100 * present) / total)}%` : "attendance not yet marked today");
      }
      if (canFinance) {
        const { data } = await supabase.from("v_student_balances").select("balance");
        const total = (data ?? []).reduce((sum, r) => sum + Math.max(0, Number(r.balance)), 0);
        parts.push(`KES ${total.toLocaleString()} outstanding in fees`);
      }
      if (canHostel) {
        const [{ data: beds }, { data: activeAllocations }] = await Promise.all([
          supabase.from("beds").select("id, status"),
          supabase.from("hostel_allocations").select("bed_id").eq("status", "active").not("bed_id", "is", null),
        ]);
        const occupiedBedIds = new Set((activeAllocations ?? []).map((a) => a.bed_id));
        const available = (beds ?? []).filter((b) => b.status === "available" && !occupiedBedIds.has(b.id)).length;
        if ((beds ?? []).length > 0) parts.push(`${available} boarding beds available`);
      }
      if (canHealth) {
        const { count } = await supabase
          .from("sick_bay_visits")
          .select("id", { count: "exact", head: true })
          .is("check_out_at", null);
        parts.push(`${count ?? 0} student(s) in sick bay`);
      }
      if (canInventory) {
        const { data } = await supabase.from("inventory_items").select("quantity, reorder_level").not("reorder_level", "is", null);
        const lowCount = (data ?? []).filter((i) => i.reorder_level !== null && i.quantity <= i.reorder_level).length;
        parts.push(`${lowCount} inventory item(s) low in stock`);
      }

      if (parts.length === 0) return "You don't have access to any of the summary data yet.";
      return `Today's summary — ${parts.join("; ")}.`;
    }
  }
}
