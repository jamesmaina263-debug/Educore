import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { RegisterForm, type RosterRow } from "@/components/attendance/register-form";
import { StreamPicker } from "@/components/attendance/stream-picker";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ stream?: string; date?: string }>;
}) {
  const { stream: streamParam, date: dateParam } = await searchParams;
  const attendanceDate = dateParam || todayISO();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canMarkAny }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.mark_any" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  // Streams this user can pick from: their own (as class teacher), or — for
  // principal/deputy/owner — every stream in the school.
  const streamQuery = canMarkAny
    ? supabase.from("streams").select("id, name, classes(name)")
    : supabase.from("streams").select("id, name, classes(name)").eq("class_teacher_id", schoolUser?.id ?? "");
  const { data: availableStreams } = await streamQuery;

  const streamOptions = (availableStreams ?? []).map((s) => ({
    id: s.id,
    label: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
  }));

  const selectedStreamId = streamParam || streamOptions[0]?.id || null;

  let roster: RosterRow[] = [];
  if (selectedStreamId) {
    const [{ data: students }, { data: existingRecords }] = await Promise.all([
      supabase
        .from("students")
        .select("id, first_name, last_name")
        .eq("current_class_id", selectedStreamId)
        .eq("status", "active")
        .order("last_name"),
      supabase
        .from("student_attendance")
        .select("id, student_id, status")
        .eq("stream_id", selectedStreamId)
        .eq("attendance_date", attendanceDate),
    ]);

    const existingByStudent = new Map<string, NonNullable<RosterRow["existing"]>>(
      (existingRecords ?? []).map((r) => [
        r.student_id,
        { record_id: r.id, status: r.status as "present" | "absent" | "late" },
      ]),
    );

    roster = (students ?? []).map((s) => ({
      student_id: s.id,
      full_name: `${s.first_name} ${s.last_name}`,
      existing: existingByStudent.get(s.id) ?? null,
    }));
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Attendance" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Attendance</h1>
            <p className="text-sm text-muted-foreground">{attendanceDate}</p>
          </div>

          {streamOptions.length > 1 && selectedStreamId && (
            <StreamPicker options={streamOptions} value={selectedStreamId} date={attendanceDate} />
          )}
        </div>

        {!selectedStreamId ? (
          <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have a class assigned to mark attendance for.
          </p>
        ) : (
          <RegisterForm streamId={selectedStreamId} attendanceDate={attendanceDate} roster={roster} canMark={true} />
        )}
      </div>
    </AppShell>
  );
}

