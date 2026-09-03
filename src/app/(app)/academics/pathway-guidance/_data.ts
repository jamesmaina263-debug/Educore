import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computePathwayFit, type PathwayFitMarkInput, type PathwayFitSummary } from "@/lib/academics/pathway-fit";

export interface ClassOption {
  id: string;
  name: string;
  level_order: number;
}

export interface StudentPathwayFitRow {
  studentId: string;
  fullName: string;
  admissionNumber: string | null;
  streamName: string | null;
  summary: PathwayFitSummary;
}

export interface PathwayGuidanceContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canView: boolean;
  classOptions: ClassOption[];
  selectedClassId: string | null;
  selectedClassName: string | null;
  roster: StudentPathwayFitRow[];
}

// A Grade 9 (or later) class is the natural point to surface this -- it's the last Junior
// School grade before Senior School pathway selection. Matched on classes.name, the same free-text
// field the rest of the app already treats as the source of truth for "which grade is this" (see
// data-import-actions.ts's own "Grade 9" sample rows) -- there is no separate canonical grade-number
// column. This is only used to pick a sensible DEFAULT in the class picker; any class can still be
// selected manually, since the underlying computation degrades safely (returns ineligible) for a
// class with no pathway-mapped subjects/marks rather than showing something misleading.
const DEFAULT_CLASS_PATTERN = /grade\s*9\b/i;

export async function loadPathwayGuidanceContext(requestedClassId?: string): Promise<PathwayGuidanceContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canAcademics }, { data: canExams }, { data: classes }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.read" }),
    supabase.from("classes").select("id, name, level_order").order("level_order"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const canView = canAcademics === true && canExams === true;

  const classOptions: ClassOption[] = (classes ?? []) as ClassOption[];

  if (!canView || classOptions.length === 0) {
    return {
      userName: schoolUser?.full_name ?? user.email ?? "Account",
      userRole: roleName,
      schoolName: schoolName ?? "EduCore",
      canView,
      classOptions,
      selectedClassId: null,
      selectedClassName: null,
      roster: [],
    };
  }

  const defaultClass = classOptions.find((c) => DEFAULT_CLASS_PATTERN.test(c.name)) ?? classOptions[0];
  const selectedClass = (requestedClassId ? classOptions.find((c) => c.id === requestedClassId) : null) ?? defaultClass;

  const { data: streamRows } = await supabase.from("streams").select("id, name").eq("class_id", selectedClass.id);
  const streams = streamRows ?? [];
  const streamNameById = new Map(streams.map((s) => [s.id, s.name]));
  const streamIds = streams.map((s) => s.id);

  const { data: studentRows } = streamIds.length
    ? await supabase
        .from("students")
        .select("id, first_name, last_name, other_names, admission_number, current_class_id")
        .in("current_class_id", streamIds)
        .eq("status", "active")
        .order("first_name")
    : { data: [] };
  const students = studentRows ?? [];
  const studentIds = students.map((s) => s.id);

  const { data: markRows } = studentIds.length
    ? await supabase
        .from("marks")
        .select(
          "student_id, subject_id, exam_id, raw_score, band_id, subjects(name, is_core, subject_catalogue(pathway)), grading_scale_bands(label)",
        )
        .eq("class_id", selectedClass.id)
        .in("student_id", studentIds)
    : { data: [] };

  const { data: examSubjectRows } = studentIds.length
    ? await supabase.from("exam_subjects").select("exam_id, subject_id, max_score").eq("class_id", selectedClass.id)
    : { data: [] };

  const maxScoreByKey = new Map<string, number>();
  for (const es of examSubjectRows ?? []) {
    maxScoreByKey.set(`${es.exam_id}|${es.subject_id}`, es.max_score as number);
  }

  const marksByStudent = new Map<string, PathwayFitMarkInput[]>();
  for (const m of markRows ?? []) {
    const subject = m.subjects as unknown as {
      name: string;
      is_core: boolean;
      subject_catalogue: { pathway: string } | null;
    } | null;
    const band = m.grading_scale_bands as unknown as { label: string } | null;
    if (!subject) continue;

    const input: PathwayFitMarkInput = {
      subjectId: m.subject_id,
      subjectName: subject.name,
      pathway: subject.subject_catalogue?.pathway ?? null,
      isCore: subject.is_core,
      rawScore: m.raw_score,
      maxScore: maxScoreByKey.get(`${m.exam_id}|${m.subject_id}`) ?? null,
      bandLabel: band?.label ?? null,
    };

    const list = marksByStudent.get(m.student_id) ?? [];
    list.push(input);
    marksByStudent.set(m.student_id, list);
  }

  const roster: StudentPathwayFitRow[] = students.map((s) => ({
    studentId: s.id,
    fullName: [s.first_name, s.other_names, s.last_name].filter(Boolean).join(" "),
    admissionNumber: s.admission_number,
    streamName: streamNameById.get(s.current_class_id ?? "") ?? null,
    summary: computePathwayFit(marksByStudent.get(s.id) ?? []),
  }));

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canView,
    classOptions,
    selectedClassId: selectedClass.id,
    selectedClassName: selectedClass.name,
    roster,
  };
}
