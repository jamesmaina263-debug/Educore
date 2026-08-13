"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

// ---------------------------------------------------------------------------
// Grading scales
// ---------------------------------------------------------------------------

export async function createGradingScale(input: {
  name: string;
  model_type: "numeric" | "cbc";
  is_default: boolean;
  bands: { label: string; min_score?: number; max_score?: number; points?: number; level_order: number }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { data: scale, error } = await supabase
      .from("grading_scales")
      .insert({ school_id, name: input.name, model_type: input.model_type, is_default: input.is_default })
      .select("id")
      .single();
    if (error) return { error: error.message };

    const { error: bandsError } = await supabase.from("grading_scale_bands").insert(
      input.bands.map((b) => ({
        grading_scale_id: scale.id,
        label: b.label,
        min_score: input.model_type === "numeric" ? b.min_score : null,
        max_score: input.model_type === "numeric" ? b.max_score : null,
        points: input.model_type === "numeric" ? b.points : null,
        level_order: b.level_order,
      })),
    );
    if (bandsError) return { error: bandsError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the grading scale." };
  }
  revalidatePath("/exams");
  return { success: true };
}

export async function setClassGradingScale(classId: string, gradingScaleId: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("classes").update({ grading_scale_id: gradingScaleId }).eq("id", classId);
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Exam lifecycle
// ---------------------------------------------------------------------------

export async function createExam(input: {
  term_id: string;
  name: string;
  exam_type: "cat" | "exam" | "mock" | "other";
  class_ids: string[];
  // subjects to examine, per class: { class_id, subject_id, max_score }
  subjects: { class_id: string; subject_id: string; max_score: number }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { data: exam, error } = await supabase
      .from("exams")
      .insert({ school_id, term_id: input.term_id, name: input.name, exam_type: input.exam_type })
      .select("id")
      .single();
    if (error) return { error: error.message };

    const { error: classesError } = await supabase
      .from("exam_classes")
      .insert(input.class_ids.map((class_id) => ({ exam_id: exam.id, class_id })));
    if (classesError) return { error: classesError.message };

    const { error: subjectsError } = await supabase.from("exam_subjects").insert(
      input.subjects.map((s) => ({
        exam_id: exam.id,
        class_id: s.class_id,
        subject_id: s.subject_id,
        max_score: s.max_score,
      })),
    );
    if (subjectsError) return { error: subjectsError.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the exam." };
  }
  revalidatePath("/exams");
  return { success: true };
}

export async function closeExam(examId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_exam", { p_exam_id: examId });
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

export async function reopenExam(examId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_exam", { p_exam_id: examId });
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Marks entry
// ---------------------------------------------------------------------------

export type MarkInput = { student_id: string; raw_score?: number; band_id?: string };

// ---------------------------------------------------------------------------
// CBC curriculum strands / sub-strands + sub-strand-level competency marks
// ---------------------------------------------------------------------------

export async function createCurriculumStrand(input: {
  subject_id: string;
  name: string;
  level_order?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const school_id = await schoolId(supabase);
  const { error } = await supabase.from("curriculum_strands").insert({
    school_id,
    subject_id: input.subject_id,
    name: input.name,
    level_order: input.level_order ?? 0,
  });
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function createCurriculumSubStrand(input: {
  strand_id: string;
  name: string;
  level_order?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("curriculum_sub_strands").insert({
    strand_id: input.strand_id,
    name: input.name,
    level_order: input.level_order ?? 0,
  });
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function submitCompetencyMarks(input: {
  exam_id: string;
  class_id: string;
  ratings: { student_id: string; sub_strand_id: string; band_id: string }[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user?.id ?? "")
      .maybeSingle();

    const rows = input.ratings.map((r) => ({
      school_id,
      exam_id: input.exam_id,
      class_id: input.class_id,
      student_id: r.student_id,
      sub_strand_id: r.sub_strand_id,
      band_id: r.band_id,
      entered_by: schoolUser?.id ?? null,
    }));
    if (rows.length === 0) return { success: true };

    const { error } = await supabase
      .from("competency_marks")
      .upsert(rows, { onConflict: "exam_id,student_id,sub_strand_id" });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save competency marks." };
  }
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function editCompetencyMark(input: {
  exam_id: string;
  student_id: string;
  sub_strand_id: string;
  band_id: string;
  edit_reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("competency_marks")
    .update({ band_id: input.band_id, edit_reason: input.edit_reason })
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id)
    .eq("sub_strand_id", input.sub_strand_id);
  if (error) return { error: error.message };
  revalidatePath("/exams/marks");
  return { success: true };
}

export async function submitMarks(input: {
  exam_id: string;
  class_id: string;
  subject_id: string;
  marks: MarkInput[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("id")
      .eq("auth_user_id", user?.id ?? "")
      .maybeSingle();

    const rows = input.marks
      .filter((m) => m.raw_score !== undefined || m.band_id !== undefined)
      .map((m) => ({
        school_id,
        exam_id: input.exam_id,
        class_id: input.class_id,
        subject_id: input.subject_id,
        student_id: m.student_id,
        raw_score: m.raw_score ?? null,
        band_id: m.band_id ?? null,
        entered_by: schoolUser?.id ?? null,
      }));

    if (rows.length === 0) return { success: true };

    // upsert on the exam/student/subject unique key so re-submitting the same roster edits in place
    const { error } = await supabase
      .from("marks")
      .upsert(rows, { onConflict: "exam_id,student_id,subject_id" });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save marks." };
  }
  revalidatePath("/exams");
  return { success: true };
}

export async function editMark(input: {
  exam_id: string;
  student_id: string;
  subject_id: string;
  raw_score?: number;
  band_id?: string;
  edit_reason: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { edit_reason: input.edit_reason };
  if (input.raw_score !== undefined) update.raw_score = input.raw_score;
  if (input.band_id !== undefined) update.band_id = input.band_id;

  const { error } = await supabase
    .from("marks")
    .update(update)
    .eq("exam_id", input.exam_id)
    .eq("student_id", input.student_id)
    .eq("subject_id", input.subject_id);
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Exam timetable
// ---------------------------------------------------------------------------
export async function saveExamSchedule(input: {
  exam_id: string;
  subject_id: string;
  class_id: string;
  exam_date: string;
  start_time?: string;
  end_time?: string;
  venue?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("exam_schedules").insert({
      school_id,
      exam_id: input.exam_id,
      subject_id: input.subject_id,
      class_id: input.class_id,
      exam_date: input.exam_date,
      start_time: input.start_time || null,
      end_time: input.end_time || null,
      venue: input.venue || null,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the exam schedule." };
  }
  revalidatePath("/exams");
  return { success: true };
}

export async function deleteExamSchedule(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_schedules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Marks approval -- bulk-approves every submitted mark for a class+subject in
// one exam. RLS (marks.approve for the class teacher's own class, or
// marks.approve_any) is the real gate; this is a convenience bulk update.
// ---------------------------------------------------------------------------
export async function approveMarks(input: { exam_id: string; class_id: string; subject_id: string }): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: schoolUser } = await supabase.from("school_users").select("id").eq("auth_user_id", user?.id ?? "").maybeSingle();

  const { error } = await supabase
    .from("marks")
    .update({ status: "approved", approved_by: schoolUser?.id ?? null, approved_at: new Date().toISOString() })
    .eq("exam_id", input.exam_id)
    .eq("class_id", input.class_id)
    .eq("subject_id", input.subject_id)
    .eq("status", "submitted");
  if (error) return { error: error.message };
  revalidatePath("/exams");
  return { success: true };
}
