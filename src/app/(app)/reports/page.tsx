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
import { ReportsFilterBar } from "@/components/reports/reports-filter-bar";
import { ReportsExportMenu, type ReportExportData } from "@/components/reports/reports-export-menu";
import { CampusSummaryTable, type CampusSummaryRow } from "@/components/campuses/campus-summary-table";
import { CampusFilterSelect } from "@/components/reports/reports-campus-filter";

function monthLabel(d: Date) {
  return d.toLocaleString("en-US", { month: "short" });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string; stream?: string; from?: string; to?: string; campus?: string }>;
}) {
  const { term: termParam, stream: streamParam, from: fromParam, to: toParam, campus: campusParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canSeeReports }, { data: groupId }] = await Promise.all([
    supabase
      .from("school_users")
      .select("id, full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "reports.read" }),
    supabase.rpc("auth_group_id"),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const isGroupAdmin = Boolean(groupId);

  // ---- Cross-campus panel (group_admin only) — extends Phase 5's group_schools_summary(),
  // now with an optional campus filter, rather than building a second reporting engine. ----
  let campusRows: CampusSummaryRow[] = [];
  let campusOptions: { id: string; name: string }[] = [];
  if (isGroupAdmin) {
    const [{ data: allCampuses }, { data: filtered }] = await Promise.all([
      supabase.rpc("group_schools_summary"),
      campusParam ? supabase.rpc("group_schools_summary", { p_school_id: campusParam }) : Promise.resolve({ data: null }),
    ]);
    campusOptions = ((allCampuses ?? []) as CampusSummaryRow[]).map((r) => ({ id: r.school_id, name: r.school_name }));
    campusRows = campusParam ? ((filtered ?? []) as CampusSummaryRow[]) : ((allCampuses ?? []) as CampusSummaryRow[]);
  }

  // ---- Single-school detailed report (reports.read holders) ----
  let enrollmentMonths: EnrollmentMonth[] = [];
  let feeForecast: FeeForecast | null = null;
  let atRiskRows: AtRiskRow[] = [];
  let attendanceDays: AttendanceTrendDay[] = [];
  let attendanceExportDays: { date: string; present: number; absent: number; late: number; total: number }[] = [];
  let transportRoutes: TransportRouteCapacityRow[] = [];
  let termOptions: { id: string; name: string }[] = [];
  let streamOptions: { id: string; name: string }[] = [];
  let selectedTermName = "";
  let selectedStreamName = "";

  const now = new Date();
  const defaultFrom = isoDate(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const defaultTo = isoDate(now);
  const from = fromParam || defaultFrom;
  const to = toParam || defaultTo;

  if (canSeeReports) {
    const [{ data: terms }, { data: streams }] = await Promise.all([
      supabase.from("terms").select("id, name, start_date, end_date").order("start_date", { ascending: false }),
      supabase.from("streams").select("id, name, classes(name)").order("name"),
    ]);
    termOptions = (terms ?? []).map((t) => ({ id: t.id, name: t.name }));
    streamOptions = (streams ?? []).map((s) => ({
      id: s.id,
      name: `${(s.classes as unknown as { name: string } | null)?.name ?? ""} ${s.name}`.trim(),
    }));
    const selectedTerm = termParam ? (terms ?? []).find((t) => t.id === termParam) : undefined;
    selectedTermName = selectedTerm?.name ?? "";
    selectedStreamName = streamParam ? streamOptions.find((s) => s.id === streamParam)?.name ?? "" : "";

    const enrollmentFrom = new Date(from);
    const enrollmentTo = new Date(to);
    // Enrollment trend buckets by month across the selected date range (defaults to the same
    // 7-day window as attendance if the person hasn't touched the range — for a meaningful
    // month-by-month bar chart, widen to a 6-month window when the range is at its default).
    const trendStart =
      !fromParam && !toParam
        ? (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - 5);
            d.setDate(1);
            return d;
          })()
        : enrollmentFrom;
    const trendMonths = Math.max(
      1,
      (enrollmentTo.getFullYear() - trendStart.getFullYear()) * 12 + (enrollmentTo.getMonth() - trendStart.getMonth()) + 1,
    );

    let admissionQuery = supabase.from("students").select("admission_date, current_class_id").gte("admission_date", isoDate(trendStart));
    if (streamParam) admissionQuery = admissionQuery.eq("current_class_id", streamParam);
    const { data: admissionRows } = await admissionQuery;

    const buckets = new Map<string, number>();
    for (let i = 0; i < trendMonths; i++) {
      const d = new Date(trendStart);
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

    // Fee collection: the forecast view (with its linear end-of-term projection) only makes
    // sense for the active term, so keep using it when no term filter (or the active term) is
    // selected; for a past/future term filter, show actuals for that term without a projection.
    if (!termParam) {
      const { data: forecastRow } = await supabase
        .from("v_fee_collection_forecast")
        .select("term_name, total_invoiced, total_collected, current_collection_rate_pct, projected_collection_rate_pct")
        .maybeSingle();
      feeForecast = forecastRow
        ? {
            term_name: forecastRow.term_name,
            total_invoiced: Number(forecastRow.total_invoiced),
            total_collected: Number(forecastRow.total_collected),
            current_collection_rate_pct: forecastRow.current_collection_rate_pct,
            projected_collection_rate_pct: forecastRow.projected_collection_rate_pct,
          }
        : null;
    } else {
      const [{ data: invoiceRows }, { data: paymentRows }] = await Promise.all([
        supabase.from("invoices").select("total_amount, student_id").eq("term_id", termParam),
        supabase
          .from("payment_allocations")
          .select("amount_allocated, invoices!inner(term_id)")
          .eq("invoices.term_id", termParam),
      ]);
      const totalInvoiced = (invoiceRows ?? []).reduce((sum, i) => sum + Number(i.total_amount), 0);
      const totalCollected = (paymentRows ?? []).reduce((sum, p) => sum + Number(p.amount_allocated), 0);
      feeForecast = {
        term_name: selectedTermName || "Selected term",
        total_invoiced: totalInvoiced,
        total_collected: totalCollected,
        current_collection_rate_pct: totalInvoiced > 0 ? Math.round((1000 * totalCollected) / totalInvoiced) / 10 : 0,
        projected_collection_rate_pct: null,
      };
    }

    let riskQuery = supabase
      .from("v_at_risk_students")
      .select(
        "student_id, first_name, last_name, admission_number, attendance_rate_30d, latest_exam_average, overdue_balance, risk_score, risk_reasons, current_class_id",
      )
      .order("risk_score", { ascending: false });
    if (streamParam) riskQuery = riskQuery.eq("current_class_id", streamParam);
    const { data: riskRows } = await riskQuery;
    atRiskRows = (riskRows ?? []) as AtRiskRow[];

    let attendanceQuery = supabase
      .from("student_attendance")
      .select("attendance_date, status, stream_id")
      .eq("session", "class")
      .gte("attendance_date", from)
      .lte("attendance_date", to);
    if (streamParam) attendanceQuery = attendanceQuery.eq("stream_id", streamParam);
    const { data: attendanceRows } = await attendanceQuery;

    const dayBuckets = new Map<string, { present: number; absent: number; late: number; total: number }>();
    const fromDate = new Date(from);
    const toDate = new Date(to);
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      dayBuckets.set(isoDate(d), { present: 0, absent: 0, late: 0, total: 0 });
    }
    for (const row of attendanceRows ?? []) {
      const bucket = dayBuckets.get(row.attendance_date);
      if (!bucket) continue;
      bucket.total += 1;
      if (row.status === "present") bucket.present += 1;
      else if (row.status === "absent") bucket.absent += 1;
      else if (row.status === "late") bucket.late += 1;
    }
    attendanceDays = Array.from(dayBuckets.entries()).map(([date, v]) => ({ date, present: v.present, total: v.total }));
    attendanceExportDays = Array.from(dayBuckets.entries()).map(([date, v]) => ({ date, ...v }));

    const { data: transportRows } = await supabase
      .from("v_transport_route_capacity")
      .select("route_id, route_name, capacity, allocated, available")
      .order("route_name");
    transportRoutes = (transportRows ?? []).map((r) => ({
      route_id: r.route_id,
      route_name: r.route_name,
      capacity: r.capacity,
      allocated: r.allocated,
      available: r.available,
    }));
  }

  const exportData: ReportExportData = {
    schoolName: schoolName ?? "EduCore",
    generatedAt: new Date().toISOString(),
    filters: { term: selectedTermName, stream: selectedStreamName, campus: "", from, to },
    summary: [
      feeForecast ? { label: "Fees invoiced", value: `KES ${feeForecast.total_invoiced.toLocaleString()}` } : null,
      feeForecast ? { label: "Fees collected", value: `KES ${feeForecast.total_collected.toLocaleString()}` } : null,
      { label: "At-risk students", value: String(atRiskRows.length) },
      { label: "Admissions in window", value: String(enrollmentMonths.reduce((s, m) => s + m.count, 0)) },
    ].filter(Boolean) as { label: string; value: string }[],
    atRisk: atRiskRows,
    transport: transportRoutes,
    fee: feeForecast,
    attendance: attendanceExportDays,
  };

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Reports" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Management reports</h1>
            <p className="text-sm text-muted-foreground">
              {schoolName ? `${schoolName} — ` : ""}
              cross-module overview
            </p>
          </div>
          {canSeeReports && <ReportsExportMenu data={exportData} />}
        </div>

        {isGroupAdmin && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Cross-campus</h2>
              {campusOptions.length > 0 && (
                <CampusFilterSelect campusParam={campusParam} campusOptions={campusOptions} />
              )}
            </div>
            <CampusSummaryTable rows={campusRows} />
          </div>
        )}

        {!canSeeReports ? (
          isGroupAdmin ? null : (
            <p className="text-sm text-muted-foreground">Reports are available to the School Owner and Principal.</p>
          )
        ) : (
          <>
            <ReportsFilterBar
              terms={termOptions}
              streams={streamOptions}
              selectedTermId={termParam ?? ""}
              selectedStreamId={streamParam ?? ""}
              from={from}
              to={to}
            />

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
