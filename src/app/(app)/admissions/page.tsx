import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { CopyApplicationLink } from "@/components/admissions/copy-application-link";
import { DeleteApplicationButton } from "@/components/admissions/delete-application-button";
import { ClaimApplicationButton } from "@/components/admissions/claim-application-button";
import { createWalkInApplication } from "./walk-in-actions";
import { deleteApplicationPermanentlyAction, claimApplicationAction } from "./actions";
import { discardDraft } from "./[id]/wizard/actions";
import { applicableStepCount } from "./wizard-steps";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  submitted: "info",
  under_review: "info",
  documents_required: "warning",
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
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview scheduled",
  assessment_required: "Assessment required",
  accepted: "Accepted",
  conditionally_accepted: "Conditionally accepted",
  waitlisted: "Waitlisted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  admission_pending: "Admission pending",
  enrolled: "Enrolled",
};

const ACTIVE_STATUSES = [
  "submitted",
  "under_review",
  "documents_required",
  "shortlisted",
  "interview_scheduled",
  "assessment_required",
];

export default async function AdmissionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReview }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name, slug)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; slug: string } | null;

  const [{ data: applications }, { data: drafts }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, application_number, first_name, last_name, status, application_source, submitted_at, created_at, assigned_officer_id, school_users!applications_assigned_officer_id_fkey(full_name)",
      )
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("applications")
      .select(
        "id, application_number, first_name, last_name, boarding_preference, transport_required, wizard_current_step, updated_at, school_users!applications_assigned_officer_id_fkey(full_name)",
      )
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
  ]);

  const rows = applications ?? [];
  const counts = ACTIVE_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: rows.filter((r) => r.status === s).length }),
    {} as Record<string, number>,
  );
  const decidedCount = rows.filter((r) => ["accepted", "conditionally_accepted", "admission_pending"].includes(r.status)).length;

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
              {counts.submitted + counts.under_review} awaiting review · {counts.documents_required} need documents ·{" "}
              {decidedCount} accepted
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
                    const total = applicableStepCount({
                      boarding_preference: d.boarding_preference,
                      transport_required: d.transport_required,
                    });
                    const pct = Math.round((((d.wizard_current_step ?? 0) + 1) / total) * 100);
                    const officer = d.school_users as unknown as { full_name: string } | null;
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
                        <td className="text-muted-foreground">{new Date(d.updated_at).toLocaleString()}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link href={`/admissions/${d.id}/wizard`} className="text-[0.8125rem] font-medium text-primary hover:underline">
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

        <div className="panel">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-3">
              <h2 className="text-[0.8125rem] font-semibold">Applications</h2>
              <span className="text-[0.6875rem] text-muted-foreground">
                {rows.length} total
              </span>
            </div>
          </header>
          {rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dense w-full">
                <thead className="bg-muted/70">
                  <tr>
                    <th>Applicant</th>
                    <th>Reference</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Assigned officer</th>
                    <th>Submitted</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const officer = a.school_users as unknown as { full_name: string } | null;
                    return (
                      <tr key={a.id}>
                        <td className="font-medium">
                          {a.first_name} {a.last_name}
                        </td>
                        <td className="font-mono text-[0.75rem] text-muted-foreground">{a.application_number}</td>
                        <td className="text-muted-foreground">{a.application_source === "walk_in" ? "Walk-in" : "Online"}</td>
                        <td>
                          <StatusBadge tone={STATUS_TONE[a.status] ?? "neutral"} label={STATUS_LABELS[a.status] ?? a.status} />
                        </td>
                        <td className="text-muted-foreground">{officer?.full_name ?? "Unassigned"}</td>
                        <td className="text-muted-foreground">
                          {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-3">
                            {canReview && (
                              <Link href={`/admissions/${a.id}`} className="text-[0.8125rem] font-medium text-primary hover:underline">
                                Review
                              </Link>
                            )}
                            {canWrite && (
                              <ClaimApplicationButton
                                applicationId={a.id}
                                isAssigned={!!a.assigned_officer_id}
                                claimAction={claimApplicationAction}
                              />
                            )}
                            {canWrite && (a.status === "rejected" || a.status === "withdrawn") && (
                              <DeleteApplicationButton
                                applicationId={a.id}
                                applicantLabel={`${a.first_name} ${a.last_name}`}
                                deleteAction={deleteApplicationPermanentlyAction}
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
          )}
        </div>
      </div>
    </AppShell>
  );
}
