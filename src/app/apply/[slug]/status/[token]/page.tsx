import { notFound } from "next/navigation";
import { getApplicationByToken } from "./actions";
import { StatusUploadSection } from "./status-upload-section";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted — awaiting review",
  under_review: "Under review",
  documents_required: "Documents needed",
  // 'shortlisted' and 'assessment_required' are reserved for a future shortlisting/
  // assessment step — no code path currently sets an application to either status.
  shortlisted: "Shortlisted",
  interview_scheduled: "Interview scheduled",
  assessment_required: "Assessment required",
  accepted: "Accepted",
  conditionally_accepted: "Conditionally accepted",
  waitlisted: "Waitlisted",
  rejected: "Not successful",
  withdrawn: "Withdrawn",
  admission_pending: "Accepted — admission in progress",
  enrolled: "Enrolled",
};

export default async function ApplicationStatusPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { token } = await params;
  const result = await getApplicationByToken(token);

  if ("error" in result) notFound();

  const { data } = result;

  return (
    <div className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        <div className="rounded-md border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">
            {data.first_name} {data.last_name}
          </h1>
          <p className="text-sm text-muted-foreground">{data.school_name}</p>
          <p className="mt-1 font-mono text-[0.75rem] text-muted-foreground">{data.application_number}</p>

          <div className="mt-4 rounded-md bg-muted p-3">
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="text-sm font-medium">{STATUS_LABELS[data.status] ?? data.status}</p>
          </div>

          {data.admission_response_note && (data.status === "submitted" || data.status === "under_review") && (
            <p className="mt-3 text-sm text-muted-foreground">{data.admission_response_note}</p>
          )}

          {data.status === "documents_required" && (
            <p className="mt-3 text-sm text-warning">
              The school needs one or more documents from you — see below.
            </p>
          )}
          {data.decision_notes && (data.status === "rejected" || data.status === "waitlisted" || data.status === "conditionally_accepted") && (
            <p className="mt-3 text-sm text-muted-foreground">{data.decision_notes}</p>
          )}
        </div>

        {data.requirements.length > 0 && (
          <div className="rounded-md border border-border bg-surface p-6">
            <h2 className="mb-3 text-sm font-medium">Documents</h2>
            <StatusUploadSection token={token} requirements={data.requirements} />
          </div>
        )}
      </div>
    </div>
  );
}
