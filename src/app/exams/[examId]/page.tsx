import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";

export default async function ExamProgressPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
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
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const { data: exam } = await supabase
    .from("exams")
    .select("id, name, exam_type, status, term_id, terms(name)")
    .eq("id", examId)
    .maybeSingle();
  if (!exam) notFound();
  const termName = (exam.terms as unknown as { name: string } | null)?.name ?? "";

  const [{ data: examClasses }, { data: examSubjects }] = await Promise.all([
    supabase.from("exam_classes").select("class_id, classes(id, name)").eq("exam_id", examId),
    supabase.from("exam_subjects").select("class_id, subject_id, subjects(id, name)").eq("exam_id", examId),
  ]);

  const classIds = (examClasses ?? []).map((c) => c.class_id);
  const classNameById = new Map(
    (examClasses ?? []).map((c) => [c.class_id, (c.classes as unknown as { name: string } | null)?.name ?? ""]),
  );

  const { data: streamRows } = classIds.length
    ? await supabase.from("streams").select("id, class_id").in("class_id", classIds)
    : { data: [] };
  const streamIds = (streamRows ?? []).map((s) => s.id);
  const classByStream = new Map((streamRows ?? []).map((s) => [s.id, s.class_id]));
  const streamsByClass = new Map<string, string[]>();
  for (const s of streamRows ?? []) {
    streamsByClass.set(s.class_id, [...(streamsByClass.get(s.class_id) ?? []), s.id]);
  }

  const [{ data: rosterRows }, { data: markRows }, { data: slotRows }] = await Promise.all([
    streamIds.length
      ? supabase.from("students").select("id, current_class_id").eq("status", "active").in("current_class_id", streamIds)
      : Promise.resolve({ data: [] }),
    supabase.from("marks").select("student_id, subject_id").eq("exam_id", examId),
    streamIds.length
      ? supabase.from("timetable_slots").select("stream_id, subject_id, teacher_id").in("stream_id", streamIds)
      : Promise.resolve({ data: [] }),
  ]);

  const teacherIds = Array.from(new Set((slotRows ?? []).map((s) => s.teacher_id).filter(Boolean)));
  const { data: teacherRows } = teacherIds.length
    ? await supabase.from("school_users").select("id, full_name").in("id", teacherIds)
    : { data: [] };
  const teacherNameById = new Map((teacherRows ?? []).map((t) => [t.id, t.full_name]));

  // Roster size per class (sum of active students across its streams).
  const rosterCountByClass = new Map<string, number>();
  for (const r of rosterRows ?? []) {
    if (!r.current_class_id) continue;
    const classId = classByStream.get(r.current_class_id);
    if (!classId) continue;
    rosterCountByClass.set(classId, (rosterCountByClass.get(classId) ?? 0) + 1);
  }

  // Marks entered per class+subject: resolve each mark's student to a class via their current stream.
  const studentClassMap = new Map((rosterRows ?? []).map((r) => [r.id, r.current_class_id ? classByStream.get(r.current_class_id) : null]));
  const enteredByKey = new Map<string, number>();
  for (const m of markRows ?? []) {
    const classId = studentClassMap.get(m.student_id);
    if (!classId) continue;
    const key = `${classId}__${m.subject_id}`;
    enteredByKey.set(key, (enteredByKey.get(key) ?? 0) + 1);
  }

  // First timetabled teacher per class+subject (a class's streams may have more than one teacher for split subjects — pick the first).
  const teacherByKey = new Map<string, string>();
  for (const slot of slotRows ?? []) {
    const classId = classByStream.get(slot.stream_id);
    if (!classId) continue;
    const key = `${classId}__${slot.subject_id}`;
    if (!teacherByKey.has(key)) {
      const name = teacherNameById.get(slot.teacher_id);
      if (name) teacherByKey.set(key, name);
    }
  }

  const sheets = (examSubjects ?? []).map((es) => {
    const subjectName = (es.subjects as unknown as { name: string } | null)?.name ?? "";
    const className = classNameById.get(es.class_id) ?? "";
    const key = `${es.class_id}__${es.subject_id}`;
    const total = rosterCountByClass.get(es.class_id) ?? 0;
    const entered = Math.min(enteredByKey.get(key) ?? 0, total);
    return {
      key,
      subject: subjectName,
      classroom: className,
      teacher: teacherByKey.get(key) ?? "—",
      entered,
      total,
      classId: es.class_id,
      subjectId: es.subject_id,
    };
  });

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Exams", href: "/exams" },
        { label: exam.name },
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">{exam.name}</h1>
          <p className="text-sm text-muted-foreground">
            {exam.exam_type} {termName ? `· ${termName}` : ""} · {exam.status === "open" ? "Open" : "Closed"}
          </p>
        </div>

        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-[0.8125rem] font-semibold">Marks entry progress</h2>
            <span className="text-[0.6875rem] text-muted-foreground">
              {sheets.length} mark sheet{sheets.length === 1 ? "" : "s"}
            </span>
          </header>
          {sheets.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No classes or subjects have been configured for this exam yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Subject</th>
                    <th>Class</th>
                    <th>Teacher</th>
                    <th className="w-56">Progress</th>
                    <th className="text-right">Entered</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheets.map((s) => {
                    const pct = s.total > 0 ? Math.round((s.entered / s.total) * 100) : 0;
                    const locked = exam.status === "closed";
                    return (
                      <tr key={s.key}>
                        <td className="font-medium">
                          <Link
                            href={`/exams/marks?exam=${exam.id}&class=${s.classId}&subject=${s.subjectId}`}
                            className="hover:underline"
                          >
                            {s.subject}
                          </Link>
                        </td>
                        <td className="text-muted-foreground">{s.classroom}</td>
                        <td className="text-muted-foreground">{s.teacher}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${s.subject} marks entered`}
                            >
                              <div className={pct === 100 ? "h-full bg-success" : "h-full bg-primary"} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[0.6875rem] text-muted-foreground" data-numeric>
                              {pct}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right" data-numeric>
                          {s.entered}/{s.total}
                        </td>
                        <td>
                          {locked ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-px text-[0.6875rem] font-medium leading-5 text-muted-foreground">
                              <Lock className="size-3" aria-hidden /> Locked
                            </span>
                          ) : (
                            <StatusBadge
                              tone={pct === 0 ? "danger" : pct === 100 ? "success" : "warning"}
                              label={pct === 0 ? "Not started" : pct === 100 ? "Complete" : "In progress"}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
