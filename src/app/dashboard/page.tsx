import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, CalendarCheck, Plus, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  AttendanceByClassChart,
  CollectionTrendChart,
  EnrollmentTrendChart,
} from "@/components/dashboard/dashboard-charts";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

function invoiceTone(status: string) {
  return status === "paid" ? "success" : status === "partially_paid" ? "info" : "neutral";
}

/** Buckets a date range into ~weekly windows, capped at "today" if the range extends into the future. */
function weekBuckets(start: string, end: string) {
  const startDate = new Date(start);
  const today = new Date(todayISO());
  const cappedEnd = new Date(Math.min(new Date(end).getTime(), today.getTime()));
  if (cappedEnd <= startDate) return [] as { label: string; start: Date; end: Date }[];
  const buckets: { label: string; start: Date; end: Date }[] = [];
  let cursor = new Date(startDate);
  let week = 1;
  while (cursor < cappedEnd) {
    const bucketEnd = new Date(Math.min(cursor.getTime() + 7 * 86400000, cappedEnd.getTime() + 86400000));
    buckets.push({ label: `Wk ${week}`, start: new Date(cursor), end: bucketEnd });
    cursor = bucketEnd;
    week += 1;
  }
  return buckets;
}

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="panel flex flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">{title}</h2>
        {meta && <span className="text-[0.6875rem] text-muted-foreground">{meta}</span>}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: schoolUser },
    { data: canSeeStudents },
    { data: canSeeAttendance },
    { data: canMarkAny },
    { data: canSeeFinance },
    { data: canRecordPayment },
  ] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, status, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "students.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "attendance.mark_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.write" }),
  ]);
  void canMarkAny;

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const today = todayISO();

  const { data: activeTerm } = await supabase
    .from("terms")
    .select("id, academic_year_id, name, term_number, start_date, end_date, status")
    .eq("status", "active")
    .maybeSingle();

  const { data: recentTerms } = await supabase
    .from("terms")
    .select("id, name, term_number, start_date, end_date")
    .order("start_date", { ascending: true });
  const last5Terms = (recentTerms ?? []).slice(-5);

  // --- Students (enrolled count + admission-date trend) ---
  let enrolledCount = 0;
  let admittedThisTerm = 0;
  let enrollmentTrend: { term: string; students: number }[] = [];
  let students: { id: string; status: string; current_class_id: string | null; admission_date: string | null }[] = [];
  if (canSeeStudents) {
    const { data } = await supabase.from("students").select("id, status, current_class_id, admission_date");
    students = data ?? [];
    enrolledCount = students.filter((s) => s.status === "active").length;
    if (activeTerm) {
      admittedThisTerm = students.filter(
        (s) => s.admission_date && s.admission_date >= activeTerm.start_date && s.admission_date <= activeTerm.end_date,
      ).length;
    }
    enrollmentTrend = last5Terms.map((t) => ({
      term: t.name,
      students: students.filter((s) => s.admission_date && s.admission_date >= t.start_date && s.admission_date <= t.end_date)
        .length,
    }));
  }

  // --- Attendance (today's rate + per-stream breakdown) ---
  let attendanceRate = 0;
  let presentToday = 0;
  let rosterToday = 0;
  let unmarkedStreamCount = 0;
  let totalStreamCount = 0;
  let attendanceByClass: { classroom: string; rate: number }[] = [];
  if (canSeeAttendance) {
    const { data: streams } = await supabase.from("streams").select("id, name, classes(name)");
    const { data: todaysAttendance } = await supabase
      .from("student_attendance")
      .select("student_id, stream_id, status")
      .eq("attendance_date", today)
      .eq("session", "class");

    const rosterSource = canSeeStudents
      ? students
      : ((await supabase.from("students").select("current_class_id, status")).data ?? []).map((s) => ({
          id: "",
          status: s.status,
          current_class_id: s.current_class_id,
          admission_date: null,
        }));

    totalStreamCount = (streams ?? []).length;
    const markedStreamIds = new Set((todaysAttendance ?? []).map((a) => a.stream_id));
    unmarkedStreamCount = totalStreamCount - markedStreamIds.size;

    const rosterByStream = new Map<string, number>();
    for (const s of rosterSource) {
      if (s.status !== "active" || !s.current_class_id) continue;
      rosterByStream.set(s.current_class_id, (rosterByStream.get(s.current_class_id) ?? 0) + 1);
    }
    rosterToday = Array.from(rosterByStream.values()).reduce((a, b) => a + b, 0);

    const presentByStream = new Map<string, number>();
    for (const a of todaysAttendance ?? []) {
      if (a.status === "present" || a.status === "late") {
        presentByStream.set(a.stream_id, (presentByStream.get(a.stream_id) ?? 0) + 1);
      }
    }
    presentToday = Array.from(presentByStream.values()).reduce((a, b) => a + b, 0);
    attendanceRate = rosterToday > 0 ? Math.round((presentToday / rosterToday) * 1000) / 10 : 0;

    attendanceByClass = (streams ?? []).map((s) => {
      const roster = rosterByStream.get(s.id) ?? 0;
      const present = presentByStream.get(s.id) ?? 0;
      const className = (s.classes as unknown as { name: string } | null)?.name ?? "";
      return {
        classroom: `${className} ${s.name}`.trim(),
        rate: roster > 0 ? Math.round((present / roster) * 1000) / 10 : 0,
      };
    });
  }

  // --- Finance (term collection trend, outstanding balance, latest invoices) ---
  let collected = 0;
  let invoicedThisTerm = 0;
  let collectionTrend: { week: string; invoiced: number; collected: number }[] = [];
  let totalOutstanding = 0;
  let studentsWithBalance = 0;
  let latestInvoices: { id: string; student: string; amount: number; status: string }[] = [];
  let pendingDiscounts = 0;
  let pendingExpenses = 0;
  if (canSeeFinance) {
    const [{ data: balanceRows }, { data: invoiceRows }, { data: paymentRows }, { data: discountRows }, { data: expenseRows }] =
      await Promise.all([
        supabase.from("v_student_balances").select("balance"),
        supabase
          .from("invoices")
          .select("id, total_amount, status, created_at, term_id, students(first_name, last_name)")
          .order("created_at", { ascending: false }),
        supabase.from("payments").select("amount, recorded_at"),
        supabase.from("discounts").select("id").eq("status", "pending"),
        supabase.from("expenses").select("id").eq("status", "pending"),
      ]);

    totalOutstanding = (balanceRows ?? []).reduce((sum, b) => sum + Math.max(0, Number(b.balance)), 0);
    studentsWithBalance = (balanceRows ?? []).filter((b) => Number(b.balance) > 0).length;
    pendingDiscounts = (discountRows ?? []).length;
    pendingExpenses = (expenseRows ?? []).length;

    latestInvoices = (invoiceRows ?? []).slice(0, 6).map((inv) => {
      const s = inv.students as unknown as { first_name: string; last_name: string } | null;
      return {
        id: inv.id,
        student: `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim(),
        amount: Number(inv.total_amount),
        status: inv.status,
      };
    });

    if (activeTerm) {
      invoicedThisTerm = (invoiceRows ?? [])
        .filter((inv) => inv.term_id === activeTerm.id)
        .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
      collected = (paymentRows ?? [])
        .filter((p) => p.recorded_at >= activeTerm.start_date && p.recorded_at <= activeTerm.end_date)
        .reduce((sum, p) => sum + Number(p.amount), 0);

      const buckets = weekBuckets(activeTerm.start_date, activeTerm.end_date);
      collectionTrend = buckets.map((b) => {
        const bucketInvoiced = (invoiceRows ?? [])
          .filter(
            (inv) => inv.term_id === activeTerm.id && new Date(inv.created_at) >= b.start && new Date(inv.created_at) < b.end,
          )
          .reduce((sum, inv) => sum + Number(inv.total_amount), 0);
        const bucketCollected = (paymentRows ?? [])
          .filter((p) => new Date(p.recorded_at) >= b.start && new Date(p.recorded_at) < b.end)
          .reduce((sum, p) => sum + Number(p.amount), 0);
        return {
          week: b.label,
          invoiced: Math.round(bucketInvoiced / 1000) / 1000,
          collected: Math.round(bucketCollected / 1000) / 1000,
        };
      });
    }
  }

  const collectedPct = invoicedThisTerm > 0 ? Math.round((collected / invoicedThisTerm) * 1000) / 10 : 0;

  const metrics = [
    canSeeStudents && {
      label: "Enrolled students",
      value: String(enrolledCount),
      delta: `+${admittedThisTerm}`,
      up: true,
      note: activeTerm ? `admitted ${activeTerm.name}` : "this term",
    },
    canSeeFinance && {
      label: "Fees collected (term)",
      value: kes(collected),
      delta: `${collectedPct}%`,
      up: collectedPct >= 50,
      note: `of ${kes(invoicedThisTerm)} invoiced`,
    },
    canSeeAttendance && {
      label: "Attendance today",
      value: `${attendanceRate}%`,
      delta: attendanceRate >= 90 ? "On target" : "Below target",
      up: attendanceRate >= 90,
      note: `${presentToday} of ${rosterToday} present`,
    },
    canSeeFinance && {
      label: "Outstanding balance",
      value: kes(totalOutstanding),
      delta: `${studentsWithBalance} students`,
      up: false,
      note: "with a balance owing",
    },
  ].filter(Boolean) as { label: string; value: string; delta: string; up: boolean; note: string }[];

  const tasks = [
    canSeeAttendance &&
      unmarkedStreamCount > 0 && {
        label: `${unmarkedStreamCount} of ${totalStreamCount} classes haven't submitted attendance`,
        owner: "Class teachers",
        tone: "danger" as const,
        badge: "Overdue",
      },
    canSeeFinance &&
      pendingDiscounts > 0 && {
        label: `${pendingDiscounts} fee discount request${pendingDiscounts === 1 ? "" : "s"} awaiting approval`,
        owner: "Bursar office",
        tone: "info" as const,
        badge: "Pending",
      },
    canSeeFinance &&
      pendingExpenses > 0 && {
        label: `${pendingExpenses} expense claim${pendingExpenses === 1 ? "" : "s"} awaiting approval`,
        owner: "Bursar office",
        tone: "warning" as const,
        badge: "Pending",
      },
  ].filter(Boolean) as { label: string; owner: string; tone: "danger" | "warning" | "info"; badge: string }[];

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Dashboard" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {schoolName ? `${schoolName} · ` : ""}
              {activeTerm ? activeTerm.name : "No active term"}
            </p>
          </div>
          {canRecordPayment && (
            <Link href="/finance">
              <Button size="sm">
                <Plus className="size-4" aria-hidden /> Record payment
              </Button>
            </Link>
          )}
        </div>

        {metrics.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.label} className="panel px-4 py-3">
                <p className="label-eyebrow">{m.label}</p>
                <p className="mt-1.5 text-2xl font-semibold tracking-tight" data-numeric>
                  {m.value}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                  <span
                    className={
                      m.up
                        ? "inline-flex items-center gap-0.5 font-medium text-success"
                        : "inline-flex items-center gap-0.5 font-medium text-warning"
                    }
                  >
                    {m.up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                    {m.delta}
                  </span>
                  {m.note}
                </p>
              </div>
            ))}
          </div>
        )}

        {(canSeeFinance || canSeeAttendance) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {canSeeFinance && (
              <div className="lg:col-span-2">
                <Panel title="Fee collection vs. invoiced" meta="KES thousands · this term">
                  {collectionTrend.length > 0 ? (
                    <CollectionTrendChart data={collectionTrend} />
                  ) : (
                    <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">No data yet for the active term.</p>
                  )}
                </Panel>
              </div>
            )}
            {canSeeAttendance && (
              <div className={canSeeFinance ? "" : "lg:col-span-3"}>
                <Panel title="Attendance rate by class" meta="Today">
                  {attendanceByClass.length > 0 ? (
                    <AttendanceByClassChart data={attendanceByClass} />
                  ) : (
                    <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">No streams found.</p>
                  )}
                </Panel>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {canSeeStudents && (
            <Panel title="Enrollment trend" meta="Last 5 terms">
              {enrollmentTrend.length > 0 ? (
                <EnrollmentTrendChart data={enrollmentTrend} />
              ) : (
                <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">No term data yet.</p>
              )}
            </Panel>
          )}

          <Panel title="Requires your attention" meta={`${tasks.length} item${tasks.length === 1 ? "" : "s"}`}>
            {tasks.length > 0 ? (
              <ul className="-my-1 divide-y divide-border">
                {tasks.map((t) => (
                  <li key={t.label} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[0.8125rem] font-medium">{t.label}</p>
                      <p className="text-[0.6875rem] text-muted-foreground">{t.owner}</p>
                    </div>
                    <StatusBadge tone={t.tone} label={t.badge} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">Nothing needs attention right now.</p>
            )}
          </Panel>

          {canSeeFinance && (
            <Panel title="Latest invoices" meta={activeTerm?.name}>
              {latestInvoices.length > 0 ? (
                <div className="-mx-4 -my-4 overflow-x-auto">
                  <table className="table-dense w-full">
                    <thead className="bg-muted/60">
                      <tr>
                        <th>Student</th>
                        <th className="text-right">Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="max-w-[10rem] truncate">{inv.student}</td>
                          <td className="text-right" data-numeric>
                            {kes(inv.amount)}
                          </td>
                          <td>
                            <StatusBadge tone={invoiceTone(inv.status)} label={inv.status.replace("_", " ")} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-8 text-center text-[0.8125rem] text-muted-foreground">No invoices yet.</p>
              )}
            </Panel>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {canSeeAttendance && (
            <Link href="/attendance" className="panel-interactive flex items-center gap-3 px-4 py-3">
              <span className="grid size-8 place-items-center rounded-md bg-primary-subtle text-primary">
                <CalendarCheck className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[0.8125rem] font-medium">Mark today&apos;s attendance</p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {unmarkedStreamCount} of {totalStreamCount} classes still pending
                </p>
              </div>
            </Link>
          )}
          {canSeeFinance && (
            <Link href="/finance" className="panel-interactive flex items-center gap-3 px-4 py-3">
              <span className="grid size-8 place-items-center rounded-md bg-primary-subtle text-primary">
                <Wallet className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[0.8125rem] font-medium">Review outstanding balances</p>
                <p className="text-[0.6875rem] text-muted-foreground">{studentsWithBalance} students with a balance owing</p>
              </div>
            </Link>
          )}
        </div>
      </div>
    </AppShell>
  );
}
