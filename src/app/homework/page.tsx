import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { HomeworkSection, type AssignmentRow, type StreamOption, type SubjectOption } from "@/components/homework/homework-section";

export default async function HomeworkPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteAny }, { data: streams }, { data: subjects }, { data: assignmentRows }] =
    await Promise.all([
      supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
      supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
      supabase.from("streams").select("id, name, classes(name)").order("name"),
      supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("assignments")
        .select("id, title, description, due_date, stream_id, subject_id, teacher_id, streams(name, classes(name)), subjects(name), assignment_submissions(id, status)")
        .order("due_date", { ascending: false }),
    ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const streamOptions: StreamOption[] = (streams ?? []).map((s) => ({
    id: s.id,
    label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
  }));
  const subjectOptions: SubjectOption[] = (subjects ?? []).map((s) => ({ id: s.id, name: s.name }));

  const assignments: AssignmentRow[] = (assignmentRows ?? []).map((a) => {
    const stream = a.streams as unknown as { name: string; classes: { name: string } | null } | null;
    const subject = a.subjects as unknown as { name: string } | null;
    const submissions = (a.assignment_submissions ?? []) as { id: string; status: string }[];
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      due_date: a.due_date,
      stream_id: a.stream_id,
      stream_label: stream ? `${stream.classes?.name ?? ""} ${stream.name}`.trim() : "—",
      subject_id: a.subject_id,
      subject_name: subject?.name ?? "—",
      teacher_id: a.teacher_id,
      is_own: a.teacher_id === schoolUser?.id,
      submitted_count: submissions.length,
      graded_count: submissions.filter((s) => s.status === "graded").length,
    };
  });

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Homework" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Homework</h1>
          <p className="text-sm text-muted-foreground">
            {canWriteAny ? "Assignments across the school." : "Assignments you've set and their submissions."}
          </p>
        </div>
        <HomeworkSection
          assignments={assignments}
          streams={streamOptions}
          subjects={subjectOptions}
          schoolUserId={schoolUser?.id ?? null}
          canWriteAny={canWriteAny === true}
        />
      </div>
    </AppShell>
  );
}
