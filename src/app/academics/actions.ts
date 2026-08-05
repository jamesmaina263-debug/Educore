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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
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
  revalidatePath("/academics");
  revalidatePath("/students");
  return {
    success: true,
    promoted: row?.promoted_count ?? 0,
    repeated: row?.repeated_count ?? 0,
    graduated: row?.graduated_count ?? 0,
  };
}

export async function createSubject(input: {
  name: string;
  code?: string;
  is_core: boolean;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const { error } = await supabase.from("subjects").insert({
      school_id,
      name: input.name,
      code: input.code || null,
      is_core: input.is_core,
    });
    if (error) return { error: error.message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the subject." };
  }
  revalidatePath("/academics");
  return { success: true };
}
