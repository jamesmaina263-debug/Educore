import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { SchoolAnalyticsCharts } from "@/components/exams/school-analytics-charts";
import { getSchoolAnalytics } from "@/app/(app)/exams/school-analytics-actions";
import { round1 } from "@/lib/academics/performance-analytics";

type Params = { year?: string; class?: string; subject?: string; term?: string };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${round1(n)}%`);

/**
 * Whole-school academic analytics (Academic Performance Analytics module). Owner/Principal only, the
 * same ai.read gate as the existing Performance Dashboard. Filters are plain GET params so a view is
 * linkable. Every figure is computed in performance-analytics.ts from closed-exam marks.
 */
export default async function SchoolAnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: allowed }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "ai.read" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  const shell = (children: React.ReactNode) => (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Exams", href: "/exams" }, { label: "School Analytics" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      {children}
    </AppShell>
  );

  if (!allowed) return shell(<p className="text-sm text-muted-foreground">You don&apos;t have access to school analytics.</p>);

  const term = params.term ? Number(params.term) : undefined;
  const data = await getSchoolAnalytics({
    yearId: params.year || undefined,
    classId: params.class || undefined,
    subjectId: params.subject || undefined,
    termNumber: term && term >= 1 && term <= 3 ? term : undefined,
  });
  if ("error" in data) return shell(<p className="text-sm text-danger">Could not load school analytics: {data.error}</p>);

  const { summary: s, options } = data;
  const select = "rounded-md border border-border bg-background px-2 py-1 text-sm";
  const attention = s.subjectAverages.filter((x) => x.needsIntervention);

  return shell(
    <div className="flex flex-col gap-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Academic year
          <select name="year" defaultValue={params.year ?? ""} className={select}>
            <option value="">All years</option>
            {options.years.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Class
          <select name="class" defaultValue={params.class ?? ""} className={select}>
            <option value="">All classes</option>
            {options.classes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Subject
          <select name="subject" defaultValue={params.subject ?? ""} className={select}>
            <option value="">All subjects</option>
            {options.subjects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Term
          <select name="term" defaultValue={params.term ?? ""} className={select}>
            <option value="">All terms</option>
            {[1, 2, 3].map((t) => <option key={t} value={t}>Term {t}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1 text-sm font-medium">Apply</button>
      </form>

      {s.studentsAssessed === 0 ? (
        <p className="text-sm text-muted-foreground">No closed-exam results match these filters yet. Analytics appear automatically as exams are closed.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="School average" value={pct(s.overallAverage)} />
            <Stat label="Students assessed" value={String(s.studentsAssessed)} />
            <Stat label="Improving" value={String(s.improving)} hint="Across years on file" />
            <Stat label="Declining" value={String(s.declining)} />
            <Stat label="Consistent" value={String(s.consistent)} />
            <Stat label="Not enough history" value={String(s.insufficientHistory)} hint="Under two years, not labelled" />
            <Stat label="Strongest class" value={s.bestClass ? `${s.bestClass.label} (${pct(s.bestClass.average)})` : "—"} />
            <Stat
              label="Weakest class"
              value={s.weakestClass && s.classAverages.length > 1 ? `${s.weakestClass.label} (${pct(s.weakestClass.average)})` : "—"}
              hint={s.classAverages.length > 1 ? undefined : "Needs two or more classes"}
            />
            <Stat label="Best subject" value={s.bestSubject ? `${s.bestSubject.label} (${pct(s.bestSubject.average)})` : "—"} />
            <Stat
              label="Weakest subject"
              value={s.weakestSubject && s.subjectAverages.length > 1 ? `${s.weakestSubject.label} (${pct(s.weakestSubject.average)})` : "—"}
            />
          </section>

          <SchoolAnalyticsCharts summary={s} />

          <section className="rounded-md border border-border p-3">
            <h3 className="mb-2 text-sm font-semibold">Subjects needing attention</h3>
            {attention.length === 0 ? (
              <p className="text-xs text-muted-foreground">No subject is below {data.interventionThreshold}% or falling by 5 points or more.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {attention.map((x) => (
                  <li key={x.id} className="flex items-center justify-between">
                    <span>{x.label}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {pct(x.average)}
                      {x.change !== null && <Badge variant={x.change < 0 ? "destructive" : "secondary"}>{x.change > 0 ? "+" : ""}{round1(x.change)} pp</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Based on closed exams only. Missing marks are excluded, never counted as zero.
            {data.bandSource ? ` Categories follow the "${data.bandSource}" grading scale.` : " No default numeric grading scale is configured, so the category breakdown is hidden."}
            {s.unbanded > 0 ? ` ${s.unbanded} student average(s) fall outside every band.` : ""}
          </p>
        </>
      )}
    </div>,
  );
}
