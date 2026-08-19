import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { RegisterForm, type RosterRow } from "@/components/attendance/register-form";
import { StreamPicker } from "@/components/attendance/stream-picker";
import { PendingCorrectionsPanel, type PendingCorrectionRow } from "@/components/attendance/pending-corrections-panel";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatLongDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

  const [{ data: schoolUser }, { data: canMarkAny }, { data: canMark }, { data: canApproveCorrection }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.mark_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.mark" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.approve_correction" }),
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
  const selectedStreamLabel = streamOptions.find((s) => s.id === selectedStreamId)?.label;

  const { data: activeTerm } = await supabase
    .from("terms")
    .select("id, start_date, end_date")
    .eq("status", "active")
    .maybeSingle();

  let roster: RosterRow[] = [];
  if (selectedStreamId) {
    const [{ data: students }, { data: existingRecords }] = await Promise.all([
      supabase
        .from("students")
        .select("id, admission_number, first_name, last_name")
        .eq("current_class_id", selectedStreamId)
        .eq("status", "active")
        .order("last_name"),
      supabase
        .from("student_attendance")
        .select("id, student_id, status")
        .eq("stream_id", selectedStreamId)
        .eq("attendance_date", attendanceDate)
        .eq("session", "class"),
    ]);

    const studentIds = (students ?? []).map((s) => s.id);
    let termRateByStudent = new Map<string, number>();
    if (activeTerm && studentIds.length > 0) {
      const { data: termRecords } = await supabase
        .from("student_attendance")
        .select("student_id, status")
        .in("student_id", studentIds)
        .eq("session", "class")
        .gte("attendance_date", activeTerm.start_date)
        .lte("attendance_date", activeTerm.end_date);

      const totalsByStudent = new Map<string, { present: number; total: number }>();
      for (const r of termRecords ?? []) {
        const t = totalsByStudent.get(r.student_id) ?? { present: 0, total: 0 };
        t.total += 1;
        if (r.status === "present" || r.status === "late") t.present += 1;
        totalsByStudent.set(r.student_id, t);
      }
      termRateByStudent = new Map(
        Array.from(totalsByStudent.entries()).map(([id, t]) => [id, t.total > 0 ? Math.round((t.present / t.total) * 1000) / 10 : 0]),
      );
    }

    const existingByStudent = new Map<string, NonNullable<RosterRow["existing"]>>(
      (existingRecords ?? []).map((r) => [
        r.student_id,
        { record_id: r.id, status: r.status as "present" | "absent" | "late" },
      ]),
    );

    roster = (students ?? []).map((s) => ({
      student_id: s.id,
      admission_number: s.admission_number,
      full_name: `${s.first_name} ${s.last_name}`,
      term_attendance_rate: termRateByStudent.get(s.id) ?? null,
      existing: existingByStudent.get(s.id) ?? null,
    }));
  }

  const submittedCount = roster.filter((r) => r.existing).length;
  const submissionStatus =
    roster.length === 0
      ? null
      : submittedCount === 0
        ? "Not yet submitted"
        : submittedCount === roster.length
          ? "Fully submitted"
          : `Partially submitted (${submittedCount} of ${roster.length})`;

  let pendingCorrections: PendingCorrectionRow[] = [];
  if (canApproveCorrection) {
    // Mirrors the streamQuery split above: mark_any holders (deputy/
    // principal/owner) can approve any stream's corrections and should see
    // the school-wide queue; a class_teacher's approve_correction only
    // reaches their own stream per RLS (student_attendance_approve_own_class),
    // so scope the list the same way -- otherwise they'd see every other
    // class's disputed corrections (names, reasons, who requested them) with
    // no way to act on any of them.
    let correctionsQuery = supabase
      .from("student_attendance")
      .select("id, attendance_date, requested_status, correction_reason, students(first_name, last_name), school_users!student_attendance_requested_by_fkey(full_name)")
      .eq("correction_status", "pending")
      .order("attendance_date", { ascending: false })
      .limit(50);
    if (!canMarkAny) {
      correctionsQuery = correctionsQuery.in(
        "stream_id",
        (availableStreams ?? []).map((s) => s.id),
      );
    }
    const { data: correctionRows } = await correctionsQuery;
    pendingCorrections = (correctionRows ?? []).map((c) => {
      const st = c.students as unknown as { first_name: string; last_name: string } | null;
      return {
        id: c.id,
        student_name: st ? `${st.first_name} ${st.last_name}` : "Unknown",
        attendance_date: c.attendance_date,
        requested_status: c.requested_status ?? "—",
        correction_reason: c.correction_reason ?? "",
        requested_by_name: (c.school_users as unknown as { full_name: string } | null)?.full_name ?? null,
      };
    });
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Attendance", href: selectedStreamId ? "/attendance" : undefined },
        ...(selectedStreamLabel ? [{ label: selectedStreamLabel }] : []),
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Attendance</h1>
            <p className="text-sm text-muted-foreground">
              {formatLongDate(attendanceDate)}
              {submissionStatus ? ` · ${submissionStatus}` : ""}
            </p>
          </div>
          {streamOptions.length > 1 && selectedStreamId && (
            <StreamPicker options={streamOptions} value={selectedStreamId} date={attendanceDate} />
          )}
        </div>

        {!selectedStreamId ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have a class assigned to mark attendance for.
          </p>
        ) : (
          <RegisterForm streamId={selectedStreamId} attendanceDate={attendanceDate} roster={roster} canMark={!!canMark || !!canMarkAny} />
        )}

        {canApproveCorrection && <PendingCorrectionsPanel corrections={pendingCorrections} />}
      </div>
    </AppShell>
  );
}
