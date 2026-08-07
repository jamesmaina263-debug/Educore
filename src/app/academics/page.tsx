import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YearsTermsSection, type AcademicYearRow, type TermRow } from "@/components/academics/years-terms-section";
import {
  ClassesStreamsSection,
  type ClassRow,
  type StreamRow,
  type TeacherOption,
} from "@/components/academics/classes-streams-section";
import { SubjectsSection, type SubjectRow } from "@/components/academics/subjects-section";
import { RolloverSection, type StudentOption } from "@/components/academics/rollover-section";
import { TimetableSection, type TimetableSlotRow } from "@/components/academics/timetable-section";

export default async function AcademicsPage() {
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
    { data: activeStudents },
    { data: timetableSlots },
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
    supabase
      .from("students")
      .select("id, admission_number, first_name, last_name")
      .eq("status", "active")
      .order("first_name"),
    supabase
      .from("timetable_slots")
      .select("id, stream_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time")
      .order("day_of_week")
      .order("period_number"),
  ]);

  const canWrite = canWriteData === true;
  const canRollover = canRolloverData === true;
  const students: StudentOption[] = (activeStudents ?? []) as StudentOption[];
  const activeYear = (years ?? []).find((y) => y.status === "active") ?? null;

  const teachers: TeacherOption[] = (teacherRows ?? [])
    .filter((t) => (t.roles as unknown as { name: string } | null)?.name)
    .map((t) => ({ id: t.id, full_name: t.full_name }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Academics" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Academics</h1>
          <p className="text-sm text-muted-foreground">Years, terms, classes, streams and subjects</p>
        </div>

        <Tabs defaultValue="years">
          <TabsList>
            <TabsTrigger value="years">Years &amp; Terms</TabsTrigger>
            <TabsTrigger value="classes">Classes &amp; Streams</TabsTrigger>
            <TabsTrigger value="subjects">Subjects</TabsTrigger>
            <TabsTrigger value="timetable">Timetable</TabsTrigger>
            {canRollover && <TabsTrigger value="rollover">Rollover</TabsTrigger>}
          </TabsList>

          <TabsContent value="years">
            <YearsTermsSection years={(years ?? []) as AcademicYearRow[]} terms={(terms ?? []) as TermRow[]} canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="classes">
            <ClassesStreamsSection
              activeYearId={activeYear?.id ?? null}
              activeYearName={activeYear?.name ?? null}
              classes={(classes ?? []).filter((c) => c.academic_year_id === activeYear?.id) as ClassRow[]}
              streams={(streams ?? []) as StreamRow[]}
              teachers={teachers}
              canWrite={canWrite}
            />
          </TabsContent>

          <TabsContent value="subjects">
            <SubjectsSection subjects={(subjects ?? []) as SubjectRow[]} canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="timetable">
            <TimetableSection
              streams={(streams ?? []) as StreamRow[]}
              classes={(classes ?? []) as ClassRow[]}
              subjects={(subjects ?? []) as SubjectRow[]}
              teachers={teachers}
              slots={(timetableSlots ?? []) as TimetableSlotRow[]}
              canWrite={canWrite}
            />
          </TabsContent>

          {canRollover && (
            <TabsContent value="rollover">
              <RolloverSection years={(years ?? []) as AcademicYearRow[]} students={students} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
