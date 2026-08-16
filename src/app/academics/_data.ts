import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AcademicYearRow, TermRow } from "@/components/academics/years-terms-section";
import type { ClassRow, StreamRow, TeacherOption } from "@/components/academics/classes-streams-section";
import type { SubjectRow } from "@/components/academics/subjects-section";
import type { ClassSubjectRow } from "@/components/academics/teacher-allocation-section";
import type { StudentOption } from "@/components/academics/rollover-section";
import type { TimetableSlotRow } from "@/components/academics/timetable-section";

export interface AcademicsContext {
  userName: string;
  userRole?: string;
  schoolName: string;
  canWrite: boolean;
  canRollover: boolean;
  canSendNewsletter: boolean;
  years: AcademicYearRow[];
  terms: TermRow[];
  activeYearId: string | null;
  activeYearName: string | null;
  classes: ClassRow[];
  activeYearClasses: ClassRow[];
  streams: StreamRow[];
  subjects: SubjectRow[];
  teachers: TeacherOption[];
  occupancyByStream: Record<string, number>;
  classSubjectRows: ClassSubjectRow[];
  timetableSlots: TimetableSlotRow[];
  students: StudentOption[];
}

export async function loadAcademicsContext(): Promise<AcademicsContext> {
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

  const [
    { data: years },
    { data: terms },
    { data: classes },
    { data: streams },
    { data: subjects },
    { data: teacherRows },
    { data: canWriteData },
    { data: canRolloverData },
    { data: canSendNewsletterData },
    { data: activeStudents },
    { data: timetableSlots },
    { data: classSubjectRows },
  ] = await Promise.all([
    supabase.from("academic_years").select("id, name, start_date, end_date, status").order("start_date", { ascending: false }),
    supabase.from("terms").select("id, academic_year_id, name, term_number, start_date, end_date, status").order("term_number"),
    supabase.from("classes").select("id, academic_year_id, name, level_order"),
    supabase.from("streams").select("id, class_id, name, class_teacher_id, capacity"),
    supabase.from("subjects").select("id, name, code, is_core").order("name"),
    supabase
      .from("school_users")
      .select("id, full_name, roles!inner(name)")
      .in("roles.name", ["teacher", "class_teacher"])
      .eq("status", "active"),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "communication.write" }),
    supabase
      .from("students")
      .select("id, admission_number, first_name, last_name, current_class_id")
      .eq("status", "active")
      .order("first_name"),
    supabase
      .from("timetable_slots")
      .select("id, stream_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time")
      .order("day_of_week")
      .order("period_number"),
    supabase.from("class_subjects").select("stream_id, subject_id, teacher_id"),
  ]);

  const canWrite = canWriteData === true;
  const canRollover = canRolloverData === true;
  const canSendNewsletter = canSendNewsletterData === true;
  const students: StudentOption[] = (activeStudents ?? []) as StudentOption[];
  const activeYear = (years ?? []).find((y) => y.status === "active") ?? null;

  const occupancyByStream = new Map<string, number>();
  for (const s of activeStudents ?? []) {
    if (!s.current_class_id) continue;
    occupancyByStream.set(s.current_class_id, (occupancyByStream.get(s.current_class_id) ?? 0) + 1);
  }

  const teachers: TeacherOption[] = (teacherRows ?? [])
    .filter((t) => (t.roles as unknown as { name: string } | null)?.name)
    .map((t) => ({ id: t.id, full_name: t.full_name }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return {
    userName: schoolUser?.full_name ?? user.email ?? "Account",
    userRole: roleName,
    schoolName: schoolName ?? "EduCore",
    canWrite,
    canRollover,
    canSendNewsletter,
    years: (years ?? []) as AcademicYearRow[],
    terms: (terms ?? []) as TermRow[],
    activeYearId: activeYear?.id ?? null,
    activeYearName: activeYear?.name ?? null,
    classes: (classes ?? []) as ClassRow[],
    activeYearClasses: (classes ?? []).filter((c) => c.academic_year_id === activeYear?.id) as ClassRow[],
    streams: (streams ?? []) as StreamRow[],
    subjects: (subjects ?? []) as SubjectRow[],
    teachers,
    occupancyByStream: Object.fromEntries(occupancyByStream),
    classSubjectRows: (classSubjectRows ?? []) as ClassSubjectRow[],
    timetableSlots: (timetableSlots ?? []) as TimetableSlotRow[],
    students,
  };
}
