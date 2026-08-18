import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StudentsTable, type StudentRow } from "@/components/students/students-table";

export default async function StudentsPage() {
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

  const { data: students } = await supabase
    .from("students")
    .select("id, admission_number, first_name, last_name, status, current_class_id, streams(name, classes(name))")
    .order("last_name");

  const { data: primaryGuardians } = await supabase
    .from("student_guardians")
    .select("student_id, school_users(full_name)")
    .eq("primary_contact", true);

  const guardianByStudent = new Map<string, string>();
  for (const g of primaryGuardians ?? []) {
    const name = (g.school_users as unknown as { full_name: string } | null)?.full_name;
    if (name) guardianByStudent.set(g.student_id as string, name);
  }

  const rows: StudentRow[] = (students ?? []).map((s) => {
    const stream = s.streams as unknown as { name: string; classes: { name: string } | null } | null;
    const classLabel = stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : null;
    return {
      id: s.id,
      admission_number: s.admission_number,
      full_name: `${s.first_name} ${s.last_name}`,
      status: s.status,
      class_label: classLabel,
      guardian_name: guardianByStudent.get(s.id) ?? null,
    };
  });

  const roleName =
    (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Students" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Students</h1>
            <p className="text-sm text-muted-foreground">{rows.length} total</p>
          </div>
          {/* Students has no student-creation entry point of its own -- a real,
              live bug (phase-25 audit) came from a duplicate "Register student"
              path here that inserted directly into `students`, bypassing the
              entire Admissions pipeline. New students exist because an
              application was admitted; this page only ever displays that
              result, and the only way to start one is /admissions. */}
          <Link href="/admissions" className="text-sm text-primary underline underline-offset-2">
            Add a student via Admissions →
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No students in this school yet.
          </div>
        ) : (
          <StudentsTable rows={rows} />
        )}
      </div>
    </AppShell>
  );
}
