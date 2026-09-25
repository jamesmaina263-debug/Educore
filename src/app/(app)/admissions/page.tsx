import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { getSchoolSlug } from "@/lib/school-slug-server";
import { withSchoolSlug } from "@/lib/school-slug-href";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CopyApplicationLink } from "@/components/admissions/copy-application-link";
import { DeleteApplicationButton } from "@/components/admissions/delete-application-button";
import { ApplicationsTable, type ApplicationRow } from "@/components/admissions/applications-table";
import { escapePostgrestOrValue } from "@/lib/postgrest-filter";
import { createWalkInApplication } from "./walk-in-actions";
import { deleteApplicationPermanentlyAction, claimApplicationAction } from "./actions";
import { discardDraft } from "./[id]/wizard/actions";
import { applicableStepCount } from "./wizard-steps";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  submitted: "info",
  under_review: "info",
  documents_required: "warning",
  // 'shortlisted' and 'assessment_required' are defined in the applications status enum and
  // reserved for a future shortlisting/assessment step, but no code path currently
  // transitions an application to either status — kept here so labels/tone are ready when
  // that step is built, not because they're reachable today.
  shortlisted: "info",
  interview_scheduled: "info",
  assessment_required: "info",
  accepted: "success",
  conditionally_accepted: "success",
  waitlisted: "warning",
  rejected: "danger",
  withdrawn: "neutral",
  admission_pending: "success",
  enrolled: "success",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  documents_required: "Documents needed",
  // See note on STATUS_TONE above — not yet reachable, reserved for a future step.
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview scheduled",
  assessment_required: "Assessment required",
  accepted: "Accepted",
  conditionally_accepted: "Conditionally accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  admission_pending: "Accepted — admission in progress",
  enrolled: "Enrolled",
};

// Task 7: purely a display computation on updated_at, already fetched for every draft — no
// new column, no cron job. 7 days flags an abandoned draft as "warning"; 14+ as "danger".
const STALE_DRAFT_DAYS = 7;
const VERY_STALE_DRAFT_DAYS = 14;

// A plain helper (not called with Date.now() directly in the component body) — same pattern as
// ageInvoiceRows() in finance/_data.ts, so the render function stays pure while this still
// resolves "now" fresh on every request (this page is an async Server Component).
function draftStaleness(
  updatedAt: string,
  nowMs: number = Date.now(),
): { tone: "warning" | "danger"; label: string; days: number } | null {
  const days = Math.floor((nowMs - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days >= VERY_STALE_DRAFT_DAYS) return { tone: "danger", label: `Stale · ${days}d`, days };
  if (days >= STALE_DRAFT_DAYS) return { tone: "warning", label: `Stale · ${days}d`, days };
  return null;
}

// Statuses where there's no more admissions decision to make — an application here is done
// (converted to a student, or closed out) rather than sitting in anyone's working queue.
const TERMINAL_STATUSES = ["enrolled", "rejected", "withdrawn"];

const VIEW_VALUES = ["active", "enrolled", "closed", "all"] as const;
type ApplicationsView = (typeof VIEW_VALUES)[number];

const APPLICATIONS_PAGE_SIZE = 25;

// Task 17: same pattern as draftStaleness above -- a plain helper (not a direct Date.now() call
// inside the Server Component body) so eslint's react-hooks/purity rule doesn't flag it, while
// still resolving "now" fresh on every request.
function thirtyDaysAgoIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function AdmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; view?: string }>;
}) {
  const { page: pageParam, q, view: viewParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const search = (q ?? "").trim();
  const view: ApplicationsView = (VIEW_VALUES as readonly string[]).includes(viewParam ?? "")
    ? (viewParam as ApplicationsView)
    : "active";

  const supabase = await createClient();

  const user = await getCachedUser();
  if (!user) redirect("/login");
  const schoolSlug = await getSchoolSlug();

  const [{ data: schoolUser }, { data: canReview }, { data: canWrite }, { data: canReadFinance }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name, slug, boarding_enabled)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "finance.read" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; slug: string; boarding_enabled: boolean } | null;
  const boardingModuleEnabled = school?.boarding_enabled ?? true;

  // The working-queue table is now filtered (by `view`) + paginated server-side, so it no
  // longer silently truncates at a fixed row count as a school's admissions history grows.
  // Header KPI counts below are deliberately separate, cheap `head: true` counts against the
  // *whole* applications table (independent of `view`/page/search) so they keep reflecting
  // true totals no matter which slice of the list is currently on screen.
  let applicationsQuery = supabase
    .from("applications")
    .select(
      "id, application_number, first_name, last_name, status, application_source, term_id, submitted_at, created_at, assigned_officer_id, school_users!applications_assigned_officer_id_fkey(full_name)",
      { count: "exact" },
    )
    .neq("status", "draft");

  if (view === "active") {
    applicationsQuery = applicationsQuery.not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
  } else if (view === "enrolled") {
    applicationsQuery = applicationsQuery.eq("status", "enrolled");
  } else if (view === "closed") {
    applicationsQuery = applicationsQuery.in("status", ["rejected", "withdrawn"]);
  }
  // view === "all" -> no extra status filter.

  if (search) {
    // Same escaping convention as students/page.tsx's name/admission-number search -- PostgREST's
    // .or() parses commas/parens itself, so an unescaped search term could otherwise inject
    // extra filter clauses.
    const term = escapePostgrestOrValue(`%${search}%`);
    applicationsQuery = applicationsQuery.or(
      `first_name.ilike.${term},last_name.ilike.${term},application_number.ilike.${term}`,
    );
  }

  const from = (page - 1) * APPLICATIONS_PAGE_SIZE;

  const [
    { data: applications, count: applicationsCount },
    { data: drafts },
    { data: turnaroundRows },
    { data: terms },
    { data: feeStructures },
    { count: awaitingReviewCount },
    { count: documentsNeededCount },
    { count: decidedCount },
  ] = await Promise.all([
    applicationsQuery.order("created_at", { ascending: false }).range(from, from + APPLICATIONS_PAGE_SIZE - 1),
    supabase
      .from("applications")
      .select(
        "id, application_number, first_name, last_name, boarding_preference, transport_required, wizard_current_step, updated_at, school_users!applications_assigned_officer_id_fkey(full_name)",
      )
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
    // Task 17: read-only aggregate, no new table/cron -- a straightforward query against the
    // existing submitted_at/decision_at columns, averaged in JS below.
    supabase
      .from("applications")
      .select("submitted_at, decision_at")
      .not("submitted_at", "is", null)
      .not("decision_at", "is", null)
      .gte("decision_at", thirtyDaysAgoIso()),
    // Gap 4 (audit): same early fee-structure-gap warning shown at Admission Details (Step 1),
    // surfaced here too so it's visible at a glance across the whole list, not just once an
    // officer is already inside a given application's wizard.
    supabase.from("terms").select("id, name"),
    supabase.from("fee_structures").select("term_id").eq("is_active", true),
    supabase.from("applications").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review"]),
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("status", "documents_required"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["accepted", "conditionally_accepted", "admission_pending"]),
  ]);

  const termNameById = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const termsWithFeeStructure = new Set((feeStructures ?? []).map((f) => f.term_id));

  const applicationsTotal = applicationsCount ?? 0;
  const isApplicationsFiltered = Boolean(search) || view !== "active";

  const applicationRows: ApplicationRow[] = (applications ?? []).map((a) => {
    const officer = a.school_users as unknown as { full_name: string } | null;
    const feeStructureMissing = !!canReadFinance && !!a.term_id && !termsWithFeeStructure.has(a.term_id);
    const isTerminal = TERMINAL_STATUSES.includes(a.status);
    return {
      id: a.id,
      application_number: a.application_number,
      full_name: `${a.first_name} ${a.last_name}`,
      source_label: a.application_source === "walk_in" ? "Walk-in" : "Online",
      status_tone: STATUS_TONE[a.status] ?? "neutral",
      status_label: STATUS_LABELS[a.status] ?? a.status,
      fee_structure_missing: feeStructureMissing,
      fee_structure_warning_title: feeStructureMissing
        ? `No fee structure configured for ${termNameById.get(a.term_id!) ?? "this term"} — Finance will not be able to invoice until this is fixed.`
        : null,
      officer_name: officer?.full_name ?? null,
      is_assigned: !!a.assigned_officer_id,
      submitted_label: a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—",
      can_claim: !isTerminal,
      can_delete: a.status === "rejected" || a.status === "withdrawn",
    };
  });

  const turnaroundSamples = turnaroundRows ?? [];
  const avgTurnaroundDays =
    turnaroundSamples.length > 0
      ? turnaroundSamples.reduce(
          (sum, a) => sum + (new Date(a.decision_at as string).getTime() - new Date(a.submitted_at as string).getTime()),
          0,
        ) /
        turnaroundSamples.length /
        (1000 * 60 * 60 * 24)
      : null;

  return (
    <AppShell
      breadcrumbs={[{ label: school?.name ?? "EduCore", href: "/dashboard" }, { label: "Admissions" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Admissions</h1>
            <p className="text-sm text-muted-foreground">
              {awaitingReviewCount ?? 0} awaiting review · {documentsNeededCount ?? 0} need documents ·{" "}
              {decidedCount ?? 0} accepted
            </p>
          </div>
          {canWrite && (
            <form action={createWalkInApplication}>
              <Button type="submit" variant="outline">
                + New Walk-In Admission
              </Button>
            </form>
          )}
        </div>

        {school?.slug && (
          <div className="flex items-center justify-between rounded-md border border-dashed border-border p-3">
            <p className="text-sm text-muted-foreground">Families can apply online — share this link:</p>
            <CopyApplicationLink slug={school.slug} />
          </div>
        )}

        {/* Task 17: read-only turnaround-time card, computed above from existing
            submitted_at/decision_at columns -- no new dashboard framework, no scheduled job. */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Average days from submission to decision (last 30 days):</span>
          <span className="font-semibold">
            {avgTurnaroundDays != null ? avgTurnaroundDays.toFixed(1) : "—"}
          </span>
          {avgTurnaroundDays == null && (
            <span className="text-[0.75rem] text-muted-foreground">No decisions recorded in this window yet</span>
          )}
        </div>

        {drafts && drafts.length > 0 && (
          <div className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="flex items-center gap-3">
                <h2 className="text-[0.8125rem] font-semibold">Drafts in progress</h2>
                <span className="text-[0.6875rem] text-muted-foreground">{drafts.length} draft{drafts.length === 1 ? "" : "s"}</span>
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Reference</th>
                    <th>Applicant</th>
                    <th>Progress</th>
                    <th>Assigned officer</th>
                    <th>Last updated</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => {
                    const total = applicableStepCount(
                      {
                        boarding_preference: d.boarding_preference,
                        transport_required: d.transport_required,
                      },
                      boardingModuleEnabled,
                    );
                    const pct = Math.round((((d.wizard_current_step ?? 0) + 1) / total) * 100);
                    const officer = d.school_users as unknown as { full_name: string } | null;
                    const staleness = draftStaleness(d.updated_at);
                    return (
                      <tr key={d.id}>
                        <td className="font-mono text-[0.75rem] text-muted-foreground">{d.application_number}</td>
                        <td className="font-medium">
                          {d.first_name || d.last_name ? `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() : "Not yet entered"}
                        </td>
                        <td className="text-muted-foreground">
                          Step {(d.wizard_current_step ?? 0) + 1} of {total} · {pct}%
                        </td>
                        <td className="text-muted-foreground">{officer?.full_name ?? "Unassigned"}</td>
                        <td className="text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {new Date(d.updated_at).toLocaleString()}
                            {staleness && (
                              <StatusBadge
                                tone={staleness.tone}
                                label={staleness.label}
                                title={`No activity in ${staleness.days} days`}
                              />
                            )}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link href={withSchoolSlug(schoolSlug, `/admissions/${d.id}/wizard`)} className="text-[0.8125rem] font-medium text-primary hover:underline">
                              Resume
                            </Link>
                            {canWrite && (
                              <DeleteApplicationButton
                                applicationId={d.id}
                                applicantLabel={d.first_name || d.last_name ? `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() : d.application_number}
                                deleteAction={discardDraft}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-[0.8125rem] font-semibold">Applications</h2>
        </div>
        {applicationsTotal === 0 && !isApplicationsFiltered ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">No applications yet.</div>
        ) : (
          <ApplicationsTable
            rows={applicationRows}
            totalCount={applicationsTotal}
            pageSize={APPLICATIONS_PAGE_SIZE}
            canReview={!!canReview}
            canWrite={!!canWrite}
            claimAction={claimApplicationAction}
            deleteAction={deleteApplicationPermanentlyAction}
          />
        )}
      </div>
    </AppShell>
  );
}
