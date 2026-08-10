import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  EnrollmentTrendCard,
  FeeCollectionCard,
  AttendanceTrendCard,
  AtRiskTable,
  TransportCapacityCard,
  type EnrollmentMonth,
  type FeeForecast,
  type AtRiskRow,
  type AttendanceTrendDay,
  type TransportRouteCapacityRow,
} from "@/components/reports/reports-section";

function monthLabel(d: Date) {
  return d.toLocaleString("en-US", { month: "short" });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function ReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canSeeReports }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "reports.read" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let enrollmentMonths: EnrollmentMonth[] = [];
  let feeForecast: FeeForecast | null = null;
  let atRiskRows: AtRiskRow[] = [];
  let attendanceDays: AttendanceTrendDay[] = [];
  let transportRoutes: TransportRouteCapacityRow[] = [];

  if (canSeeReports) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const [{ data: admissionRows }, { data: forecastRows }, { data: riskRows }, { data: attendanceRows }, { data: transportRows }] =
      await Promise.all([
        supabase.from("students").select("admission_date").gte("admission_date", isoDate(sixMonthsAgo)),
        supabase
          .from("v_fee_collection_forecast")
          .select("term_name, total_invoiced, total_collected, current_collection_rate_pct, projected_collection_rate_pct")
          .maybeSingle(),
        supabase
          .from("v_at_risk_students")
          .select(
            "student_id, first_name, last_name, admission_number, attendance_rate_30d, latest_exam_average, overdue_balance, risk_score, risk_reasons",
          )
          .order("risk_score", { ascending: false }),
        supabase
          .from("student_attendance")
          .select("attendance_date, status")
          .gte("attendance_date", isoDate(new Date(new Date().getTime() - 6 * 24 * 60 * 60 * 1000))),
        supabase.from("v_transport_route_capacity").select("route_id, route_name, capacity, allocated, available").order("route_name"),
      ]);

    // Bucket admissions by month, oldest to newest, 6-month window.
    const buckets = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(sixMonthsAgo);
      d.setMonth(d.getMonth() + i);
      buckets.set(`${d.getFullYear()}-${d.getMonth()}`, 0);
    }
    for (const row of admissionRows ?? []) {
      const d = new Date(row.admission_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    enrollmentMonths = Array.from(buckets.entries()).map(([key, count]) => {
      const [y, m] = key.split("-").map(Number);
      return { month: monthLabel(new Date(y, m, 1)), count };
    });

    feeForecast = forecastRows
      ? {
          term_name: forecastRows.term_name,
          total_invoiced: Number(forecastRows.total_invoiced),
          total_collected: Number(forecastRows.total_collected),
          current_collection_rate_pct: forecastRows.current_collection_rate_pct,
          projected_collection_rate_pct: forecastRows.projected_collection_rate_pct,
        }
      : null;

    atRiskRows = (riskRows ?? []) as AtRiskRow[];

    const dayBuckets = new Map<string, { present: number; total: number }>();
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayBuckets.set(isoDate(d), { present: 0, total: 0 });
    }
    for (const row of attendanceRows ?? []) {
      const bucket = dayBuckets.get(row.attendance_date);
      if (!bucket) continue;
      bucket.total += 1;
      if (row.status === "present") bucket.present += 1;
    }
    attendanceDays = Array.from(dayBuckets.entries()).map(([date, v]) => ({ date, ...v }));

    transportRoutes = (transportRows ?? []).map((r) => ({
      route_id: r.route_id,
      route_name: r.route_name,
      capacity: r.capacity,
      allocated: r.allocated,
      available: r.available,
    }));
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Reports" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Management reports</h1>
          <p className="text-sm text-muted-foreground">
            {schoolName ? `${schoolName} — ` : ""}
            cross-module overview
          </p>
        </div>

        {!canSeeReports ? (
          <p className="text-sm text-muted-foreground">
            Reports are available to the School Owner and Principal.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <EnrollmentTrendCard months={enrollmentMonths} />
              <FeeCollectionCard forecast={feeForecast} />
              <AttendanceTrendCard days={attendanceDays} />
              <TransportCapacityCard routes={transportRoutes} />
            </div>
            <AtRiskTable rows={atRiskRows} />
            <p className="text-xs text-muted-foreground">
              A mobile app is deferred per the blueprint (Phase 4: &quot;if usage justifies it&quot;) —
              no usage signal exists yet to justify building one.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
