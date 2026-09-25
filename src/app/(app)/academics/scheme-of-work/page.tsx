import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/get-user";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { SchemeOfWorkFilters } from "@/components/academics/scheme-of-work/scheme-of-work-filters";
import { loadSchemeOfWorkDashboard, STATUS_LABELS } from "./_data";
import { Sparkles } from "lucide-react";

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  in_progress: "info",
  submitted: "info",
  under_review: "warning",
  reviewed: "info",
  approved: "success",
};

export default async function SchemeOfWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; term?: string; class?: string; stream?: string; subject?: string; teacher?: string; status?: string }>;
}) {
  const params = await searchParams;
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const ctx = await loadSchemeOfWorkDashboard(params);

  return (
    <AppShell
      breadcrumbs={[{ label: ctx.schoolName ?? "EduCore", href: "/dashboard" }, { label: "Scheme of Work" }]}
      userName={ctx.userName}
      userRole={ctx.userRole}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Scheme of Work</h1>
            <p className="text-sm text-muted-foreground">Plan, track and review termly schemes — by hand or drafted with AI.</p>
          </div>
          {ctx.canWrite && (
            <Button asChild>
              <Link href="/academics/scheme-of-work/new">
                <Sparkles className="mr-1.5 size-4" aria-hidden />
                New Scheme
              </Link>
            </Button>
          )}
        </div>

        {!ctx.canRead ? (
          <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            You don&apos;t have permission to view schemes of work.
          </p>
        ) : (
          <>
            <SchemeOfWorkFilters
              yearOptions={ctx.yearOptions}
              termOptions={ctx.termOptions}
              classOptions={ctx.classOptions}
              streamOptions={ctx.streamOptions}
              subjectOptions={ctx.subjectOptions}
              teacherOptions={ctx.teacherOptions}
              statusOptions={ctx.statusOptions}
              filters={ctx.filters}
              showTeacherFilter={ctx.canWriteAny}
            />

            {ctx.schemes.length === 0 ? (
              <p className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
                No schemes match these filters yet.
                {ctx.canWrite && (
                  <>
                    {" "}
                    <Link href="/academics/scheme-of-work/new" className="text-primary underline underline-offset-2">
                      Create one
                    </Link>
                    .
                  </>
                )}
              </p>
            ) : (
              <div className="panel overflow-x-auto">
                <Table className="table-dense">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead>Teacher</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead>Weeks</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ctx.schemes.map((s) => (
                      <TableRow key={s.id} className="cursor-pointer">
                        <TableCell className="font-medium">
                          <Link href={`/academics/scheme-of-work/${s.id}`} className="hover:underline">
                            {s.subject_name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {s.class_name}
                          {s.stream_name ? ` ${s.stream_name}` : ""}
                        </TableCell>
                        <TableCell>{s.teacher_name}</TableCell>
                        <TableCell>{s.term_label}</TableCell>
                        <TableCell>{s.total_weeks}</TableCell>
                        <TableCell>
                          {s.entries_total > 0
                            ? `${s.entries_completed}/${s.entries_total} (${Math.round((s.entries_completed / s.entries_total) * 100)}%)`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={STATUS_TONE[s.status] ?? "neutral"} label={STATUS_LABELS[s.status] ?? s.status} />
                          {s.origin === "ai_generated" && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[0.6875rem] text-muted-foreground" title="Started from an AI-generated draft">
                              <Sparkles className="size-3" aria-hidden />
                              AI
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{new Date(s.updated_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
