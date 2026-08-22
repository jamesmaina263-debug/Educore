"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildGrid, generateTimetableSlots } from "@/lib/timetable/auto-generate";

// Matches the DAYS list already used by TimetableSection (Mon-Fri). Kept as
// a separate constant here rather than importing from a client component.
const DAYS = [1, 2, 3, 4, 5];

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

// Editing a year's name/dates never touches which records belong to it --
// every historical record (attendance, marks, fees, exams, ...) links to an
// academic_year_id/term_id by foreign key, not by date range, so nothing is
// re-derived from these dates after the fact. A separate guardrail trigger
// (validate_academic_year_mutation, added by a concurrent audit pass) blocks
// non-super-admins from editing a year once it's closed, treating a closed
// year as a protected historical record -- that error surfaces here as-is.
export async function updateAcademicYear(
  id: string,
  input: { name?: string; start_date?: string; end_date?: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("academic_years").update(input).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

// Blocked automatically (via a clear Postgres FK error, surfaced as-is below)
// the moment any real data references this year -- classes, applications,
// fee structures, terms, etc. all have NO ACTION/RESTRICT foreign keys to
// academic_years, so this can only ever succeed for a genuinely empty,
// unused year.
export async function deleteAcademicYear(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("academic_years").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { error: "This academic year has terms, classes, or other records linked to it and can't be deleted." };
    }
    return { error: error.message };
  }
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

// Same reasoning as updateAcademicYear, including the closed-record
// guardrail (validate_term_mutation) -- with one deliberate exception:
// term_number is NOT accepted here. Renumbering a term is a structural
// change (it can reorder a school's term sequence, not just relabel it),
// so it goes through deleteTerm + createTerm instead of a quiet field edit --
// that way it's an unambiguous pair of events in the audit log rather than
// a silent update. Use deleteTerm/createTerm for that case.
export async function updateTerm(
  id: string,
  input: { name?: string; start_date?: string; end_date?: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("terms").update(input).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/academics", "layout");
  return { success: true };
}

// Same protection as deleteAcademicYear: invoices, exams, fee structures,
// applications, etc. all have NO ACTION/RESTRICT foreign keys to terms, so
// this can only succeed for a term nothing has actually used yet.
export async function deleteTerm(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("terms").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      return { error: "This term has invoices, exams, or other records linked to it and can't be deleted." };
    }
    return { error: error.message };
  }
  revalidatePath("/academics", "layout");
  return { success: true };
}

export async function createClassLevel(input: {
  academic_year_id: string;
  name: string;
  /** Omit to let the database derive it automatically from the class name (preferred). */
  level_order?: number;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);
    const isManual = typeof input.level_order === "number";
    const { error } = await supabase.from("classes").insert({
      school_id,
      academic_year_id: input.academic_year_id,
      name: input.name,
      // A placeholder is required because the column is NOT NULL, but the
      // trg_classes_assign_level_order trigger overwrites it server-side
      // unless level_order_is_manual is true -- see phase23 migration.
      level_order: input.level_order ?? 0,
      level_order_is_manual: isManual,
    });
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

export interface TimetableUploadRow {
  class_name: string;
  stream_name: string;
  day: string;
  period_number: string;
  subject_name: string;
  teacher_name: string;
  start_time: string;
  end_time: string;
}

export interface TimetableUploadResult {
  rowNumber: number;
  status: "ok" | "error";
  message: string;
}

// Every actual lookup/validation (class+stream -> stream_id, subject name -> subject_id,
// teacher name -> teacher_id, day/time parsing, conflict detection) happens inside
// bulk_upsert_timetable_slots() itself, not here -- this action just forwards the
// client-parsed rows and returns the per-row result the RPC already computed. Re-uploading
// the same file is safe: the RPC upserts on (stream, day, period), so fixing a typo and
// re-uploading corrects that slot rather than creating a duplicate.
export async function bulkUploadTimetableAction(
  rows: TimetableUploadRow[],
): Promise<{ error: string } | { success: true; results: TimetableUploadResult[] }> {
  if (rows.length === 0) return { error: "No rows found in the file." };
  if (rows.length > 1000) return { error: "Too many rows in one file (max 1000) -- split it and upload in batches." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_upsert_timetable_slots", { p_rows: rows });
  if (error) return { error: error.message };

  const results: TimetableUploadResult[] = (
    (data as { row_number: number; status: "ok" | "error"; message: string }[]) ?? []
  ).map((r) => ({ rowNumber: r.row_number, status: r.status, message: r.message }));

  revalidatePath("/academics", "layout");
  return { success: true, results };
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

export interface GenerateTimetableSummary {
  placed: number;
  unplacedSubjects: Array<{ subject_name: string; requested: number; placed: number; reason: string }>;
  skippedSubjects: string[]; // class_subjects with no periods_per_week configured yet
}

export async function generateTimetableForStream(
  streamId: string,
): Promise<{ error: string } | { success: true; summary: GenerateTimetableSummary }> {
  const supabase = await createClient();
  try {
    const school_id = await schoolId(supabase);

    // Ensure this school has a period grid to schedule into (no-op if it
    // already does -- never touches an existing customized grid).
    await supabase.rpc("seed_default_timetable_periods");

    const [{ data: periods, error: periodsErr }, { data: allocations, error: allocErr }, { data: existingStreamSlots, error: streamSlotsErr }] =
      await Promise.all([
        supabase
          .from("timetable_periods")
          .select("period_number, is_teaching_period")
          .eq("school_id", school_id)
          .eq("is_teaching_period", true)
          .order("period_number"),
        supabase
          .from("class_subjects")
          .select("subject_id, teacher_id, periods_per_week, subjects(name)")
          .eq("stream_id", streamId),
        supabase.from("timetable_slots").select("day_of_week, period_number").eq("stream_id", streamId),
      ]);
    if (periodsErr) return { error: periodsErr.message };
    if (allocErr) return { error: allocErr.message };
    if (streamSlotsErr) return { error: streamSlotsErr.message };

    if (!periods || periods.length === 0) {
      return { error: "This school has no teaching periods configured. Set up the period grid first." };
    }

    const configured = (allocations ?? []).filter(
      (a): a is typeof a & { periods_per_week: number } => typeof a.periods_per_week === "number" && a.periods_per_week > 0,
    );
    const skippedSubjects = (allocations ?? [])
      .filter((a) => !(typeof a.periods_per_week === "number" && a.periods_per_week > 0))
      .map((a) => (a.subjects as unknown as { name: string } | null)?.name ?? "Unknown subject");

    if (configured.length === 0) {
      return {
        error:
          "No subjects for this stream have periods/week configured yet. Set periods/week in Teacher Allocation before generating.",
      };
    }

    // Teacher busy-cells across the WHOLE school, not just this stream, so
    // the generator never double-books a teacher who teaches other streams.
    const teacherIds = Array.from(new Set(configured.map((a) => a.teacher_id).filter((id): id is string => !!id)));
    const { data: teacherSlots, error: teacherSlotsErr } =
      teacherIds.length > 0
        ? await supabase.from("timetable_slots").select("teacher_id, day_of_week, period_number").in("teacher_id", teacherIds)
        : { data: [], error: null };
    if (teacherSlotsErr) return { error: teacherSlotsErr.message };

    const grid = buildGrid(DAYS, periods.map((p) => p.period_number));
    const { placements, unplaced } = generateTimetableSlots({
      grid,
      requirements: configured.map((a) => ({
        subject_id: a.subject_id,
        teacher_id: a.teacher_id,
        periods_per_week: a.periods_per_week,
      })),
      existingStreamCells: (existingStreamSlots ?? []).map((s) => ({ day: s.day_of_week, period: s.period_number })),
      existingTeacherCells: (teacherSlots ?? [])
        .filter((s): s is typeof s & { teacher_id: string } => !!s.teacher_id)
        .map((s) => ({ teacher_id: s.teacher_id, day: s.day_of_week, period: s.period_number })),
    });

    const periodTimes = new Map(periods.map((p) => [p.period_number, p]));
    // Look up start/end times separately since the select above only pulled period_number.
    const { data: periodTimeRows, error: periodTimeErr } = await supabase
      .from("timetable_periods")
      .select("period_number, start_time, end_time")
      .eq("school_id", school_id)
      .in("period_number", Array.from(periodTimes.keys()));
    if (periodTimeErr) return { error: periodTimeErr.message };
    const timeByPeriod = new Map((periodTimeRows ?? []).map((p) => [p.period_number, p]));

    let placed = 0;
    const insertErrors: string[] = [];
    for (const p of placements) {
      const times = timeByPeriod.get(p.period);
      if (!times) continue; // shouldn't happen, grid was built from the same period list
      const { error } = await supabase.from("timetable_slots").insert({
        school_id,
        stream_id: streamId,
        subject_id: p.subject_id,
        teacher_id: p.teacher_id,
        day_of_week: p.day,
        period_number: p.period,
        start_time: times.start_time,
        end_time: times.end_time,
      });
      // Defense in depth: the algorithm already avoids conflicts, but if a
      // slot was inserted concurrently (e.g. a teacher hand-editing at the
      // same moment), the DB's own unique constraints are the final say --
      // skip that one cell and keep going rather than aborting the batch.
      if (error) {
        insertErrors.push(`${p.day}/${p.period}: ${error.message}`);
      } else {
        placed++;
      }
    }

    const subjectNameById = new Map(configured.map((a) => [a.subject_id, (a.subjects as unknown as { name: string } | null)?.name ?? "Subject"]));
    const summary: GenerateTimetableSummary = {
      placed,
      unplacedSubjects: unplaced.map((u) => ({
        subject_name: subjectNameById.get(u.subject_id) ?? "Subject",
        requested: u.requested,
        placed: u.placed,
        reason:
          u.reason === "teacher_fully_booked"
            ? "the assigned teacher has no free periods left"
            : "the timetable grid is full for this stream",
      })),
      skippedSubjects,
    };
    if (insertErrors.length > 0) {
      return { error: `Generated ${placed} slot(s), but ${insertErrors.length} failed: ${insertErrors.slice(0, 3).join("; ")}` };
    }

    revalidatePath("/academics", "layout");
    return { success: true, summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not generate the timetable." };
  }
}

