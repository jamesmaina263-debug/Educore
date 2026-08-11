import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { CopyApplicationLink } from "@/components/admissions/copy-application-link";

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

  const [{ data: schoolUser }, { data: canReview }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name, slug)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "admissions.read_any" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const school = schoolUser?.schools as unknown as { name: string; slug: string } | null;

  const { data: applications } = await supabase
    .from("applications")
    .select("id, application_number, first_name, last_name, status, application_source, submitted_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

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
        <div>
          <h1 className="text-lg font-semibold">Admissions</h1>
          <p className="text-sm text-muted-foreground">
            {counts.submitted + counts.under_review} awaiting review · {counts.documents_required} need documents ·{" "}
            {decidedCount} accepted
          </p>
        </div>

        {school?.slug && (
          <div className="flex items-center justify-between rounded-md border border-dashed border-border p-3">
            <p className="text-sm text-muted-foreground">Families can apply online — share this link:</p>
            <CopyApplicationLink slug={school.slug} />
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
                    <th>Submitted</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">
                        {a.first_name} {a.last_name}
                      </td>
                      <td className="font-mono text-[0.75rem] text-muted-foreground">{a.application_number}</td>
                      <td className="text-muted-foreground">{a.application_source === "walk_in" ? "Walk-in" : "Online"}</td>
                      <td>
                        <StatusBadge tone={STATUS_TONE[a.status] ?? "neutral"} label={STATUS_LABELS[a.status] ?? a.status} />
                      </td>
                      <td className="text-muted-foreground">
                        {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="text-right">
                        {canReview && (
                          <Link href={`/admissions/${a.id}`} className="text-[0.8125rem] font-medium text-primary hover:underline">
                            Review
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
