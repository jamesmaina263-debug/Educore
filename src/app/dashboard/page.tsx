import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { SummaryStatStrip } from "@/components/dashboard/summary-stat-strip";
import { StaffDirectoryTable, type StaffRow } from "@/components/dashboard/staff-directory-table";
import {
  EnrollmentWidget,
  AdmissionsWidget,
  AttendanceWidget,
  AcademicsWidget,
  ExamsWidget,
  FinanceWidget,
  type EnrollmentSummary,
  type AttendanceSummary,
  type AcademicsSummary,
  type ExamsSummary,
  type FinanceSummary,
} from "@/components/dashboard/module-widgets";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS scopes this to the caller's own row (or all rows, for super_admin) —
  // no manual school_id filter needed here, by design (§6).
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("id, full_name, status, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Directory of colleagues in the same school — again, RLS does the
  // tenant scoping; this query never touches school_id directly.
  const { data: staffRows } = await supabase
    .from("school_users")
    .select("id, full_name, status, email, roles(display_name)")
    .order("full_name");

  const [
    { data: canSeeStudents },
    { data: canSeeAcademics },
    { data: canSeeAttendance },
    { data: canMarkAny },
    { data: canReviewAdmissions },
    { data: canSeeExams },
    { data: canSeeFinance },
  ] = await Promise.all([
    supabase.rpc("auth_has_permission", { p_permission_key: "students.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.mark_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "exams.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
  ]);

  let enrollment: EnrollmentSummary | null = null;
  if (canSeeStudents) {
    const { data: statusRows } = await supabase.from("students").select("status");
    const counts = { total: 0, active: 0, applied: 0, approved: 0, enrolled: 0 };
    for (const s of statusRows ?? []) {
      counts.total += 1;
      if (s.status === "active") counts.active += 1;
      if (s.status === "applied") counts.applied += 1;
      if (s.status === "approved") counts.approved += 1;
      if (s.status === "enrolled") counts.enrolled += 1;
    }
    enrollment = counts;
  }

  let academics: AcademicsSummary | null = null;
  if (canSeeAcademics) {
    const [{ data: activeYear }, { data: classCount }, { data: streamCount }, { data: subjectCount }] =
      await Promise.all([
        supabase
          .from("academic_years")
          .select("name, terms(name, status)")
          .eq("status", "active")
          .maybeSingle(),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("streams").select("id", { count: "exact", head: true }),
        supabase.from("subjects").select("id", { count: "exact", head: true }),
      ]);
    const activeTerm = (activeYear?.terms as unknown as { name: string; status: string }[] | null)?.find(
      (t) => t.status === "active",
    );
    academics = {
      yearName: activeYear?.name ?? null,
      termName: activeTerm?.name ?? null,
      classCount: (classCount as unknown as { count: number } | null)?.count ?? 0,
      streamCount: (streamCount as unknown as { count: number } | null)?.count ?? 0,
      subjectCount: (subjectCount as unknown as { count: number } | null)?.count ?? 0,
    };
  }

  let attendance: AttendanceSummary | null = null;
  if (canSeeAttendance) {
    const today = todayISO();
    let streamIds: string[] = [];
    if (canMarkAny) {
      const { data: allStreams } = await supabase.from("streams").select("id");
      streamIds = (allStreams ?? []).map((s) => s.id);
    } else {
      const { data: myStreams } = await supabase
        .from("streams")
        .select("id")
        .eq("class_teacher_id", schoolUser?.id ?? "");
      streamIds = (myStreams ?? []).map((s) => s.id);
    }

    if (streamIds.length === 0) {
      attendance = { scope: "none", marked: 0, roster: 0 };
    } else {
      const [{ count: roster }, { count: marked }] = await Promise.all([
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .in("current_class_id", streamIds),
        supabase
          .from("student_attendance")
          .select("id", { count: "exact", head: true })
          .eq("attendance_date", today)
          .in("stream_id", streamIds),
      ]);
      attendance = { scope: canMarkAny ? "school_wide" : "own_class", marked: marked ?? 0, roster: roster ?? 0 };
    }
  }

  let exams: ExamsSummary | null = null;
  if (canSeeExams) {
    const { data: examStatusRows } = await supabase.from("exams").select("status");
    const counts = { open: 0, closed: 0 };
    for (const e of examStatusRows ?? []) {
      if (e.status === "open") counts.open += 1;
      else counts.closed += 1;
    }
    exams = counts;
  }

  let finance: FinanceSummary | null = null;
  if (canSeeFinance) {
    const [{ data: balanceRows }, { data: pendingDiscountRows }, { data: pendingExpenseRows }] = await Promise.all([
      supabase.from("v_student_balances").select("balance"),
      supabase.from("discounts").select("id").eq("status", "pending"),
      supabase.from("expenses").select("id").eq("status", "pending"),
    ]);
    const totalOutstanding = (balanceRows ?? []).reduce((sum, b) => sum + Math.max(0, Number(b.balance)), 0);
    finance = {
      totalOutstanding,
      pendingDiscounts: (pendingDiscountRows ?? []).length,
      pendingExpenses: (pendingExpenseRows ?? []).length,
    };
  }

  const rows: StaffRow[] = (staffRows ?? []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    role:
      (r.roles as unknown as { display_name: string } | null)?.display_name ?? "—",
    status: r.status,
    email: r.email,
  }));

  const roleName =
    (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName =
    (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore" }, { label: "Dashboard" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {schoolName ? `${schoolName} — ` : ""}
            operational overview
          </p>
        </div>

        <SummaryStatStrip
          stats={[
            { label: "Staff", value: String(rows.length) },
            {
              label: "Active",
              value: String(rows.filter((r) => r.status === "active").length),
            },
            {
              label: "Inactive",
              value: String(rows.filter((r) => r.status !== "active").length),
            },
            { label: "Your role", value: roleName ?? "—" },
          ]}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {enrollment && <EnrollmentWidget data={enrollment} />}
          {enrollment && canReviewAdmissions === true && <AdmissionsWidget data={enrollment} />}
          {attendance && <AttendanceWidget data={attendance} />}
          {academics && <AcademicsWidget data={academics} />}
          {exams && <ExamsWidget data={exams} />}
          {finance && <FinanceWidget data={finance} />}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Staff directory</h2>
          <StaffDirectoryTable rows={rows} />
        </div>
      </div>
    </AppShell>
  );
}
