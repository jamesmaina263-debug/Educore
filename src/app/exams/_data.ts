import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ExamRow, TermOption, ClassOption, SubjectOption } from "@/components/exams/exams-section";
import type { GradingScaleRow, ClassRow } from "@/components/exams/grading-scales-section";

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
}

export async function loadExamsContext(): Promise<ExamsContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const [{ data: exams }, { data: terms }, { data: classes }, { data: subjects }, { data: scales }, { data: bands }, { data: canWrite }] =
    await Promise.all([
      supabase.from("exams").select("id, name, exam_type, status, term_id, terms(name)").order("created_at", { ascending: false }),
      supabase.from("terms").select("id, name").eq("status", "active"),
      supabase.from("classes").select("id, name, grading_scale_id").order("level_order"),
      supabase.from("subjects").select("id, name").order("name"),
      supabase.from("grading_scales").select("id, name, model_type, is_default"),
      supabase.from("grading_scale_bands").select("id, grading_scale_id, label, min_score, max_score, level_order"),
      supabase.rpc("auth_has_permission", { p_permission_key: "exams.write" }),
    ]);

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

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canWrite: canWrite === true,
    examRows,
    terms: (terms ?? []) as TermOption[],
    classes: (classes ?? []) as ClassOption[],
    subjects: (subjects ?? []) as SubjectOption[],
    scaleRows,
    gradingClasses: (classes ?? []) as ClassRow[],
    hasGradingScale: (scales ?? []).length > 0,
  };
}
