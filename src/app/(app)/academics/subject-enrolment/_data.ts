import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { loadEnrolmentRows } from "@/lib/academics/load-subject-enrolment";
import { buildEnrolmentView, type SubjectEnrolmentView } from "@/lib/academics/enrolment-view";

export interface EnrolmentSubject extends SubjectEnrolmentView {
  name: string;
  isCore: boolean;
}

export interface EnrolmentStudent {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  streamName: string | null;
}

export interface SubjectEnrolmentContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canView: boolean;
  canEdit: boolean;
  classOptions: { id: string; name: string; level_order: number }[];
  selectedClassId: string | null;
  students: EnrolmentStudent[];
  subjects: EnrolmentSubject[];
}

export async function loadSubjectEnrolmentContext(requestedClassId?: string): Promise<SubjectEnrolmentContext> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canRead }, { data: canWrite }, { data: classes }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase.from("classes").select("id, name, level_order, academic_year_id").order("level_order"),
  ]);

  const base = {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name,
    schoolName: (schoolUser?.schools as unknown as { name: string } | null)?.name ?? "EduCore",
    canView: canRead === true,
    canEdit: canWrite === true,
  };
  const classOptions = (classes ?? []) as { id: string; name: string; level_order: number; academic_year_id: string | null }[];
  if (!base.canView || classOptions.length === 0) {
    return { ...base, classOptions, selectedClassId: null, students: [], subjects: [] };
  }

  const selected = (requestedClassId ? classOptions.find((c) => c.id === requestedClassId) : null) ?? classOptions[0];
  const { data: streamRows } = await supabase.from("streams").select("id, name").eq("class_id", selected.id);
  const streams = streamRows ?? [];
  const streamIds = streams.map((s) => s.id as string);
  const streamName = new Map(streams.map((s) => [s.id as string, s.name as string]));

  const [{ data: studentRows }, { data: taughtRows }] = streamIds.length
    ? await Promise.all([
        supabase
          .from("students")
          .select("id, first_name, last_name, other_names, admission_number, current_class_id")
          .in("current_class_id", streamIds)
          .eq("status", "active")
          .order("first_name"),
        supabase.from("class_subjects").select("subject_id, subjects(id, name, is_core, is_active)").in("stream_id", streamIds),
      ])
    : [{ data: [] }, { data: [] }];

  const students: EnrolmentStudent[] = (studentRows ?? []).map((s) => ({
    id: s.id as string,
    fullName: [s.first_name, s.other_names, s.last_name].filter(Boolean).join(" "),
    admissionNumber: (s.admission_number as string | null) ?? null,
    streamName: streamName.get((s.current_class_id as string) ?? "") ?? null,
  }));

  const subjectMap = new Map<string, { name: string; isCore: boolean }>();
  for (const row of taughtRows ?? []) {
    const raw = row.subjects as unknown as { id: string; name: string; is_core: boolean; is_active: boolean | null } | { id: string; name: string; is_core: boolean; is_active: boolean | null }[] | null;
    const sub = Array.isArray(raw) ? raw[0] : raw;
    if (sub && sub.is_active !== false) subjectMap.set(sub.id, { name: sub.name, isCore: sub.is_core });
  }
  const subjectIds = [...subjectMap.keys()];

  // Same loader as mark entry, so this screen and mark entry can never disagree about who is enrolled.
  const rows = await loadEnrolmentRows(supabase, {
    academicYearId: selected.academic_year_id,
    classIds: [selected.id],
    studentIds: students.map((s) => s.id),
    subjectIds,
  });
  const view = buildEnrolmentView(subjectIds, students.map((s) => s.id), rows);

  const subjects: EnrolmentSubject[] = view
    .map((v) => ({ ...v, name: subjectMap.get(v.subjectId)!.name, isCore: subjectMap.get(v.subjectId)!.isCore }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ...base, classOptions, selectedClassId: selected.id, students, subjects };
}
