import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import type {
  FilterOption,
  SchemeListRow,
  TeachingAssignmentOption,
  CreateSchemeOptions,
  SchemeEntryRow,
  SchemeDetailContext,
} from "./_types";
import { STATUS_LABELS } from "./_types";

export type { FilterOption, SchemeListRow, TeachingAssignmentOption, CreateSchemeOptions, SchemeEntryRow, SchemeDetailContext };
export { STATUS_LABELS };

export interface SchemeOfWorkDashboardContext {
  userName: string;
  userRole?: string;
  schoolName?: string;
  canRead: boolean;
  canWrite: boolean;
  canWriteAny: boolean;
  schemes: SchemeListRow[];
  yearOptions: FilterOption[];
  termOptions: FilterOption[];
  classOptions: FilterOption[];
  streamOptions: FilterOption[];
  subjectOptions: FilterOption[];
  teacherOptions: FilterOption[];
  statusOptions: FilterOption[];
  filters: { year?: string; term?: string; class?: string; stream?: string; subject?: string; teacher?: string; status?: string };
}

export async function loadSchemeOfWorkDashboard(searchParams: {
  year?: string;
  term?: string;
  class?: string;
  stream?: string;
  subject?: string;
  teacher?: string;
  status?: string;
}): Promise<SchemeOfWorkDashboardContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canRead }, { data: canWrite }, { data: canWriteAny }, { data: moduleEnabled }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write_any" }),
    supabase.rpc("auth_school_module_enabled", { p_key: "scheme_of_work" }),
  ]);
  // Per-school module switch (school_modules, default enabled -- see school_module_enabled) --
  // a school that's had Scheme of Work turned off gets redirected out here, the one place this
  // whole route loads through, same as health/_data.ts's redirect. moduleEnabled fails safe to
  // true (missing row, typo, or a core module), so this can only ever narrow access for a school
  // explicitly toggled off, never lock anyone out unexpectedly.
  if (moduleEnabled === false) redirect("/dashboard");

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const empty: SchemeOfWorkDashboardContext = {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    canRead: !!canRead,
    // write_any implies write (mirrors the OR already in every RLS write
    // policy on schemes_of_work/scheme_of_work_entries -- see the schema
    // migration) so a write_any-only role, like school_owner, still sees
    // the "New Scheme" entry point rather than being silently locked out
    // of a scheme they can, at the database layer, already create.
    canWrite: !!canWrite || !!canWriteAny,
    canWriteAny: !!canWriteAny,
    schemes: [],
    yearOptions: [],
    termOptions: [],
    classOptions: [],
    streamOptions: [],
    subjectOptions: [],
    teacherOptions: [],
    statusOptions: Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label })),
    filters: searchParams,
  };

  if (!canRead) return empty;

  let query = supabase
    .from("schemes_of_work")
    .select(
      // school_users is disambiguated with !schemes_of_work_teacher_id_fkey
      // because schemes_of_work has four FKs into school_users (teacher_id,
      // submitted_by, reviewed_by, created_by) -- a bare school_users(...)
      // embed is ambiguous to PostgREST and errors, which this call was
      // silently swallowing (only `data` was read, never `error`), so a
      // school's very first real scheme always 404'd. Same fix as the
      // already-correct embed in [id]/print/page.tsx.
      "id, status, origin, total_weeks, lessons_per_week, updated_at, academic_year_id, term_id, class_id, stream_id, subject_id, teacher_id, subjects(name), classes(name), streams(name), school_users!schemes_of_work_teacher_id_fkey(full_name), terms(name, academic_years(name))",
    )
    .order("updated_at", { ascending: false });

  if (searchParams.year) query = query.eq("academic_year_id", searchParams.year);
  if (searchParams.term) query = query.eq("term_id", searchParams.term);
  if (searchParams.class) query = query.eq("class_id", searchParams.class);
  if (searchParams.stream) query = query.eq("stream_id", searchParams.stream);
  if (searchParams.subject) query = query.eq("subject_id", searchParams.subject);
  if (searchParams.teacher) query = query.eq("teacher_id", searchParams.teacher);
  if (searchParams.status) query = query.eq("status", searchParams.status);

  const [{ data: schemeRows }, { data: yearsRaw }, { data: termsRaw }, { data: classesRaw }, { data: streamsRaw }, { data: subjectsRaw }, { data: teachersRaw }] =
    await Promise.all([
      query,
      supabase.from("academic_years").select("id, name").order("start_date", { ascending: false }),
      supabase.from("terms").select("id, name, academic_years(name)").order("start_date", { ascending: false }),
      supabase.from("classes").select("id, name").order("level_order"),
      supabase.from("streams").select("id, name, class_id, classes(name)").order("name"),
      supabase.from("subjects").select("id, name").order("name"),
      canWriteAny
        ? supabase
            .from("school_users")
            .select("id, full_name, roles!inner(name)")
            .not("roles.name", "in", "(parent,student,super_admin)")
            .order("full_name")
        : Promise.resolve({ data: schoolUser ? [{ id: schoolUser.id, full_name: schoolUser.full_name }] : [] }),
    ]);

  const schemeIds = (schemeRows ?? []).map((s) => s.id);
  const { data: entryCounts } = schemeIds.length
    ? await supabase.from("scheme_of_work_entries").select("scheme_id, completion_status").in("scheme_id", schemeIds)
    : { data: [] as { scheme_id: string; completion_status: string }[] };

  const countsByScheme = new Map<string, { total: number; completed: number }>();
  for (const row of entryCounts ?? []) {
    const c = countsByScheme.get(row.scheme_id) ?? { total: 0, completed: 0 };
    c.total += 1;
    if (row.completion_status === "completed") c.completed += 1;
    countsByScheme.set(row.scheme_id, c);
  }

  const schemes: SchemeListRow[] = (schemeRows ?? []).map((s) => {
    const counts = countsByScheme.get(s.id) ?? { total: 0, completed: 0 };
    const term = s.terms as unknown as { name: string; academic_years: { name: string } | null } | null;
    return {
      id: s.id,
      status: s.status,
      origin: s.origin as "manual" | "ai_generated",
      total_weeks: s.total_weeks,
      lessons_per_week: s.lessons_per_week,
      updated_at: s.updated_at,
      subject_name: (s.subjects as unknown as { name: string } | null)?.name ?? "—",
      class_name: (s.classes as unknown as { name: string } | null)?.name ?? "—",
      stream_name: (s.streams as unknown as { name: string } | null)?.name ?? null,
      teacher_name: (s.school_users as unknown as { full_name: string } | null)?.full_name ?? "—",
      term_label: term ? `${term.academic_years?.name ?? ""} — ${term.name}` : "—",
      entries_total: counts.total,
      entries_completed: counts.completed,
    };
  });

  return {
    ...empty,
    schemes,
    yearOptions: (yearsRaw ?? []).map((y) => ({ id: y.id, label: y.name })),
    termOptions: (termsRaw ?? []).map((t) => ({
      id: t.id,
      label: `${(t.academic_years as unknown as { name: string } | null)?.name ?? ""} — ${t.name}`,
    })),
    classOptions: (classesRaw ?? []).map((c) => ({ id: c.id, label: c.name })),
    streamOptions: (streamsRaw ?? []).map((s) => ({
      id: s.id,
      label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} — ${s.name}`,
    })),
    subjectOptions: (subjectsRaw ?? []).map((s) => ({ id: s.id, label: s.name })),
    teacherOptions: (teachersRaw ?? []).map((t) => ({ id: t.id, label: t.full_name })),
  };
}

// ---------------------------------------------------------------------------
// Create-scheme form options
// ---------------------------------------------------------------------------

export async function loadCreateSchemeOptions(): Promise<CreateSchemeOptions> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWrite }, { data: canWriteAny }, { data: canGenerateAI }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.generate_ai" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const [{ data: yearsRaw }, { data: termsRaw }, { data: classesRaw }, { data: streamsRaw }, { data: subjectsRaw }, { data: assignmentsRaw }] =
    await Promise.all([
      supabase.from("academic_years").select("id, name").order("start_date", { ascending: false }),
      supabase.from("terms").select("id, name, academic_years(name)").order("start_date", { ascending: false }),
      supabase.from("classes").select("id, name").order("level_order"),
      supabase.from("streams").select("id, name, class_id").order("name"),
      supabase.from("subjects").select("id, name").order("name"),
      // "Don't make the teacher re-enter what EduCore already knows" (spec item 2/6):
      // this teacher's own stream+subject assignments, so the create form can
      // offer them as one-click picks that also prefill class/stream/subject.
      schoolUser
        ? supabase
            .from("class_subjects")
            .select("stream_id, subject_id, streams(name, class_id, classes(name)), subjects(name)")
            .eq("teacher_id", schoolUser.id)
        : Promise.resolve({ data: [] }),
    ]);

  let lessonsByStreamSubject = new Map<string, number>();
  if (schoolUser && (assignmentsRaw ?? []).length > 0) {
    const { data: slots } = await supabase
      .from("timetable_slots")
      .select("stream_id, subject_id")
      .eq("teacher_id", schoolUser.id);
    const counts = new Map<string, number>();
    for (const slot of slots ?? []) {
      const key = `${slot.stream_id}:${slot.subject_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    lessonsByStreamSubject = counts;
  }

  const assignments: TeachingAssignmentOption[] = (assignmentsRaw ?? []).map((a) => {
    const stream = a.streams as unknown as { name: string; class_id: string; classes: { name: string } | null } | null;
    const key = `${a.stream_id}:${a.subject_id}`;
    return {
      stream_id: a.stream_id,
      subject_id: a.subject_id,
      class_id: stream?.class_id ?? "",
      class_name: stream?.classes?.name ?? "",
      stream_name: stream?.name ?? "",
      subject_name: (a.subjects as unknown as { name: string } | null)?.name ?? "",
      lessons_per_week: lessonsByStreamSubject.get(key) ?? null,
    };
  });

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName,
    // Same write_any-implies-write reasoning as loadSchemeOfWorkDashboard.
    canWrite: !!canWrite || !!canWriteAny,
    canGenerateAI: !!canGenerateAI,
    yearOptions: (yearsRaw ?? []).map((y) => ({ id: y.id, label: y.name })),
    termOptions: (termsRaw ?? []).map((t) => ({
      id: t.id,
      label: `${(t.academic_years as unknown as { name: string } | null)?.name ?? ""} — ${t.name}`,
    })),
    classOptions: (classesRaw ?? []).map((c) => ({ id: c.id, label: c.name })),
    streamOptions: (streamsRaw ?? []).map((s) => ({ id: s.id, label: s.name, class_id: s.class_id })),
    subjectOptions: (subjectsRaw ?? []).map((s) => ({ id: s.id, label: s.name })),
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Scheme detail / editor
// ---------------------------------------------------------------------------

export async function loadSchemeDetail(schemeId: string): Promise<SchemeDetailContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteAny }, { data: canReview }, { data: canGenerateAI }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.write_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.review" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "scheme_of_work.generate_ai" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const base = { userName: schoolUser?.full_name ?? user.email ?? "Account", userRole: roleName, schoolName };

  const { data: schemeRow } = await supabase
    .from("schemes_of_work")
    .select(
      // Same school_users!schemes_of_work_teacher_id_fkey disambiguation as
      // loadSchemeOfWorkDashboard above -- see the comment there.
      "id, status, origin, total_weeks, lessons_per_week, teacher_id, review_comment, subjects(name), classes(name), streams(name), school_users!schemes_of_work_teacher_id_fkey(full_name), terms(name, academic_years(name))",
    )
    .eq("id", schemeId)
    .maybeSingle();

  if (!schemeRow) {
    return { ...base, scheme: null, entries: [], canEdit: false, canReview: false, canGenerateAI: false, isOwner: false };
  }

  const { data: entriesRaw } = await supabase
    .from("scheme_of_work_entries")
    .select("*")
    .eq("scheme_id", schemeId)
    .order("week_number")
    .order("lesson_number");

  const term = schemeRow.terms as unknown as { name: string; academic_years: { name: string } | null } | null;
  const isOwner = schemeRow.teacher_id === schoolUser?.id;

  return {
    ...base,
    scheme: {
      id: schemeRow.id,
      status: schemeRow.status,
      origin: schemeRow.origin,
      total_weeks: schemeRow.total_weeks,
      lessons_per_week: schemeRow.lessons_per_week,
      teacher_id: schemeRow.teacher_id,
      review_comment: schemeRow.review_comment,
      subject_name: (schemeRow.subjects as unknown as { name: string } | null)?.name ?? "—",
      class_name: (schemeRow.classes as unknown as { name: string } | null)?.name ?? "—",
      stream_name: (schemeRow.streams as unknown as { name: string } | null)?.name ?? null,
      teacher_name: (schemeRow.school_users as unknown as { full_name: string } | null)?.full_name ?? "—",
      term_label: term ? `${term.academic_years?.name ?? ""} — ${term.name}` : "—",
    },
    entries: entriesRaw ?? [],
    canEdit: isOwner || !!canWriteAny,
    canReview: !!canReview,
    canGenerateAI: !!canGenerateAI,
    isOwner,
  };
}
