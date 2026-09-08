import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { PerformanceDashboardPicker } from "@/components/exams/performance-dashboard-picker";
import { getClassPerformanceDashboard } from "@/app/(app)/exams/performance-dashboard-actions";

function DistributionBars({ title, bands }: { title: string; bands: { label: string; count: number }[] }) {
  const maxCount = Math.max(1, ...bands.map((b) => b.count));
  if (bands.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="flex flex-col gap-1.5">
        {bands.map((b) => (
          <div key={b.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 font-medium">{b.label}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(b.count / maxCount) * 100}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right text-muted-foreground">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Final performance dashboard (Performance Appraisal Engine directive,
 * roadmap Step 12 -- the last item in the directive's own recommended
 * sequence). Owner/Principal only, same gate as v_at_risk_students
 * (ai.read), since this surfaces the same rule-based intervention list plus
 * class-wide achievement/competency/growth aggregates. See
 * performance-dashboard-actions.ts for how every number here is computed --
 * nothing new is calculated in this file, it only renders.
 */
export default async function PerformanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string }>;
}) {
  const { exam: examParam, class: classParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canViewDashboard }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "ai.read" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  if (!canViewDashboard) {
    return (
      <AppShell
        breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Exams", href: "/exams" }, { label: "Performance Dashboard" }]}
        userName={schoolUser?.full_name ?? user.email ?? "Account"}
        userRole={roleName}
        onSignOut={logout}
      >
        <p className="text-sm text-muted-foreground">You don&apos;t have access to the performance dashboard.</p>
      </AppShell>
    );
  }

  const { data: closedExams } = await supabase.from("exams").select("id, name").eq("status", "closed").order("created_at", { ascending: false });
  const examOptions = closedExams ?? [];
  const selectedExamId = examParam || examOptions[0]?.id || null;

  const { data: examClassRows } = selectedExamId
    ? await supabase.from("exam_classes").select("class_id, classes(id, name)").eq("exam_id", selectedExamId)
    : { data: [] };
  const classOptions = (examClassRows ?? []).map((r) => {
    const c = r.classes as unknown as { id: string; name: string };
    return { id: c.id, name: c.name };
  });
  const selectedClassId = classParam || classOptions[0]?.id || null;

  const dashboard =
    selectedExamId && selectedClassId ? await getClassPerformanceDashboard(selectedExamId, selectedClassId) : null;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Exams", href: "/exams" }, { label: "Performance Dashboard" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold">Performance Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Class-wide achievement, competency development, growth, and intervention signals for one exam.
          </p>
        </div>

        <PerformanceDashboardPicker
          examOptions={examOptions}
          classOptions={classOptions}
          selectedExamId={selectedExamId}
          selectedClassId={selectedClassId}
        />

        {!dashboard && <p className="text-sm text-muted-foreground">Select a closed exam and class to see the dashboard.</p>}

        {dashboard && "error" in dashboard && <p className="text-sm text-danger">Could not load the dashboard: {dashboard.error}</p>}

        {dashboard && !("error" in dashboard) && (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 rounded-lg border border-border p-4 sm:grid-cols-2">
              <DistributionBars title="Achievement distribution" bands={dashboard.achievementDistribution} />
              <DistributionBars title="Competency development" bands={dashboard.competencyDistribution} />
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="mb-2 text-sm font-semibold">Growth (across all subjects, whole recorded history)</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-success/10 p-3 text-center">
                  <p className="text-lg font-semibold text-success">{dashboard.growth.improving}</p>
                  <p className="text-xs text-muted-foreground">Improving</p>
                </div>
                <div className="rounded-md bg-danger/10 p-3 text-center">
                  <p className="text-lg font-semibold text-danger">{dashboard.growth.declining}</p>
                  <p className="text-xs text-muted-foreground">Declining</p>
                </div>
                <div className="rounded-md bg-muted p-3 text-center">
                  <p className="text-lg font-semibold">{dashboard.growth.stable}</p>
                  <p className="text-xs text-muted-foreground">Stable</p>
                </div>
                <div className="rounded-md bg-muted p-3 text-center">
                  <p className="text-lg font-semibold">{dashboard.growth.insufficientData}</p>
                  <p className="text-xs text-muted-foreground">Insufficient data</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Each subject a student has two or more recorded results for counts once. This is a performance-support signal, not a
                diagnosis.
              </p>
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="mb-2 text-sm font-semibold">Students flagged for intervention ({dashboard.interventions.length})</p>
              {dashboard.interventions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No students in this class are currently flagged.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dashboard.interventions.map((row) => (
                    <li key={row.studentId} className="rounded-md border border-border p-2 text-sm">
                      <span className="font-medium">{row.fullName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.reasons.join(", ")}</span>
                      {row.needsSupportCompetencies.length > 0 && (
                        <p className="mt-0.5 text-xs text-warning">Needs support: {row.needsSupportCompetencies.join(", ")}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
