import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/admin/analytics/kpi-card";
import { DateRangeTabs } from "@/components/admin/analytics/date-range-tabs";
import { CustomRangePicker } from "@/components/admin/analytics/custom-range-picker";
import { AdminSchoolList, type SchoolListRow } from "@/components/admin/admin-school-list";
import { resolveDateRange, priorPeriod, percentChange, isValidIsoDate, type PeriodKey } from "@/lib/analytics-date-range";

const VALID_PERIODS: PeriodKey[] = ["today", "yesterday", "7d", "30d", "90d", "custom"];

// Months per billing period, used only to normalize a plan's recurring charge into a
// monthly-equivalent figure for MRR. "termly" is approximate -- Kenyan schools bill per
// 3-term year, and terms aren't exactly equal-length, so this treats a term as ~4 months
// (12 months / 3 terms). Good enough for a headline MRR number; not meant to reconcile
// exactly against any single school's actual term calendar.
const MONTHS_PER_BILLING_PERIOD: Record<string, number> = { monthly: 1, termly: 4, annual: 12 };

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  // Revenue-this-period vs. prior-period uses the same period-picker convention as
  // /admin/analytics (see that page for the custom-range validation rationale).
  const { period: rawPeriod, from, to } = await searchParams;
  let period: PeriodKey = VALID_PERIODS.includes(rawPeriod as PeriodKey) ? (rawPeriod as PeriodKey) : "30d";
  const customRange =
    period === "custom" && isValidIsoDate(from) && isValidIsoDate(to) && from <= to ? { from, to } : undefined;
  if (period === "custom" && !customRange) period = "30d";
  const { startIso, endIso, label } = resolveDateRange(period, customRange);
  const prior = priorPeriod(startIso, endIso);

  // Every school/subscription/invoice row is fetched in full and grouped in JS below, same
  // convention as /admin/billing and /admin/analytics (this platform has a small number of
  // tenant schools, so a single unaggregated fetch per table is simpler and cheap -- not a
  // pattern to reach for once school counts grow into the thousands).
  const [
    { data: schools },
    { data: subs },
    { data: plans },
    { data: invoices },
    { data: students },
    { data: staff },
    { data: classes },
    { data: streams },
    { data: feeStructures },
  ] = await Promise.all([
    supabase.from("schools").select("id, name, slug, status, created_at").order("name"),
    supabase.from("school_subscriptions").select("school_id, plan_id, status, trial_ends_at"),
    supabase.from("subscription_plans").select("id, name, price_per_student_kes, billing_period"),
    // Unfiltered (all statuses, all time) -- lifetime revenue, this-period vs. prior-period,
    // and the overdue total all need to be derived from the same full set below.
    supabase.from("platform_invoices").select("school_id, amount_kes, status, paid_at, due_at"),
    supabase.from("students").select("school_id"),
    supabase.from("school_users").select("school_id"),
    // Onboarding-completeness signal for the school list below: has this school set up any
    // classes, streams, and an active fee structure? Just school_id -- only presence/absence
    // per school matters here, not the rows themselves.
    supabase.from("classes").select("school_id"),
    supabase.from("streams").select("school_id"),
    supabase.from("fee_structures").select("school_id").eq("is_active", true),
  ]);

  const planNameById = new Map((plans ?? []).map((p) => [p.id, p.name]));
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const subBySchool = new Map((subs ?? []).map((s) => [s.school_id, s]));

  const studentCountBySchool = new Map<string, number>();
  for (const s of students ?? []) {
    if (!s.school_id) continue;
    studentCountBySchool.set(s.school_id, (studentCountBySchool.get(s.school_id) ?? 0) + 1);
  }

  const staffCountBySchool = new Map<string, number>();
  for (const s of staff ?? []) {
    if (!s.school_id) continue;
    staffCountBySchool.set(s.school_id, (staffCountBySchool.get(s.school_id) ?? 0) + 1);
  }

  const schoolIdsWithClasses = new Set((classes ?? []).map((c) => c.school_id));
  const schoolIdsWithStreams = new Set((streams ?? []).map((s) => s.school_id));
  const schoolIdsWithFeeStructure = new Set((feeStructures ?? []).map((f) => f.school_id));

  function onboardingStage(schoolId: string): SchoolListRow["onboarding_stage"] {
    const hasClasses = schoolIdsWithClasses.has(schoolId);
    const hasStreams = schoolIdsWithStreams.has(schoolId);
    const hasFees = schoolIdsWithFeeStructure.has(schoolId);
    if (hasClasses && hasStreams && hasFees) return "complete";
    if (hasClasses || hasStreams || hasFees) return "in_progress";
    return "not_started";
  }

  const totalSchools = schools?.length ?? 0;
  const activeSchools = (schools ?? []).filter((s) => s.status === "active").length;
  const totalStudents = students?.length ?? 0;

  const allInvoices = invoices ?? [];
  const paidInvoices = allInvoices.filter((inv) => inv.status === "paid");
  const lifetimeRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.amount_kes), 0);

  // paid_at is a timestamptz; date-string comparison against the ISO day boundaries is safe
  // here because startIso/endIso/prior are UTC calendar dates and paid_at is compared as its
  // ISO string prefix, same "compare as strings" approach the DB-side .gte/.lte queries in
  // /admin/analytics rely on.
  const inRange = (iso: string | null, startIso: string, endIso: string) =>
    !!iso && iso.slice(0, 10) >= startIso && iso.slice(0, 10) <= endIso;

  const revenueThisPeriod = paidInvoices
    .filter((inv) => inRange(inv.paid_at, startIso, endIso))
    .reduce((sum, inv) => sum + Number(inv.amount_kes), 0);
  const revenuePriorPeriod = paidInvoices
    .filter((inv) => inRange(inv.paid_at, prior.startIso, prior.endIso))
    .reduce((sum, inv) => sum + Number(inv.amount_kes), 0);
  const revenueChangePercent = percentChange(revenueThisPeriod, revenuePriorPeriod);

  // "Overdue" trusts the platform_invoices.status = 'overdue' value written by the daily
  // mark_invoices_overdue() cron (see /api/cron/billing), but also catches invoices that are
  // already past due_at and simply haven't been swept by that cron yet (it runs once a day),
  // so this card doesn't silently under-report for up to 24h.
  const now = new Date().toISOString();
  const overdueInvoices = allInvoices.filter(
    (inv) => inv.status === "overdue" || (inv.status === "issued" && !!inv.due_at && inv.due_at < now),
  );
  const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + Number(inv.amount_kes), 0);
  const overdueCount = overdueInvoices.length;

  // MRR: active subscriptions only, priced by each plan's price_per_student_kes times that
  // school's current student count, normalized to a monthly figure via MONTHS_PER_BILLING_PERIOD.
  // This is a current run-rate estimate (today's active subs x today's student counts), not a
  // reconciliation of actual invoiced amounts -- platform_invoices above is the source of truth
  // for what was actually billed and paid.
  let mrr = 0;
  for (const sub of subs ?? []) {
    if (sub.status !== "active" || !sub.plan_id) continue;
    const plan = planById.get(sub.plan_id);
    if (!plan) continue;
    const schoolStudentCount = studentCountBySchool.get(sub.school_id) ?? 0;
    const periodCharge = Number(plan.price_per_student_kes) * schoolStudentCount;
    const months = MONTHS_PER_BILLING_PERIOD[plan.billing_period] ?? 1;
    mrr += periodCharge / months;
  }

  const schoolRows: SchoolListRow[] = (schools ?? []).map((sc) => {
    const sub = subBySchool.get(sc.id);
    return {
      id: sc.id,
      name: sc.name,
      slug: sc.slug,
      status: sc.status as SchoolListRow["status"],
      student_count: studentCountBySchool.get(sc.id) ?? 0,
      staff_count: staffCountBySchool.get(sc.id) ?? 0,
      plan_name: sub?.plan_id ? (planNameById.get(sub.plan_id) ?? null) : null,
      trial_ends_at: sc.status === "trial" ? (sub?.trial_ends_at ?? null) : null,
      onboarding_stage: onboardingStage(sc.id),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Platform-wide snapshot across every school on EduCore.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Schools" value={totalSchools} sub={`${activeSchools} active`} />
        <KpiCard label="Active Schools" value={activeSchools} />
        <KpiCard label="Total Students" value={totalStudents} />
        <KpiCard label="MRR" value={`KES ${Math.round(mrr).toLocaleString()}`} sub="Active subscriptions, run-rate" />
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Revenue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeTabs active={period} basePath="/admin" />
            {period === "custom" && (
              <CustomRangePicker from={customRange?.from} to={customRange?.to} basePath="/admin" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label={`Revenue (${label})`}
            value={`KES ${revenueThisPeriod.toLocaleString()}`}
            sub="Paid invoices, by paid date"
            changePercent={revenueChangePercent}
          />
          <KpiCard label="Lifetime Revenue" value={`KES ${lifetimeRevenue.toLocaleString()}`} sub="Paid invoices, all time" />
          <KpiCard
            label="Overdue"
            value={`KES ${overdueAmount.toLocaleString()}`}
            sub={`${overdueCount} invoice${overdueCount === 1 ? "" : "s"} past due`}
          />
          <KpiCard
            label={`Prior Period (${prior.startIso} – ${prior.endIso})`}
            value={`KES ${revenuePriorPeriod.toLocaleString()}`}
            sub="For comparison"
          />
        </div>
        {/* Same "say what's approximated" convention as the funnel's stage notes below --
            these two are the actual known gaps, not a blanket disclaimer. */}
        <p className="mt-2 text-xs text-muted-foreground">
          MRR is a run-rate estimate (today&apos;s active subscriptions × current student counts), not a
          reconciliation of invoiced amounts. Paid totals reflect <code>platform_invoices.status = &apos;paid&apos;</code>
          {" "}only — there is no refunded/reversed status today, so a later refund won&apos;t reduce these figures.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Schools</h2>
        <AdminSchoolList schools={schoolRows} />
      </div>
    </div>
  );
}
