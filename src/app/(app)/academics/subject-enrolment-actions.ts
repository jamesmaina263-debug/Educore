"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSentryRequestContext } from "@/lib/observability/sentry-context";
import { planEnrolmentSave } from "@/lib/academics/plan-enrolment-save";

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

async function resolveClassSubject(supabase: Client, classId: string, subjectId: string): Promise<{ error: string } | { ctx: Ctx }> {
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

  const [{ data: taught }, { data: subject }] = await Promise.all([
    supabase.from("class_subjects").select("id").in("stream_id", streamIds).eq("subject_id", subjectId).limit(1),
    supabase.from("subjects").select("id, is_active").eq("id", subjectId).maybeSingle(),
  ]);
  if (!subject || subject.is_active === false) return { error: "Subject not found or inactive." };
  if (!taught || taught.length === 0) return { error: "This subject is not taught in this class." };

  return { ctx: { schoolId: schoolId as string, academicYearId: cls.academic_year_id as string, streamIds } };
}

async function clearRows(supabase: Client, classId: string, subjectId: string, academicYearId: string) {
  return supabase.from("student_subjects").delete().eq("class_id", classId).eq("subject_id", subjectId).eq("academic_year_id", academicYearId);
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

    if (plan.mode === "everyone") {
      const { error } = await clearRows(supabase, input.classId, input.subjectId, ctx.academicYearId);
      if (error) return { error: error.message };
      done();
      return { success: true, mode: "everyone" };
    }

    for (let i = 0; i < plan.rows.length; i += WRITE_CHUNK) {
      const { error } = await supabase.from("student_subjects").upsert(
        plan.rows.slice(i, i + WRITE_CHUNK).map((r) => ({
          school_id: ctx.schoolId,
          student_id: r.studentId,
          subject_id: input.subjectId,
          academic_year_id: ctx.academicYearId,
          class_id: input.classId,
          is_active: r.isActive,
        })),
        { onConflict: "student_id,subject_id,academic_year_id" },
      );
      if (error) return { error: error.message };
    }
    done();
    return { success: true, mode: "selected" };
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
