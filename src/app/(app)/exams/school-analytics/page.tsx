import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { TableExportMenu } from "@/components/shared/table-export-menu";
import { SchoolAnalyticsCharts } from "@/components/exams/school-analytics-charts";
import { PerformanceReportButton } from "@/components/exams/performance-report-button";
import { getSchoolAnalytics } from "@/app/(app)/exams/school-analytics-actions";
import { saveAnalyticsThreshold } from "@/app/(app)/exams/analytics-settings-actions";
import { parseAnalyticsSettings } from "@/lib/academics/analytics-settings";
import { formatChange, formatScore, roundFor, type ScoreKind } from "@/lib/academics/performance-analytics";
import { schoolReportModel } from "@/lib/academics/performance-report-model";

type Params = { year?: string; class?: string; subject?: string; term?: string; band?: string; model?: string; threshold?: string; settings?: string; settings_error?: string };

const FLAG_LABEL: Record<string, string> = {
  declining: "Declining",
  consistently_low: "Consistently low",
  improving: "Significant improvement",
  stagnant: "Stagnant",
  below_threshold: "Below threshold",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * School academic analytics (Academic Performance Analytics module). Who sees what is decided in
 * analytics-scope.ts: Principal/Owner/Deputy see the whole school, teachers only their own classes.
 * Filters are plain GET params so a view is linkable. Every figure is computed in
 * performance-analytics.ts from closed-exam marks; percentages and CBC levels are never mixed.
 */
export default async function SchoolAnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, roles(display_name), schools(name, motto, logo_url, address, phone, email, primary_color, analytics_settings)")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; motto: string | null; logo_url: string | null; address: string | null; phone: string | null; email: string | null; primary_color: string | null; analytics_settings: unknown } | null;
  const schoolName = school?.name;
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

  const term = params.term ? Number(params.term) : undefined;
  const threshold = params.threshold ? Number(params.threshold) : undefined;
  const data = await getSchoolAnalytics({
    yearId: params.year || undefined,
    classId: params.class || undefined,
    subjectId: params.subject || undefined,
    termNumber: term && term >= 1 && term <= 3 ? term : undefined,
    band: params.band || undefined,
    kind: params.model === "percent" || params.model === "level" ? (params.model as ScoreKind) : undefined,
    threshold: threshold !== undefined && Number.isFinite(threshold) ? threshold : undefined,
    saved: parseAnalyticsSettings(school?.analytics_settings),
  });
  if ("denied" in data) return shell(<p className="text-sm text-muted-foreground">You don&apos;t have access to school analytics.</p>);
  if ("error" in data) return shell(<p className="text-sm text-danger">Could not load school analytics: {data.error}</p>);

  const { summary: s, options, config: cfg, kind } = data;
  const select = "rounded-md border border-border bg-background px-2 py-1 text-sm";
  const attention = s.subjectAverages.filter((x) => x.needsIntervention);
  const improvingSubjects = s.subjectAverages.filter((x) => x.change !== null && x.change > cfg.stable);
  const decliningSubjects = s.subjectAverages.filter((x) => x.change !== null && x.change < -cfg.stable);
  const stub = schoolName ?? "school";
  const scaleNote =
    kind === "level"
      ? "CBC levels are scored in level points: the best level scores the number of levels and the lowest scores 1 (A=4 … D=1 on a four-level scale). They are shown separately from percentages and never averaged with them."
      : "Marks are converted to a percentage of each paper's own maximum. Change is in percentage points.";
  const filterText = [
    options.years.find((y) => y.id === params.year)?.name,
    options.classes.find((c) => c.id === params.class)?.name,
    options.subjects.find((x) => x.id === params.subject)?.name,
    term ? `Term ${term}` : null,
    params.band,
    kind === "level" ? "CBC levels" : "Percentage marks",
  ]
    .filter(Boolean)
    .join(" · ");

  const reportSchool = {
    name: school?.name ?? "EduCore School",
    motto: school?.motto ?? null,
    address: school?.address ?? null,
    phone: school?.phone ?? null,
    email: school?.email ?? null,
    primaryColor: school?.primary_color ?? null,
    logoUrl: school?.logo_url ?? null,
  };
  const report = schoolReportModel({ schoolName: reportSchool.name, cfg, summary: s, filterText, scaleNote });

  return shell(
    <div className="flex flex-col gap-6">
      {data.scope === "classes" && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Showing only the classes you are class teacher of or teach a subject in. School-wide figures are available to the Principal, Deputy Principal and School Owner.
        </p>
      )}

      {data.availableKinds.length > 1 && (
        <div className="flex gap-2 text-sm">
          {data.availableKinds.map((k) => (
            <Link
              key={k}
              href={`?${new URLSearchParams({ ...(params as Record<string, string>), model: k }).toString()}`}
              className={`rounded-md border px-3 py-1 ${k === kind ? "border-foreground font-medium" : "border-border text-muted-foreground"}`}
            >
              {k === "level" ? "CBC levels" : "Percentage marks"}
            </Link>
          ))}
        </div>
      )}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="model" value={kind} />
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
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Performance category
          <select name="band" defaultValue={params.band ?? ""} className={select}>
            <option value="">All categories</option>
            {s.distribution.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Attention threshold ({cfg.min}–{cfg.max}{cfg.unit.trim() === "%" ? "%" : " pts"})
          <input name="threshold" type="number" step={kind === "percent" ? 1 : 0.25} min={cfg.min} max={cfg.max} defaultValue={data.thresholdSource === "url" ? cfg.threshold : undefined} placeholder={String(cfg.threshold)} className={`${select} w-24`} />
        </label>
        <button type="submit" className="rounded-md border border-border px-3 py-1 text-sm font-medium">Apply</button>
      </form>

      {data.scope === "school" && (
        <form action={saveAnalyticsThreshold} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="threshold" value={cfg.threshold} />
          {(["year", "class", "subject", "term", "band", "model"] as const).map((k) => (params[k] ? <input key={k} type="hidden" name={`keep_${k}`} value={params[k]} /> : null))}
          <span>
            Attention threshold in use: <span className="font-medium text-foreground">{cfg.threshold}{cfg.kind === "percent" ? "%" : " pts"}</span>{" "}
            ({data.thresholdSource === "saved" ? "school default" : data.thresholdSource === "url" ? "this view only" : "built-in default"})
          </span>
          {data.thresholdSource === "url" && <button type="submit" name="intent" value="save" className="rounded-md border border-border px-2 py-1 font-medium text-foreground">Save as school default</button>}
          {data.thresholdSource === "saved" && <button type="submit" name="intent" value="reset" className="rounded-md border border-border px-2 py-1 font-medium text-foreground">Reset to built-in default</button>}
        </form>
      )}

      {data.truncated && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          The data is larger than the page can load, so these figures cover only part of it.
        </p>
      )}

      {params.settings && <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">{params.settings === "reset" ? "School default cleared. Built-in default restored." : "Saved as the school default."}</p>}
      {params.settings_error && <p className="rounded-md border border-border p-2 text-xs text-danger">{params.settings_error}</p>}

      {s.studentsAssessed === 0 ? (
        <p className="text-sm text-muted-foreground">No closed-exam results match these filters yet. Analytics appear automatically as exams are closed.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="School average" value={formatScore(s.overallAverage, cfg)} />
            <Stat label="Students assessed" value={String(s.studentsAssessed)} />
            <Stat label="Improving" value={String(s.improving)} hint="Across years on file" />
            <Stat label="Declining" value={String(s.declining)} />
            <Stat label="Consistent" value={String(s.consistent)} />
            <Stat label="Not enough history" value={String(s.insufficientHistory)} hint="Under two years, not labelled" />
            <Stat label="Strongest class" value={s.bestClass ? `${s.bestClass.label} (${formatScore(s.bestClass.average, cfg)})` : "—"} />
            <Stat
              label="Weakest class"
              value={s.weakestClass && s.classAverages.length > 1 ? `${s.weakestClass.label} (${formatScore(s.weakestClass.average, cfg)})` : "—"}
              hint={s.classAverages.length > 1 ? undefined : "Needs two or more classes"}
            />
            <Stat label="Best subject" value={s.bestSubject ? `${s.bestSubject.label} (${formatScore(s.bestSubject.average, cfg)})` : "—"} />
            <Stat
              label="Weakest subject"
              value={s.weakestSubject && s.subjectAverages.length > 1 ? `${s.weakestSubject.label} (${formatScore(s.weakestSubject.average, cfg)})` : "—"}
            />
          </section>

          <SchoolAnalyticsCharts summary={s} config={cfg} />

          <section className="grid gap-4 md:grid-cols-3">
            {[
              { title: "Improving subjects", items: improvingSubjects, empty: "None improving by more than the stable band." },
              { title: "Declining subjects", items: decliningSubjects, empty: "None declining by more than the stable band." },
              { title: "Needing intervention", items: attention, empty: `None below ${cfg.threshold}${cfg.unit.trim() === "%" ? "%" : " pts"} or declining.` },
            ].map((g) => (
              <div key={g.title} className="rounded-md border border-border p-3">
                <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
                {g.items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{g.empty}</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {g.items.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2">
                        <span>{x.label}</span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {formatScore(x.average, cfg)}
                          {x.change !== null && <Badge variant={x.change < 0 ? "destructive" : "secondary"}>{formatChange(x.change, cfg)}</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>

          <section className="rounded-md border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Early warning ({data.warnings.length})</h3>
              <TableExportMenu
                label="Export intervention list"
                filenameStub={`${stub}-intervention-list`}
                title="Students requiring academic intervention"
                subtitle={`${stub} · Threshold ${cfg.threshold}${cfg.unit.trim() === "%" ? "%" : " pts"} · ${filterText}`}
                size="sm"
                rows={data.warnings.map((w) => ({
                  Student: w.name,
                  "Admission no.": w.admissionNumber,
                  [`Latest term average (${cfg.kind === "percent" ? "%" : "pts"})`]: roundFor(w.latestAverage, cfg),
                  [`Change (${cfg.kind === "percent" ? "pp" : "pts"})`]: w.change === null ? "" : roundFor(w.change, cfg),
                  Category: w.band ?? "",
                  Indicators: w.flags.map((f) => FLAG_LABEL[f]).join("; "),
                }))}
              />
            </div>
            {data.warnings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No students are flagged. Students with fewer than three recorded assessments are never flagged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3">Student</th>
                      <th className="py-1 pr-3">Latest term</th>
                      <th className="py-1 pr-3">Change</th>
                      <th className="py-1">Indicators</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warnings.slice(0, 100).map((w) => (
                      <tr key={w.studentId} className="border-t border-border">
                        <td className="py-1 pr-3">
                          <Link href={`/students/${w.studentId}`} className="font-medium underline-offset-2 hover:underline">{w.name}</Link>
                          <span className="ml-2 text-xs text-muted-foreground">{w.admissionNumber}</span>
                        </td>
                        <td className="py-1 pr-3">{formatScore(w.latestAverage, cfg)}</td>
                        <td className="py-1 pr-3">{formatChange(w.change, cfg)}</td>
                        <td className="py-1">
                          <span className="flex flex-wrap gap-1">
                            {w.flags.map((f) => (
                              <Badge key={f} variant={f === "improving" ? "default" : f === "stagnant" ? "secondary" : "destructive"}>{FLAG_LABEL[f]}</Badge>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.warnings.length > 100 && <p className="mt-1 text-xs text-muted-foreground">Showing the 100 weakest of {data.warnings.length}; export for the full list.</p>}
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <PerformanceReportButton report={report} school={reportSchool} fileName={`${stub}-school-performance`} label="Whole-school PDF report" />
            <TableExportMenu
              label="Export class averages"
              filenameStub={`${stub}-class-performance`}
              title="Class performance"
              subtitle={`${stub} · School average ${formatScore(s.overallAverage, cfg)}`}
              size="sm"
              rows={s.classAverages.map((c) => ({ Class: c.label, Average: roundFor(c.average, cfg), Assessments: c.assessments }))}
            />
            <TableExportMenu
              label="Export subject averages"
              filenameStub={`${stub}-subject-performance`}
              title="Subject performance"
              subtitle={`${stub} · School average ${formatScore(s.overallAverage, cfg)}`}
              size="sm"
              rows={s.subjectAverages.map((x) => ({
                Subject: x.label,
                Average: roundFor(x.average, cfg),
                Change: x.change === null ? "" : roundFor(x.change, cfg),
                "Needs intervention": x.needsIntervention ? "Yes" : "No",
              }))}
            />
            <TableExportMenu
              label="Export year summary"
              filenameStub={`${stub}-year-performance`}
              title="School performance by year"
              subtitle={stub}
              size="sm"
              rows={s.yearAverages.map((y) => ({
                Year: y.yearName,
                Average: roundFor(y.average, cfg),
                Change: y.changeFromPrevious === null ? "" : roundFor(y.changeFromPrevious, cfg),
                Assessments: y.assessments,
                Complete: y.incomplete ? "No" : "Yes",
              }))}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {scaleNote} Based on closed exams only. Missing marks are excluded, never counted as zero.
            {data.bandSource ? ` Categories: ${data.bandSource}.` : " No category scale could be built, so the category breakdown is hidden."}
            {s.unbanded > 0 ? ` ${s.unbanded} student average(s) fall outside every band.` : ""}
          </p>
        </>
      )}
    </div>,
  );
}
