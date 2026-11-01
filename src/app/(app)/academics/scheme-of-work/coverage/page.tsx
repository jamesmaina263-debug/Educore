import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { STATUS_LABEL, type Coverage, type CoverageStatus } from "@/lib/scheme-coverage";
import { STATUS_LABELS } from "../_types";
import { loadCoverageDashboard, type CoverageOption } from "./_data";

const TONE: Record<CoverageStatus, "success" | "warning" | "danger" | "neutral"> = {
  on_track: "success",
  behind: "warning",
  critical: "danger",
  not_due: "neutral",
  no_lessons: "neutral",
};

const SELECT_CLASS = "h-9 rounded-md border bg-background px-2 text-sm";

function pct(c: Coverage): string {
  return c.dueRatio === null ? "—" : `${Math.round(c.dueRatio * 100)}%`;
}

function dueLabel(c: Coverage): string {
  return c.due === 0 ? "none due yet" : `${c.dueCompleted}/${c.due} due`;
}

function CoverageBadge({ c }: { c: Coverage }) {
  return <StatusBadge tone={TONE[c.status]} label={STATUS_LABEL[c.status]} />;
}

function Bar({ c }: { c: Coverage }) {
  const done = c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
  return (
    <div
      className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${c.completed} of ${c.total} lessons completed`}
    >
      <div className="h-full bg-primary" style={{ width: `${done}%` }} />
    </div>
  );
}

function FilterSelect({ name, label, value, options }: { name: string; label: string; value?: string; options: CoverageOption[] }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select name={name} defaultValue={value ?? ""} className={SELECT_CLASS}>
        {name !== "term" && <option value="">All</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function SchemeCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string; class?: string; subject?: string; teacher?: string; drafts?: string }>;
}) {
  const params = await searchParams;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const ctx = await loadCoverageDashboard(params);

  return (
    <AppShell
      breadcrumbs={[
        { label: ctx.schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Scheme of Work", href: "/academics/scheme-of-work" },
        { label: "Coverage" },
      ]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Syllabus coverage</h1>
            <p className="text-sm text-muted-foreground">
              How far each teacher has got through their scheme of work, against the term calendar.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/academics/scheme-of-work">All schemes</Link>
          </Button>
        </div>

        {!ctx.canView ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            Coverage reports are available to the principal, deputy principal and school owner.
          </p>
        ) : ctx.loadError ? (
          <p className="panel border-destructive/40 bg-destructive-subtle p-4 text-sm">
            Coverage could not be loaded just now, so no figures are shown rather than misleading ones. Please refresh; if it
            keeps happening, contact support.
          </p>
        ) : !ctx.term ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            Add an academic term first; coverage is measured against the term calendar.
          </p>
        ) : (
          <>
            <form method="get" className="panel flex flex-wrap items-end gap-3 p-3">
              <FilterSelect name="term" label="Term" value={ctx.term.id} options={ctx.termOptions} />
              <FilterSelect name="class" label="Class" value={ctx.filters.class} options={ctx.classOptions} />
              <FilterSelect name="subject" label="Subject" value={ctx.filters.subject} options={ctx.subjectOptions} />
              <FilterSelect name="teacher" label="Teacher" value={ctx.filters.teacher} options={ctx.teacherOptions} />
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="drafts" value="1" defaultChecked={ctx.filters.drafts === "1"} />
                Include drafts
              </label>
              <Button type="submit" size="sm">
                Apply
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              {ctx.term.label} ({ctx.term.start_date} to {ctx.term.end_date}). A lesson counts as due once its week has ended,
              counted from the term start (or on its own date if the teacher set one). Half-term breaks are not taken off, so
              figures after a break can look a little optimistic. Today is {ctx.today}.
            </p>

            {ctx.rows.length === 0 ? (
              <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
                No schemes match these filters{ctx.filters.drafts === "1" ? "" : " (drafts are hidden; tick Include drafts to see them)"}.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="panel p-4">
                    <div className="text-xs text-muted-foreground">Schemes</div>
                    <div className="text-2xl font-semibold">{ctx.rows.length}</div>
                  </div>
                  <div className="panel p-4">
                    <div className="text-xs text-muted-foreground">Due lessons completed</div>
                    <div className="text-2xl font-semibold">{pct(ctx.overall)}</div>
                    <div className="text-xs text-muted-foreground">{dueLabel(ctx.overall)}</div>
                  </div>
                  <div className="panel p-4">
                    <div className="text-xs text-muted-foreground">Lessons behind</div>
                    <div className="text-2xl font-semibold">{ctx.overall.lag}</div>
                  </div>
                  <div className="panel p-4">
                    <div className="text-xs text-muted-foreground">Schemes behind or far behind</div>
                    <div className="text-2xl font-semibold">
                      {ctx.rows.filter((r) => r.coverage.status === "behind" || r.coverage.status === "critical").length}
                    </div>
                  </div>
                </div>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">By teacher</h2>
                  <div className="panel overflow-x-auto">
                    <Table className="table-dense">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Schemes</TableHead>
                          <TableHead>Completed</TableHead>
                          <TableHead>Due lessons done</TableHead>
                          <TableHead>Behind by</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ctx.byTeacher.map((g) => (
                          <TableRow key={g.key}>
                            <TableCell className="font-medium">{g.label}</TableCell>
                            <TableCell>{g.schemes}</TableCell>
                            <TableCell>
                              {g.coverage.completed}/{g.coverage.total}
                            </TableCell>
                            <TableCell>
                              {pct(g.coverage)} <span className="text-muted-foreground">({dueLabel(g.coverage)})</span>
                            </TableCell>
                            <TableCell>{g.coverage.lag > 0 ? `${g.coverage.lag} lessons` : "—"}</TableCell>
                            <TableCell>
                              <CoverageBadge c={g.coverage} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">All schemes, most behind first</h2>
                  <div className="panel overflow-x-auto">
                    <Table className="table-dense">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Subject</TableHead>
                          <TableHead>Class</TableHead>
                          <TableHead>Teacher</TableHead>
                          <TableHead>Progress</TableHead>
                          <TableHead>Due lessons done</TableHead>
                          <TableHead>Behind by</TableHead>
                          <TableHead>Coverage</TableHead>
                          <TableHead>Scheme</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ctx.rows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">
                              <Link href={`/academics/scheme-of-work/${r.id}`} className="hover:underline">
                                {r.subject_name}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {r.class_name}
                              {r.stream_name ? ` ${r.stream_name}` : ""}
                            </TableCell>
                            <TableCell>{r.teacher_name}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Bar c={r.coverage} />
                                <span className="text-xs text-muted-foreground">
                                  {r.coverage.completed}/{r.coverage.total}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{pct(r.coverage)}</TableCell>
                            <TableCell>{r.coverage.lag > 0 ? `${r.coverage.lag} lessons` : "—"}</TableCell>
                            <TableCell>
                              <CoverageBadge c={r.coverage} />
                            </TableCell>
                            <TableCell className="text-muted-foreground">{STATUS_LABELS[r.status] ?? r.status}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
