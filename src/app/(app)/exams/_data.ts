import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import type { ExamRow, TermOption, ClassOption, SubjectOption } from "@/components/exams/exams-section";
import type { GradingScaleRow, ClassRow } from "@/components/exams/grading-scales-section";

export interface AssessmentSchemeRow {
  id: string;
  name: string;
  is_default: boolean;
  components: { id: string; name: string; weight_percent: number; display_order: number }[];
}

export interface ExamsContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canWrite: boolean;
  examRows: ExamRow[];
  terms: TermOption[];
  classes: ClassOption[];
  subjects: SubjectOption[];
  scaleRows: GradingScaleRow[];
  gradingClasses: ClassRow[];
  hasGradingScale: boolean;
  schemeRows: AssessmentSchemeRow[];
}

export async function loadExamsContext(): Promise<ExamsContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const [
    { data: exams },
    { data: terms },
    { data: classes },
    { data: subjects },
    { data: scales },
    { data: bands },
    { data: canWrite },
    { data: schemes },
    { data: components },
    { data: classSubjectRows },
  ] = await Promise.all([
    supabase.from("exams").select("id, name, exam_type, status, term_id, terms(name)").order("created_at", { ascending: false }),
    supabase.from("terms").select("id, name").eq("status", "active"),
    supabase.from("classes").select("id, name, grading_scale_id, kicd_grade").order("level_order"),
    supabase.from("subjects").select("id, name, subject_catalogue(grade_band)").eq("is_active", true).order("name"),
    supabase.from("grading_scales").select("id, name, model_type, is_default"),
    supabase.from("grading_scale_bands").select("id, grading_scale_id, label, min_score, max_score, level_order"),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
    supabase.from("assessment_schemes").select("id, name, is_default").order("created_at"),
    supabase.from("assessment_components").select("id, scheme_id, name, weight_percent, display_order").order("display_order"),
    // Which classes each subject is already assigned in (via the class's streams), so the
    // New-exam dialog can offer the right subjects per class.
    supabase.from("class_subjects").select("subject_id, streams(class_id)"),
  ]);

  const classIdsBySubject = new Map<string, Set<string>>();
  for (const row of classSubjectRows ?? []) {
    const stream = row.streams as unknown as { class_id: string } | { class_id: string }[] | null;
    const classId = Array.isArray(stream) ? stream[0]?.class_id : stream?.class_id;
    if (!classId) continue;
    if (!classIdsBySubject.has(row.subject_id)) classIdsBySubject.set(row.subject_id, new Set());
    classIdsBySubject.get(row.subject_id)!.add(classId);
  }
  const subjectOptions: SubjectOption[] = (subjects ?? []).map((s) => {
    const cat = s.subject_catalogue as unknown as { grade_band: string | null } | { grade_band: string | null }[] | null;
    return {
      id: s.id,
      name: s.name,
      grade_band: (Array.isArray(cat) ? cat[0]?.grade_band : cat?.grade_band) ?? null,
      class_ids: Array.from(classIdsBySubject.get(s.id) ?? []),
    };
  });

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const examRows: ExamRow[] = (exams ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    exam_type: e.exam_type,
    status: e.status as "open" | "closed",
    term_id: e.term_id,
    term_name: (e.terms as unknown as { name: string } | null)?.name ?? "",
  }));

  const scaleRows: GradingScaleRow[] = (scales ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    model_type: s.model_type as "numeric" | "cbc",
    is_default: s.is_default,
    bands: (bands ?? []).filter((b) => b.grading_scale_id === s.id),
  }));

  const schemeRows: AssessmentSchemeRow[] = (schemes ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    is_default: s.is_default,
    components: (components ?? []).filter((c) => c.scheme_id === s.id),
  }));

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canWrite: canWrite === true,
    examRows,
    terms: (terms ?? []) as TermOption[],
    classes: (classes ?? []) as ClassOption[],
    subjects: subjectOptions,
    scaleRows,
    gradingClasses: (classes ?? []) as ClassRow[],
    hasGradingScale: (scales ?? []).length > 0,
    schemeRows,
  };
}
