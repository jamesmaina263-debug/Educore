"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
  | "predicted_at_risk_students"
  | "exam_average"
  | "classes_below_average"
  | "beds_available"
  | "dormitory_at_capacity"
  | "students_in_sick_bay"
  | "low_stock_inventory"
  | "daily_summary"
  | "admissions_today"
  | "admissions_this_month"
  | "students_admitted_this_term"
  | "top_fee_defaulters"
  | "attendance_trend_this_week"
  | "staff_on_leave_today"
  | "overdue_library_books"
  | "transport_route_capacity"
  | "students_without_primary_guardian"
  | "open_discipline_cases"
  | "upcoming_pt_meetings"
  | "assignments_due_this_week"
  | "pending_asset_maintenance"
  | "certificates_this_term"
  | "ungraded_submissions"
  | "exam_subject_breakdown"
  | "staff_headcount_by_role"
  | "competency_band_breakdown"
  | "students_needing_competency_support";

// A daily_summary answer is assembled from whichever of these sections the caller is permitted
// to see — it has no single gating permission of its own.
type PermissionKey =
  | "students.read"
  | "attendance.read"
  | "finance.read"
  | "exams.read"
  | "hostel.read_any"
  | "health.read_any"
  | "inventory.read_any"
  | "staff.read"
  | "library.read_any"
  | "transport.read_any"
  | "discipline.read_any"
  | "academics.read";

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
  {
    key: "predicted_at_risk_students",
    description:
      "A model-based risk ranking of students, using a weighted score (attendance trend, exam trend, payment lateness, discipline cases) rather than a simple rule count",
    permission: "students.read",
  },
  { key: "exam_average", description: "The school-wide average exam score for the most recent closed exam this term", permission: "exams.read" },
  { key: "classes_below_average", description: "Which classes/streams are performing below the school average in the most recent exam", permission: "exams.read" },
  { key: "beds_available", description: "How many boarding beds are currently available", permission: "hostel.read_any" },
  { key: "dormitory_at_capacity", description: "Which boarding dormitory is at or over capacity", permission: "hostel.read_any" },
  { key: "students_in_sick_bay", description: "Which students are currently checked into sick bay", permission: "health.read_any" },
  { key: "low_stock_inventory", description: "Which inventory items are low in stock (at or below their reorder level)", permission: "inventory.read_any" },
  { key: "daily_summary", description: "Give me a summary of the school today (a general end-of-day/status overview)", permission: null },
  {
    key: "admissions_today",
    description: "How many students were admitted today, with their names and admission numbers",
    permission: "students.read",
  },
  {
    key: "admissions_this_month",
    description: "How many students were admitted this calendar month, with their names and admission numbers",
    permission: "students.read",
  },
  {
    key: "students_admitted_this_term",
    description: "How many students were admitted during the current active term, with their names and admission numbers",
    permission: "students.read",
  },
  {
    key: "top_fee_defaulters",
    description: "Which students have the largest outstanding fee balances",
    permission: "finance.read",
  },
  {
    key: "attendance_trend_this_week",
    description: "How the daily attendance rate has trended so far this week",
    permission: "attendance.read",
  },
  { key: "staff_on_leave_today", description: "Which staff members are on approved leave today", permission: "staff.read" },
  { key: "overdue_library_books", description: "Which library books are overdue and who is holding them", permission: "library.read_any" },
  {
    key: "transport_route_capacity",
    description: "Which transport routes are near or at full capacity",
    permission: "transport.read_any",
  },
  {
    key: "students_without_primary_guardian",
    description: "Which students are missing a primary-contact guardian on file",
    permission: "students.read",
  },
  {
    key: "open_discipline_cases",
    description: "How many discipline cases are currently open, and their titles",
    permission: "discipline.read_any",
  },
  { key: "upcoming_pt_meetings", description: "What parent-teacher meeting slots are coming up", permission: null },
  {
    key: "assignments_due_this_week",
    description: "Which homework/assignments are due this week, and for which subject/class",
    permission: "academics.read",
  },
  {
    key: "pending_asset_maintenance",
    description: "Which assets currently have a maintenance request pending or in progress",
    permission: "inventory.read_any",
  },
  {
    key: "certificates_this_term",
    description: "Which students have been issued a certificate this term, and what kind",
    permission: "students.read",
  },
  {
    key: "ungraded_submissions",
    description: "How many homework/assignment submissions are still waiting to be graded",
    permission: "academics.read",
  },
  {
    key: "exam_subject_breakdown",
    description: "What is the average score per subject for the most recent closed exam",
    permission: "exams.read",
  },
  { key: "staff_headcount_by_role", description: "How many active staff members are in each role", permission: "staff.read" },
  {
    key: "competency_band_breakdown",
    description:
      "For the most recent closed CBC exam, how many sub-strand competency ratings fall into each competency level/band (e.g. how many are Below Expectation vs Meeting Expectation)",
    permission: "exams.read",
  },
  {
    key: "students_needing_competency_support",
    description:
      "Which students have the most sub-strand competency ratings of 'Below Expectation' for the most recent closed CBC exam, i.e. who may need intervention support",
    permission: "exams.read",
  },
];

export interface AskAIResult {
  answer?: string;
  error?: string;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function weekStartISO() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday))
    .toISOString()
    .slice(0, 10);
}

async function classifyIntent(question: string): Promise<Intent | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a strict classifier. Given a school administrator's question, respond with ONLY a JSON object of the form {"intent": "<key>"} where <key> is exactly one of the following, or "unrecognized" if none fit:

${INTENTS.map((i) => `- ${i.key}: ${i.description}`).join("\n")}

Question: "${question.replace(/"/g, "'")}"

Respond with ONLY the JSON object, nothing else.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 40 },
      }),
    },
  );
  if (!res.ok) {
    console.error("Educore AI classifyIntent: Gemini API returned", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("Educore AI classifyIntent: no text in Gemini response", JSON.stringify(data));
    return null;
  }
  try {
    const match = text.match(/\{[^}]*\}/);
    const parsed = JSON.parse(match ? match[0] : text);
    const candidate = parsed?.intent as string | undefined;
    if (candidate && INTENTS.some((i) => i.key === candidate)) return candidate as Intent;
    return null;
  } catch (e) {
    console.error("Educore AI classifyIntent: failed to parse Gemini response", text, e);
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
  "staff.read": "staff",
  "library.read_any": "library",
  "transport.read_any": "transport",
  "discipline.read_any": "discipline",
  "academics.read": "academics",
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

  // SECURITY: ai.read gates *access* to this endpoint but did nothing to cap
  // *volume* -- any user with the permission could send unlimited questions,
  // each one a real, billed Gemini call via classifyIntent() below. Same
  // primitive as login/signup/contact/communication/report-card-comment
  // drafting; found and fixed alongside draftCommentWithAI in the same
  // audit pass (see PR #228).
  try {
    const adminClient = createAdminClient();
    const { data: withinLimit } = await adminClient.rpc("increment_and_check_rate_limit", {
      p_bucket: `ai-assistant:${user.id}`,
      p_max_events: 60,
      p_window_seconds: 3600,
    });
    if (withinLimit === false) {
      return { error: "Too many Educore AI questions. Please wait a while and try again." };
    }
  } catch {
    // Don't let a missing/misconfigured admin client block a legitimate,
    // permission-checked question over a missing rate-limit layer.
  }

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

    case "predicted_at_risk_students": {
      const { data } = await supabase
        .from("v_predicted_at_risk_students")
        .select("first_name, last_name, risk_score, risk_band")
        .limit(5);
      if (!data || data.length === 0) return "No students currently score medium or high risk on the weighted model.";
      const list = data
        .map((s) => `${s.first_name} ${s.last_name} (${s.risk_band}, score ${s.risk_score})`)
        .join(", ");
      // Deliberately worded differently from at_risk_count's answer: this is a hand-weighted
      // model score, not a plain rule count, and the wording should not blur that distinction —
      // same "never dressed up as more sophisticated than it is" rule as the fee forecast.
      return `${data.length} student(s) flagged medium/high risk by the weighted model, highest first: ${list}. (Hand-weighted score, not a trained model — see risk_model_versions.)`;
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

    case "admissions_today": {
      const today = todayISO();
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, admission_number")
        .eq("admission_date", today)
        .order("created_at", { ascending: true });
      if (!students || students.length === 0) return "No students were admitted today.";

      // Gated on students.read alone (see INTENTS above), matching this intent's real minimum
      // access requirement. finance.read is a second, narrower permission not every students.read
      // holder has (e.g. class_teacher) — rather than refusing the whole answer or silently
      // fabricating a number, this degrades the same way daily_summary assembles itself from
      // whichever sections the caller can see: names/admission numbers always show, amount paid
      // only joins in if the caller separately holds finance.read.
      const { data: canFinance } = await supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" });

      const paidByStudent = new Map<string, number>();
      if (canFinance) {
        const { data: payments } = await supabase
          .from("payments")
          .select("student_id, amount")
          .in("student_id", students.map((s) => s.id));
        for (const p of payments ?? []) {
          paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + Number(p.amount));
        }
      }

      const list = students
        .map((s) => {
          const base = `${s.first_name} ${s.last_name} (${s.admission_number})`;
          if (!canFinance) return base;
          const paid = paidByStudent.get(s.id) ?? 0;
          return `${base} — KES ${paid.toLocaleString()} paid`;
        })
        .join(", ");
      return `${students.length} student(s) admitted today: ${list}.`;
    }

    case "admissions_this_month": {
      const monthStart = monthStartISO();
      const today = todayISO();
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, admission_number")
        .gte("admission_date", monthStart)
        .lte("admission_date", today)
        .order("admission_date", { ascending: true });
      if (!students || students.length === 0) return "No students have been admitted this month yet.";

      // Same students.read / finance.read graceful-degradation as admissions_today.
      const { data: canFinance } = await supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" });

      // A month can hold far more admissions than a single day — cap the named list so the
      // answer stays readable, same reasoning as low_attendance_students' existing .limit(10).
      const DISPLAY_CAP = 15;
      const shown = students.slice(0, DISPLAY_CAP);

      const paidByStudent = new Map<string, number>();
      if (canFinance) {
        const { data: payments } = await supabase
          .from("payments")
          .select("student_id, amount")
          .in("student_id", shown.map((s) => s.id));
        for (const p of payments ?? []) {
          paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + Number(p.amount));
        }
      }

      const list = shown
        .map((s) => {
          const base = `${s.first_name} ${s.last_name} (${s.admission_number})`;
          if (!canFinance) return base;
          const paid = paidByStudent.get(s.id) ?? 0;
          return `${base} — KES ${paid.toLocaleString()} paid`;
        })
        .join(", ");
      const remainder = students.length - shown.length;
      const suffix = remainder > 0 ? `, and ${remainder} more` : "";
      return `${students.length} student(s) admitted this month: ${list}${suffix}.`;
    }

    case "students_admitted_this_term": {
      // terms is RLS-gated on academics.read, a permission not every students.read holder is
      // guaranteed to have (they happen to overlap in current seed data, but that's not a
      // constraint) — checked explicitly so a caller missing it gets an honest refusal instead of
      // a silently-empty/wrong "no active term" result. Same anti-pattern Module 19 already fixed
      // for v_fee_collection_forecast/v_at_risk_students: a confident empty result is worse than
      // a stated "you don't have access."
      const { data: canAcademics } = await supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" });
      if (!canAcademics) {
        return "I can't determine the current term without access to academics data, so I can't answer that.";
      }

      const { data: term } = await supabase
        .from("terms")
        .select("name, start_date")
        .eq("status", "active")
        .maybeSingle();
      if (!term) return "No term is currently marked active.";

      const today = todayISO();
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, admission_number")
        .gte("admission_date", term.start_date)
        .lte("admission_date", today)
        .order("admission_date", { ascending: true });
      if (!students || students.length === 0) return `No students have been admitted yet during ${term.name}.`;

      const { data: canFinance } = await supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" });
      const DISPLAY_CAP = 15;
      const shown = students.slice(0, DISPLAY_CAP);
      const paidByStudent = new Map<string, number>();
      if (canFinance) {
        const { data: payments } = await supabase
          .from("payments")
          .select("student_id, amount")
          .in("student_id", shown.map((s) => s.id));
        for (const p of payments ?? []) {
          paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + Number(p.amount));
        }
      }
      const list = shown
        .map((s) => {
          const base = `${s.first_name} ${s.last_name} (${s.admission_number})`;
          if (!canFinance) return base;
          const paid = paidByStudent.get(s.id) ?? 0;
          return `${base} — KES ${paid.toLocaleString()} paid`;
        })
        .join(", ");
      const remainder = students.length - shown.length;
      const suffix = remainder > 0 ? `, and ${remainder} more` : "";
      return `${students.length} student(s) admitted during ${term.name}: ${list}${suffix}.`;
    }

    case "top_fee_defaulters": {
      const { data: balances } = await supabase
        .from("v_student_balances")
        .select("student_id, balance")
        .gt("balance", 0)
        .order("balance", { ascending: false })
        .limit(5);
      if (!balances || balances.length === 0) return "No students currently have an outstanding fee balance.";

      // v_student_balances has no name columns (confirmed against every other caller in the app —
      // finance/_data.ts, students/[id]/page.tsx, dashboard/page.tsx, portal/page.tsx — none embed
      // a students() join on it either, so this two-query join is the app's own established
      // pattern, not something invented here).
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, admission_number")
        .in("id", balances.map((b) => b.student_id));
      const studentById = new Map((students ?? []).map((s) => [s.id, s]));

      const list = balances
        .map((b) => {
          const s = studentById.get(b.student_id);
          const name = s ? `${s.first_name} ${s.last_name} (${s.admission_number})` : "a student you don't have access to";
          return `${name} — KES ${Number(b.balance).toLocaleString()}`;
        })
        .join(", ");
      return `Largest outstanding balances: ${list}.`;
    }

    case "attendance_trend_this_week": {
      const weekStart = weekStartISO();
      const today = todayISO();
      const { data } = await supabase
        .from("student_attendance")
        .select("attendance_date, status")
        .eq("session", "class")
        .gte("attendance_date", weekStart)
        .lte("attendance_date", today);
      if (!data || data.length === 0) return "No attendance has been marked yet this week.";

      const byDate = new Map<string, { present: number; total: number }>();
      for (const r of data) {
        const entry = byDate.get(r.attendance_date) ?? { present: 0, total: 0 };
        entry.total += 1;
        if (r.status === "present") entry.present += 1;
        byDate.set(r.attendance_date, entry);
      }
      const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const parts = Array.from(byDate.keys())
        .sort()
        .map((d) => {
          const { present, total } = byDate.get(d)!;
          const rate = total > 0 ? Math.round((100 * present) / total) : 0;
          const label = dayLabels[new Date(`${d}T00:00:00Z`).getUTCDay()];
          return `${label} ${rate}%`;
        });
      return `Attendance this week so far: ${parts.join(", ")}.`;
    }

    case "staff_on_leave_today": {
      const today = todayISO();
      const { data } = await supabase
        .from("leave_requests")
        .select("staff_id, school_users(full_name), leave_types(name)")
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today);
      if (!data || data.length === 0) return "No staff members are on approved leave today.";
      const list = data
        .map((r) => {
          const staff = r.school_users as unknown as { full_name: string } | null;
          const leaveType = r.leave_types as unknown as { name: string } | null;
          const name = staff?.full_name ?? "Unknown staff member";
          return leaveType?.name ? `${name} (${leaveType.name})` : name;
        })
        .join(", ");
      return `${data.length} staff member(s) on approved leave today: ${list}.`;
    }

    case "overdue_library_books": {
      const today = todayISO();
      const { data } = await supabase
        .from("library_loans")
        .select("due_date, library_items(title), students(first_name, last_name)")
        .eq("status", "borrowed")
        .lt("due_date", today)
        .order("due_date", { ascending: true })
        .limit(10);
      if (!data || data.length === 0) return "No library books are currently overdue.";
      const list = data
        .map((r) => {
          const item = r.library_items as unknown as { title: string } | null;
          const s = r.students as unknown as { first_name: string; last_name: string } | null;
          const title = item?.title ?? "Unknown title";
          const holder = s ? `${s.first_name} ${s.last_name}` : "Unknown borrower";
          return `${title} (held by ${holder}, due ${r.due_date})`;
        })
        .join(", ");
      return `${data.length} overdue book(s): ${list}.`;
    }

    case "transport_route_capacity": {
      const { data } = await supabase
        .from("v_transport_route_capacity")
        .select("route_name, capacity, allocated, available")
        .order("allocated", { ascending: false });
      if (!data || data.length === 0) return "No transport routes have been set up yet.";
      const list = data.map((r) => `${r.route_name} (${r.allocated}/${r.capacity})`).join(", ");
      const atCapacity = data.filter((r) => r.capacity > 0 && r.available <= 0);
      if (atCapacity.length === 0) return `No route is at or over capacity. Current usage: ${list}.`;
      const atCapNames = atCapacity.map((r) => r.route_name).join(", ");
      return `${atCapacity.length} route(s) at or over capacity: ${atCapNames}. Current usage: ${list}.`;
    }

    case "students_without_primary_guardian": {
      // Relevant to applied/active students specifically — this is the exact gap
      // enforce_student_has_primary_guardian() blocks at activation time, so it's a
      // find-it-before-it-bites-you check, not a general audit of every historical student.
      const { data: students } = await supabase
        .from("students")
        .select("id, first_name, last_name, admission_number")
        .in("status", ["applied", "active"]);
      if (!students || students.length === 0) return "No applied or active students found.";

      const { data: guardianLinks } = await supabase
        .from("student_guardians")
        .select("student_id")
        .eq("primary_contact", true)
        .in("student_id", students.map((s) => s.id));
      const hasPrimary = new Set((guardianLinks ?? []).map((g) => g.student_id));

      const missing = students.filter((s) => !hasPrimary.has(s.id));
      if (missing.length === 0) return "Every applied or active student has a primary-contact guardian on file.";

      const DISPLAY_CAP = 15;
      const shown = missing.slice(0, DISPLAY_CAP);
      const list = shown.map((s) => `${s.first_name} ${s.last_name} (${s.admission_number})`).join(", ");
      const remainder = missing.length - shown.length;
      const suffix = remainder > 0 ? `, and ${remainder} more` : "";
      return `${missing.length} student(s) missing a primary-contact guardian: ${list}${suffix}.`;
    }

    case "open_discipline_cases": {
      // Titles only, never investigation_notes/follow_up_notes/resolution — those are
      // sensitive case detail, not summary-level data an AI answer should surface.
      const { data } = await supabase
        .from("discipline_cases")
        .select("title, status")
        .in("status", ["open", "investigating", "pending_action"])
        .order("opened_at", { ascending: true })
        .limit(10);
      if (!data || data.length === 0) return "No discipline cases are currently open.";
      const list = data.map((c) => `${c.title} (${c.status})`).join(", ");
      return `${data.length} open discipline case(s): ${list}.`;
    }

    case "upcoming_pt_meetings": {
      const today = todayISO();
      const { data: slots } = await supabase
        .from("pt_meeting_slots")
        .select("id, slot_date, start_time, capacity, school_users(full_name)")
        .gte("slot_date", today)
        .order("slot_date", { ascending: true })
        .limit(10);
      if (!slots || slots.length === 0) return "No upcoming parent-teacher meeting slots are scheduled.";

      const { data: bookings } = await supabase
        .from("pt_meeting_bookings")
        .select("slot_id")
        .eq("status", "booked")
        .in("slot_id", slots.map((s) => s.id));
      const bookedCount = new Map<string, number>();
      for (const b of bookings ?? []) {
        bookedCount.set(b.slot_id, (bookedCount.get(b.slot_id) ?? 0) + 1);
      }

      const list = slots
        .map((s) => {
          const teacher = s.school_users as unknown as { full_name: string } | null;
          const booked = bookedCount.get(s.id) ?? 0;
          const teacherName = teacher?.full_name ?? "an unassigned teacher";
          return `${s.slot_date} ${s.start_time} with ${teacherName} (${booked}/${s.capacity} booked)`;
        })
        .join(", ");
      return `${slots.length} upcoming slot(s): ${list}.`;
    }

    case "assignments_due_this_week": {
      const today = todayISO();
      const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("assignments")
        .select("title, due_date, subjects(name), streams(name)")
        .gte("due_date", today)
        .lte("due_date", weekEnd)
        .order("due_date", { ascending: true })
        .limit(10);
      if (!data || data.length === 0) return "No assignments are due in the next 7 days.";
      const list = data
        .map((a) => {
          const subject = a.subjects as unknown as { name: string } | null;
          const stream = a.streams as unknown as { name: string } | null;
          const context = [subject?.name, stream?.name].filter(Boolean).join(" — ");
          return context ? `${a.title} (${context}, due ${a.due_date})` : `${a.title} (due ${a.due_date})`;
        })
        .join(", ");
      return `${data.length} assignment(s) due in the next 7 days: ${list}.`;
    }

    case "pending_asset_maintenance": {
      const { data } = await supabase
        .from("asset_maintenance_records")
        .select("description, status, assets(name)")
        .in("status", ["requested", "in_progress"])
        .order("request_date", { ascending: true })
        .limit(10);
      if (!data || data.length === 0) return "No assets currently have a pending maintenance request.";
      const list = data
        .map((r) => {
          const asset = r.assets as unknown as { name: string } | null;
          return `${asset?.name ?? "Unknown asset"} — ${r.description} (${r.status})`;
        })
        .join(", ");
      return `${data.length} asset(s) with pending maintenance: ${list}.`;
    }

    case "certificates_this_term": {
      // terms is RLS-gated on academics.read, same dependency as students_admitted_this_term —
      // checked explicitly rather than assumed, same reasoning as that intent's comment.
      const { data: canAcademics } = await supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" });
      if (!canAcademics) {
        return "I can't determine the current term without access to academics data, so I can't answer that.";
      }
      const { data: term } = await supabase.from("terms").select("name, start_date").eq("status", "active").maybeSingle();
      if (!term) return "No term is currently marked active.";

      const today = todayISO();
      const { data } = await supabase
        .from("certificates")
        .select("certificate_type, title, students(first_name, last_name)")
        .gte("issued_date", term.start_date)
        .lte("issued_date", today)
        .order("issued_date", { ascending: false })
        .limit(10);
      if (!data || data.length === 0) return `No certificates have been issued yet during ${term.name}.`;
      const list = data
        .map((c) => {
          const s = c.students as unknown as { first_name: string; last_name: string } | null;
          const name = s ? `${s.first_name} ${s.last_name}` : "Unknown student";
          return `${name} — ${c.title} (${c.certificate_type})`;
        })
        .join(", ");
      return `${data.length} certificate(s) issued during ${term.name}: ${list}.`;
    }

    case "ungraded_submissions": {
      const { count } = await supabase
        .from("assignment_submissions")
        .select("id", { count: "exact", head: true })
        .eq("status", "submitted");
      if (!count || count === 0) return "No submissions are currently waiting to be graded.";
      return `${count} submission(s) are waiting to be graded.`;
    }

    case "exam_subject_breakdown": {
      const { data: exam } = await supabase
        .from("exams")
        .select("id, name")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!exam) return "No closed exam was found for the current term.";

      // Numeric raw_score only — a class on the CBC (band-based) grading model has null
      // raw_score by design (see marks table comment), same scope limitation exam_average
      // already has, not something new introduced here.
      const { data: marks } = await supabase
        .from("marks")
        .select("subject_id, raw_score, subjects(name)")
        .eq("exam_id", exam.id)
        .not("raw_score", "is", null);
      if (!marks || marks.length === 0) return `${exam.name}: no numeric marks have been recorded yet.`;

      const bySubject = new Map<string, { name: string; sum: number; count: number }>();
      for (const m of marks) {
        const subject = m.subjects as unknown as { name: string } | null;
        const entry = bySubject.get(m.subject_id) ?? { name: subject?.name ?? "Unknown subject", sum: 0, count: 0 };
        entry.sum += Number(m.raw_score);
        entry.count += 1;
        bySubject.set(m.subject_id, entry);
      }
      const list = Array.from(bySubject.values())
        .map((s) => `${s.name} ${(s.sum / s.count).toFixed(1)}`)
        .join(", ");
      return `${exam.name} average score by subject: ${list}.`;
    }

    case "staff_headcount_by_role": {
      // Same exclusion list as the real Staff list page (src/app/(app)/staff/page.tsx) — reused
      // exactly rather than re-derived, so this can't silently drift into counting parent/student/
      // super_admin accounts as "staff."
      const { data } = await supabase
        .from("school_users")
        .select("id, roles!inner(display_name, name)")
        .eq("status", "active")
        .not("roles.name", "in", "(parent,student,super_admin)");
      if (!data || data.length === 0) return "No active staff members found.";

      const byRole = new Map<string, number>();
      for (const r of data) {
        const role = r.roles as unknown as { display_name: string } | null;
        const name = role?.display_name ?? "Unknown role";
        byRole.set(name, (byRole.get(name) ?? 0) + 1);
      }
      const list = Array.from(byRole.entries())
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");
      return `${data.length} active staff member(s) — ${list}.`;
    }

    case "competency_band_breakdown": {
      const { data: exam } = await supabase
        .from("exams")
        .select("id, name")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!exam) return "No closed exam was found for the current term.";

      const { data: ratings } = await supabase
        .from("competency_marks")
        .select("grading_scale_bands(label, level_order)")
        .eq("exam_id", exam.id);
      if (!ratings || ratings.length === 0) return `${exam.name}: no CBC competency ratings have been recorded yet.`;

      const byBand = new Map<string, { label: string; level_order: number; count: number }>();
      for (const r of ratings) {
        const band = r.grading_scale_bands as unknown as { label: string; level_order: number } | null;
        if (!band) continue;
        const key = band.label;
        const entry = byBand.get(key) ?? { label: band.label, level_order: band.level_order, count: 0 };
        entry.count += 1;
        byBand.set(key, entry);
      }
      const list = Array.from(byBand.values())
        .sort((a, b) => a.level_order - b.level_order)
        .map((b) => `${b.label}: ${b.count}`)
        .join(", ");
      return `${exam.name}: sub-strand competency rating breakdown — ${list}.`;
    }

    case "students_needing_competency_support": {
      const { data: exam } = await supabase
        .from("exams")
        .select("id, name")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!exam) return "No closed exam was found for the current term.";

      const { data: ratings } = await supabase
        .from("competency_marks")
        .select("student_id, students(full_name), grading_scale_bands(label)")
        .eq("exam_id", exam.id);
      if (!ratings || ratings.length === 0) return `${exam.name}: no CBC competency ratings have been recorded yet.`;

      // Deliberately NOT using level_order to find the "lowest" band: level_order is just
      // whatever order a school typed its bands into the Grading Scales form (see
      // grading-scales-section.tsx, level_order: i + 1) -- it carries no guaranteed
      // best-to-worst direction, and guessing one would silently mislabel a school that
      // entered theirs the other way round. Matching on the band label instead, against the
      // real, official KICD/KNEC competency-level term ("Below Expectation" -- verified in the
      // CBC/CBE investigation report) -- a school using that standard wording is correctly
      // detected; a school with different custom wording safely yields no flagged students
      // rather than a wrong one.
      const isBelowExpectation = (label: string) => /below\s*expectation/i.test(label);

      const lowCountByStudent = new Map<string, { name: string; count: number }>();
      for (const r of ratings) {
        const band = r.grading_scale_bands as unknown as { label: string } | null;
        const student = r.students as unknown as { full_name: string } | null;
        if (!band || !student || !isBelowExpectation(band.label)) continue;
        const entry = lowCountByStudent.get(r.student_id) ?? { name: student.full_name, count: 0 };
        entry.count += 1;
        lowCountByStudent.set(r.student_id, entry);
      }

      const flagged = Array.from(lowCountByStudent.values())
        .filter((s) => s.count >= 2)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((s) => `${s.name} (${s.count})`);
      if (flagged.length === 0) {
        return `${exam.name}: no student has 2 or more sub-strand ratings of "Below Expectation" (or no band at this school is labelled that way).`;
      }
      return `${exam.name}: students with 2+ sub-strand ratings of "Below Expectation" — ${flagged.join(", ")}.`;
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
