"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSentryRequestContext } from "@/lib/observability/sentry-context";
import { planEnrolmentSave, type EnrolmentSavePlan } from "@/lib/academics/plan-enrolment-save";
import { planCopyFromLastYear, type CopySubjectPlan } from "@/lib/academics/plan-copy-from-last-year";
import { loadPreviousYearEnrolmentRows } from "@/lib/academics/load-subject-enrolment";

// Staff choose which students of a class take a subject. Rules live in src/lib/academics/subject-enrolment.ts
// (read side) and plan-enrolment-save.ts (write side). Rows are never deleted to "un-enrol" someone -- that is
// an is_active = false row -- because deleting every row of a subject would silently make it universal again.
// The one deliberate delete is "everyone takes it", which is exactly that: back to universal.
//
// Permission: academics.write, checked here for a clear message and enforced again by RLS on student_subjects.

type Client = Awaited<ReturnType<typeof createClient>>;
export type EnrolmentActionResult = { error: string } | { success: true; mode: "everyone" | "selected" };

const WRITE_CHUNK = 500;

type Ctx = { schoolId: string; academicYearId: string; streamIds: string[] };

async function resolveClass(supabase: Client, classId: string): Promise<{ error: string } | { ctx: Ctx }> {
  const { data: allowed } = await supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" });
  if (!allowed) return { error: "You do not have permission to change subject enrolment." };

  const { data: schoolId, error: schoolErr } = await supabase.rpc("auth_school_id");
  if (schoolErr || !schoolId) return { error: "Could not resolve your school." };
  setSentryRequestContext({ schoolId: schoolId as string });

  const { data: cls } = await supabase.from("classes").select("id, academic_year_id").eq("id", classId).maybeSingle();
  if (!cls?.academic_year_id) return { error: "Class not found." };

  const { data: streams } = await supabase.from("streams").select("id").eq("class_id", classId);
  const streamIds = (streams ?? []).map((s) => s.id as string);
  if (streamIds.length === 0) return { error: "This class has no streams." };

  return { ctx: { schoolId: schoolId as string, academicYearId: cls.academic_year_id as string, streamIds } };
}

async function resolveClassSubject(supabase: Client, classId: string, subjectId: string): Promise<{ error: string } | { ctx: Ctx }> {
  const resolved = await resolveClass(supabase, classId);
  if ("error" in resolved) return resolved;
  const { ctx } = resolved;

  const [{ data: taught }, { data: subject }] = await Promise.all([
    supabase.from("class_subjects").select("id").in("stream_id", ctx.streamIds).eq("subject_id", subjectId).limit(1),
    supabase.from("subjects").select("id, is_active").eq("id", subjectId).maybeSingle(),
  ]);
  if (!subject || subject.is_active === false) return { error: "Subject not found or inactive." };
  if (!taught || taught.length === 0) return { error: "This subject is not taught in this class." };

  return { ctx };
}

async function clearRows(supabase: Client, classId: string, subjectId: string, academicYearId: string) {
  return supabase.from("student_subjects").delete().eq("class_id", classId).eq("subject_id", subjectId).eq("academic_year_id", academicYearId);
}

/** The one place enrolment rows are written for a class and subject; used by both "save" and "copy from last year". */
async function writePlan(
  supabase: Client,
  ctx: Ctx,
  classId: string,
  subjectId: string,
  plan: Extract<EnrolmentSavePlan, { ok: true }>,
): Promise<{ error: string } | { mode: "everyone" | "selected" }> {
  if (plan.mode === "everyone") {
    const { error } = await clearRows(supabase, classId, subjectId, ctx.academicYearId);
    return error ? { error: error.message } : { mode: "everyone" };
  }
  for (let i = 0; i < plan.rows.length; i += WRITE_CHUNK) {
    const { error } = await supabase.from("student_subjects").upsert(
      plan.rows.slice(i, i + WRITE_CHUNK).map((r) => ({
        school_id: ctx.schoolId,
        student_id: r.studentId,
        subject_id: subjectId,
        academic_year_id: ctx.academicYearId,
        class_id: classId,
        is_active: r.isActive,
      })),
      { onConflict: "student_id,subject_id,academic_year_id" },
    );
    if (error) return { error: error.message };
  }
  return { mode: "selected" };
}

function done() {
  revalidatePath("/academics", "layout");
  revalidatePath("/exams", "layout");
}

export async function saveSubjectEnrolment(input: { classId: string; subjectId: string; takingStudentIds: string[] }): Promise<EnrolmentActionResult> {
  try {
    const supabase = await createClient();
    const resolved = await resolveClassSubject(supabase, input.classId, input.subjectId);
    if ("error" in resolved) return resolved;
    const { ctx } = resolved;

    const { data: students, error: studentsErr } = await supabase
      .from("students")
      .select("id")
      .in("current_class_id", ctx.streamIds)
      .eq("status", "active");
    if (studentsErr) return { error: studentsErr.message };

    const plan = planEnrolmentSave((students ?? []).map((s) => s.id as string), input.takingStudentIds);
    if (!plan.ok) return { error: plan.error };

    const written = await writePlan(supabase, ctx, input.classId, input.subjectId, plan);
    if ("error" in written) return written;
    done();
    return { success: true, mode: written.mode };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save subject enrolment." };
  }
}

export async function makeSubjectUniversal(input: { classId: string; subjectId: string }): Promise<EnrolmentActionResult> {
  try {
    const supabase = await createClient();
    const resolved = await resolveClassSubject(supabase, input.classId, input.subjectId);
    if ("error" in resolved) return resolved;
    const { ctx } = resolved;
    const { error } = await clearRows(supabase, input.classId, input.subjectId, ctx.academicYearId);
    if (error) return { error: error.message };
    done();
    return { success: true, mode: "everyone" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update subject enrolment." };
  }
}

// ---- Copy from last year -------------------------------------------------------------------------------------
// Rules are in plan-copy-from-last-year.ts. Both actions below recompute the plan on the server, so the client
// can only ever ask for a subset of what the server itself decides is safe to copy.

export interface CopyPreviewSubject {
  subjectId: string;
  subjectName: string;
  status: CopySubjectPlan["status"];
  taking: number;
  continuing: number;
  dropped: number;
  unknown: number;
}
export type CopyPreviewResult = { error: string } | { previousYearName: string; classSize: number; subjects: CopyPreviewSubject[] };

async function computeCopyPlan(supabase: Client, classId: string) {
  const resolved = await resolveClass(supabase, classId);
  if ("error" in resolved) return resolved;
  const { ctx } = resolved;

  const { data: thisYear } = await supabase.from("academic_years").select("id, start_date").eq("id", ctx.academicYearId).maybeSingle();
  if (!thisYear?.start_date) return { error: "Could not find this class's academic year." };
  const { data: previous } = await supabase
    .from("academic_years")
    .select("id, name")
    .lt("start_date", thisYear.start_date as string)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!previous) return { error: "There is no earlier academic year to copy from." };

  const [{ data: students, error: studentsErr }, { data: taughtRows, error: taughtErr }] = await Promise.all([
    supabase.from("students").select("id").in("current_class_id", ctx.streamIds).eq("status", "active"),
    supabase.from("class_subjects").select("subject_id, subjects(id, name, is_active)").in("stream_id", ctx.streamIds),
  ]);
  if (studentsErr || taughtErr) return { error: (studentsErr ?? taughtErr)!.message };

  const subjectNames = new Map<string, string>();
  for (const row of taughtRows ?? []) {
    const raw = row.subjects as unknown as { id: string; name: string; is_active: boolean | null } | { id: string; name: string; is_active: boolean | null }[] | null;
    const sub = Array.isArray(raw) ? raw[0] : raw;
    if (sub && sub.is_active !== false) subjectNames.set(sub.id, sub.name);
  }
  const studentIds = (students ?? []).map((s) => s.id as string);
  if (studentIds.length === 0) return { error: "This class has no active students." };
  if (subjectNames.size === 0) return { error: "No subjects are assigned to this class." };

  // Which subjects staff have ALREADY set up for this class. A direct check per subject (not the fail-safe
  // loader): if it cannot be answered we stop, because guessing "not set up" could overwrite staff's choices.
  const subjectIds = [...subjectNames.keys()];
  const existing = await Promise.all(
    subjectIds.map(async (subjectId) => {
      const { data, error } = await supabase
        .from("student_subjects")
        .select("id")
        .eq("class_id", classId)
        .eq("subject_id", subjectId)
        .eq("academic_year_id", ctx.academicYearId)
        .limit(1);
      if (error) throw new Error(error.message);
      return { subjectId, selectiveNow: (data ?? []).length > 0 };
    }),
  );

  const previousRows = await loadPreviousYearEnrolmentRows(supabase, { academicYearId: previous.id as string, studentIds, subjectIds });
  const plans = planCopyFromLastYear({ studentIds, subjects: existing, previousRows });
  return { ctx, studentIds, subjectNames, plans, previousYearName: previous.name as string };
}

export async function previewCopyFromLastYear(input: { classId: string }): Promise<CopyPreviewResult> {
  try {
    const supabase = await createClient();
    const res = await computeCopyPlan(supabase, input.classId);
    if ("error" in res) return res;
    return {
      previousYearName: res.previousYearName,
      classSize: res.studentIds.length,
      subjects: res.plans
        .map((p) => ({
          subjectId: p.subjectId,
          subjectName: res.subjectNames.get(p.subjectId) ?? "",
          status: p.status,
          taking: p.takingIds.length,
          continuing: p.continuing,
          dropped: p.dropped,
          unknown: p.unknown,
        }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read last year's subject choices." };
  }
}

export async function applyCopyFromLastYear(input: { classId: string; subjectIds: string[] }): Promise<{ error: string } | { success: true; copied: number }> {
  try {
    const supabase = await createClient();
    const res = await computeCopyPlan(supabase, input.classId);
    if ("error" in res) return res;

    const wanted = new Set(input.subjectIds);
    let copied = 0;
    for (const p of res.plans) {
      if (p.status !== "copy" || !wanted.has(p.subjectId)) continue;
      const plan = planEnrolmentSave(res.studentIds, p.takingIds);
      if (!plan.ok) return { error: plan.error };
      const written = await writePlan(supabase, res.ctx, input.classId, p.subjectId, plan);
      if ("error" in written) return { error: `${res.subjectNames.get(p.subjectId) ?? "A subject"}: ${written.error}` };
      copied += 1;
    }
    done();
    return { success: true, copied };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not copy last year's subject choices." };
  }
}
