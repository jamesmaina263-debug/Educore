"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { error: string } | { success: true };

async function schoolId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase.rpc("auth_school_id");
  if (error || !data) throw new Error("Could not resolve your school.");
  return data as string;
}

export async function createAcademicYear(input: {
  name: string;
  start_date: string;
  end_date: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("academic_years").insert({ school_id, ...input });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the academic year." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function setActiveAcademicYear(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  // One active year per school: demote any current one first, then promote this one —
  // avoids a moment where two years are simultaneously "active" and tripping the
  // partial unique index the wrong way round.
  const school_id = await schoolId(supabase);
  await supabase
    .from("academic_years")
    .update({ status: "closed" })
    .eq("school_id", school_id)
    .eq("status", "active");
  const { error } = await supabase.from("academic_years").update({ status: "active" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function createTerm(input: {
  academic_year_id: string;
  name: string;
  term_number: number;
  start_date: string;
  end_date: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("terms").insert({ school_id, ...input });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the term." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function setActiveTerm(id: string, academic_year_id: string): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase
    .from("terms")
    .update({ status: "closed" })
    .eq("academic_year_id", academic_year_id)
    .eq("status", "active");
  const { error } = await supabase.from("terms").update({ status: "active" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function createClassLevel(input: {
  academic_year_id: string;
  name: string;
  level_order: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("classes").insert({ school_id, ...input });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the class." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function createStream(input: {
  class_id: string;
  name: string;
  class_teacher_id?: string;
  capacity?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("streams").insert({
      school_id,
      class_id: input.class_id,
      name: input.name,
      class_teacher_id: input.class_teacher_id || null,
      capacity: input.capacity || null,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the stream." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function updateStreamClassTeacher(
  streamId: string,
  class_teacher_id: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("streams")
    .update({ class_teacher_id })
    .eq("id", streamId);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function updateStreamCapacity(streamId: string, capacity: number | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("streams").update({ capacity }).eq("id", streamId);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function assignSubjectTeacher(
  streamId: string,
  subjectId: string,
  teacherId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase
      .from("class_subjects")
      .upsert(
        { school_id, stream_id: streamId, subject_id: subjectId, teacher_id: teacherId },
        { onConflict: "stream_id,subject_id" },
      );
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update the allocation." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function createTimetableSlot(input: {
  stream_id: string;
  subject_id: string;
  teacher_id: string;
  day_of_week: number;
  period_number: number;
  start_time: string;
  end_time: string;
}): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const school_id = await schoolId(supabase);
  const { error } = await supabase.from("timetable_slots").insert({ school_id, ...input });
  if (error) {
    if (error.code === "23505") {
      return { error: "This stream or teacher already has a class scheduled for that day and period." };
    }
    return { error: error.message };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function deleteTimetableSlot(id: string): Promise<{ error: string } | { success: true }> {
  const supabase = await createClient();
  const { error } = await supabase.from("timetable_slots").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function rolloverAcademicYear(input: {
  from_academic_year_id: string;
  to_academic_year_id: string;
  repeat_student_ids: string[];
}): Promise<
  { error: string } | { success: true; promoted: number; repeated: number; graduated: number }
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollover_academic_year", {
    p_from_academic_year_id: input.from_academic_year_id,
    p_to_academic_year_id: input.to_academic_year_id,
    p_repeat_student_ids: input.repeat_student_ids,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath("/academics", "layout");
  revalidatePath("/students");
  return {
    success: true,
    promoted: row?.promoted_count ?? 0,
    repeated: row?.repeated_count ?? 0,
    graduated: row?.graduated_count ?? 0,
  };
}

export async function activateSubjects(catalogueIds: string[]): Promise<ActionResult> {
  if (catalogueIds.length === 0) return { error: "Select at least one subject to activate." };
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    // Pull the locked snapshot fields from the master catalogue -- a school can only
    // activate what's actually in subject_catalogue, never type its own name/code/is_core.
    const { data: catalogueRows, error: catalogueError } = await supabase
      .from("subject_catalogue")
      .select("id, name, code, is_core")
      .in("id", catalogueIds);
    if (catalogueError) return { error: catalogueError.message };
    if (!catalogueRows || catalogueRows.length === 0) return { error: "Could not find those catalogue subjects." };

    // Reactivating a previously-deactivated subject must go through UPDATE (is_active
    // is the only column the DB trigger allows to change post-insert) rather than
    // upsert-by-insert, which would try to rewrite the locked snapshot columns.
    const { data: existingRows } = await supabase
      .from("subjects")
      .select("id, catalogue_id, is_active")
      .eq("school_id", school_id)
      .in("catalogue_id", catalogueIds);
    const existingByCatalogueId = new Map((existingRows ?? []).map((r) => [r.catalogue_id, r]));

    const toReactivate = (existingRows ?? []).filter((r) => !r.is_active).map((r) => r.id);
    const toInsert = catalogueRows.filter((c) => !existingByCatalogueId.has(c.id));

    if (toReactivate.length > 0) {
      const { error } = await supabase.from("subjects").update({ is_active: true }).in("id", toReactivate);
      if (error) return { error: error.message };
    }
    if (toInsert.length > 0) {
      const { error } = await supabase.from("subjects").insert(
        toInsert.map((c) => ({
          school_id,
          catalogue_id: c.id,
          name: c.name,
          code: c.code,
          is_core: c.is_core,
          is_active: true,
        })),
      );
      if (error) return { error: error.message };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not activate the selected subjects." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function deactivateSubject(subjectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    // Deactivate only -- subjects has no DELETE RLS policy, so a school can never
    // remove a catalogue subject outright, only switch it off. Existing exam/marks/
    // timetable history against this subject_id is untouched.
    const { error } = await supabase.from("subjects").update({ is_active: false }).eq("id", subjectId);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not deactivate the subject." };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}
