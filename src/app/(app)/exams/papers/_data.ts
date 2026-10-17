import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import type { ExamSourceKind } from "@/lib/ai/exam-paper";

export interface PaperQuestionRow {
  id: string;
  position: number;
  question_type: string;
  question_text: string;
  marks: number;
  marking_scheme: string;
  sub_strand_label: string;
}

export interface PaperRow {
  id: string;
  title: string;
  status: "draft" | "approved";
  total_marks: number;
  class_name: string;
  subject_name: string;
  source_kind: ExamSourceKind;
  source_name: string;
  source_licence_reference: string | null;
  source_attribution: string | null;
  questions: PaperQuestionRow[];
}

export interface PapersContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canGenerate: boolean;
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  openExams: { id: string; name: string }[];
  papers: PaperRow[];
}

export async function loadPapersContext(): Promise<PapersContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canGenerate }, { data: classes }, { data: subjects }, { data: exams }, { data: papers }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.generate_paper_ai" }),
    supabase.from("classes").select("id, name").order("level_order"),
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase.from("exams").select("id, name").eq("status", "open").order("created_at", { ascending: false }),
    supabase
      .from("exam_papers")
      .select(
        "id, title, status, total_marks, source_kind, source_name, source_licence_reference, source_attribution, classes(name), subjects(name), exam_paper_questions(id, position, question_type, question_text, marks, marking_scheme, sub_strand_label)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  type Raw = {
    id: string;
    title: string;
    status: "draft" | "approved";
    total_marks: number;
    source_kind: ExamSourceKind;
    source_name: string;
    source_licence_reference: string | null;
    source_attribution: string | null;
    classes: { name: string } | { name: string }[] | null;
    subjects: { name: string } | { name: string }[] | null;
    exam_paper_questions: PaperQuestionRow[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canGenerate: canGenerate === true,
    classes: (classes ?? []) as { id: string; name: string }[],
    subjects: (subjects ?? []) as { id: string; name: string }[],
    openExams: (exams ?? []) as { id: string; name: string }[],
    papers: ((papers ?? []) as unknown as Raw[]).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      total_marks: Number(p.total_marks),
      class_name: one(p.classes)?.name ?? "",
      subject_name: one(p.subjects)?.name ?? "",
      source_kind: p.source_kind,
      source_name: p.source_name,
      source_licence_reference: p.source_licence_reference,
      source_attribution: p.source_attribution,
      questions: [...(p.exam_paper_questions ?? [])].sort((a, b) => a.position - b.position),
    })),
  };
}
