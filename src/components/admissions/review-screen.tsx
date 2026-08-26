"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DocumentPreviewButton } from "@/components/document-preview-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  markUnderReviewAction,
  verifyDocumentAction,
  rejectDocumentAction,
  requestDocumentAction,
  scheduleInterviewAction,
  recordAssessmentAction,
  decideApplicationAction,
  markConditionsMetAction,
} from "@/app/(app)/admissions/actions";

export interface ApplicationDetail {
  id: string;
  application_number: string;
  status: string;
  application_source: string;
  admission_type: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  date_of_birth: string;
  gender: string;
  nationality: string | null;
  id_number: string | null;
  previous_school: string | null;
  previous_class: string | null;
  special_needs_info: string | null;
  notes: string | null;
  guardian_name: string;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_relationship: string | null;
  boarding_preference: string | null;
  transport_required: boolean;
  interview_date: string | null;
  assessment_date: string | null;
  assessment_type: string | null;
  assessment_subject: string | null;
  assessment_score: number | null;
  assessment_comments: string | null;
  decision_at: string | null;
  decision_notes: string | null;
  submitted_at: string | null;
  created_at: string;
  enrolled_student_admission_number: string | null;
  access_token: string;
}

export interface DocumentRequirementRow {
  category: string;
  label: string;
  required: boolean;
  document: {
    id: string;
    file_name: string;
    storage_path: string;
    storage_bucket: string;
    verification_status: "pending" | "verified" | "rejected";
    verification_comment: string | null;
  } | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
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
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  admission_pending: "Accepted — admission in progress",
  enrolled: "Enrolled",
};

const DECIDED_STATUSES = ["accepted", "conditionally_accepted", "waitlisted", "rejected", "admission_pending", "enrolled", "withdrawn"];

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-[0.8125rem]">{value || "—"}</p>
    </div>
  );
}

export function ReviewScreen({
  application,
  requirements,
  canWrite,
  schoolSlug,
  termOptions = [],
  streamOptions = [],
}: {
  application: ApplicationDetail;
  requirements: DocumentRequirementRow[];
  canWrite: boolean;
  schoolSlug: string;
  termOptions?: { id: string; label: string }[];
  streamOptions?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rejectingDoc, setRejectingDoc] = useState<{ id: string; label: string } | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const [requestingDoc, setRequestingDoc] = useState<string | null>(null);

  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewDate, setInterviewDate] = useState("");

  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentType, setAssessmentType] = useState("");
  const [assessmentSubject, setAssessmentSubject] = useState("");
  const [assessmentScore, setAssessmentScore] = useState("");
  const [assessmentComments, setAssessmentComments] = useState("");

  const [decisionOpen, setDecisionOpen] = useState<"accept" | "conditionally_accept" | "waitlist" | "reject" | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [decisionTermId, setDecisionTermId] = useState("");
  const [decisionStreamId, setDecisionStreamId] = useState("");
  const [reconsidering, setReconsidering] = useState(false);

  const decided = DECIDED_STATUSES.includes(application.status);
  // A rejected/waitlisted decision can be reopened without the applicant reapplying — the
  // underlying decideApplicationAction has no state-machine restriction, this just unlocks
  // the same decision buttons again for these two reversible outcomes.
  const reconsiderable = application.status === "rejected" || application.status === "waitlisted";
  const statusLink = typeof window !== "undefined" ? `${window.location.origin}/apply/${schoolSlug}/status/${application.access_token}` : "";

  async function run<T extends { error: string } | { success: true }>(fn: () => Promise<T>) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel p-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              {application.first_name} {application.other_names ? `${application.other_names} ` : ""}
              {application.last_name}
            </h1>
            <p className="font-mono text-[0.75rem] text-muted-foreground">{application.application_number}</p>
            {application.status === "enrolled" && application.enrolled_student_admission_number && (
              <p className="text-xs text-success">Enrolled as Student {application.enrolled_student_admission_number}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={decided ? "success" : "info"} label={STATUS_LABELS[application.status] ?? application.status} />
            {canWrite && application.status === "submitted" && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markUnderReviewAction(application.id))}>
                Start review
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[0.75rem] text-muted-foreground">
          {application.application_source === "walk_in" ? "Walk-in" : "Online"} application · submitted{" "}
          {application.submitted_at ? new Date(application.submitted_at).toLocaleString() : "—"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-3 text-[0.8125rem] font-semibold">Student details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth" value={new Date(application.date_of_birth).toLocaleDateString()} />
            <Field label="Gender" value={application.gender} />
            <Field label="Nationality" value={application.nationality} />
            <Field label="ID number" value={application.id_number} />
            <Field label="Previous school" value={application.previous_school} />
            <Field label="Previous class" value={application.previous_class} />
            <Field label="Admission type" value={application.admission_type} />
            <Field label="Boarding preference" value={application.boarding_preference ?? "Not specified"} />
            <Field label="Transport required" value={application.transport_required ? "Yes" : "No"} />
          </div>
          {application.special_needs_info && (
            <div className="mt-3">
              <Field label="Special needs / support" value={application.special_needs_info} />
            </div>
          )}
          {application.notes && (
            <div className="mt-3">
              <Field label="Notes" value={application.notes} />
            </div>
          )}
        </div>

        <div className="panel p-4">
          <h2 className="mb-3 text-[0.8125rem] font-semibold">Guardian</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" value={application.guardian_name} />
            <Field label="Relationship" value={application.guardian_relationship} />
            <Field label="Phone" value={application.guardian_phone} />
            <Field label="Email" value={application.guardian_email} />
          </div>
          <div className="mt-4 rounded-md border border-dashed border-border p-2.5">
            <p className="text-[0.6875rem] text-muted-foreground">Applicant status/upload link</p>
            <p className="break-all font-mono text-[0.6875rem]">{statusLink}</p>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 text-[0.8125rem] font-semibold">Documents</h2>
        {requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground">No document requirements configured.</p>
        ) : (
          <div className="space-y-3">
            {requirements.map((req) => (
              <div key={req.category} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8125rem] font-medium">
                    {req.label} {req.required && <span className="text-danger">*</span>}
                  </p>
                  {req.document ? (
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge
                        tone={req.document.verification_status === "verified" ? "success" : req.document.verification_status === "rejected" ? "danger" : "neutral"}
                        label={req.document.verification_status}
                      />
                      <span className="truncate text-[0.75rem] text-muted-foreground">{req.document.file_name}</span>
                    </div>
                  ) : (
                    <p className="text-[0.75rem] text-muted-foreground">Not uploaded</p>
                  )}
                  {req.document?.verification_comment && (
                    <p className="mt-1 text-[0.75rem] text-danger">{req.document.verification_comment}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {req.document && (
                    <DocumentPreviewButton bucket={req.document.storage_bucket} storagePath={req.document.storage_path} fileName={req.document.file_name} />
                  )}
                {canWrite && (
                  <>
                    {req.document && req.document.verification_status !== "verified" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => verifyDocumentAction(req.document!.id))}>
                        Verify
                      </Button>
                    )}
                    {req.document && req.document.verification_status !== "rejected" && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejectingDoc({ id: req.document!.id, label: req.label })}>
                        Reject
                      </Button>
                    )}
                    {!req.document && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => setRequestingDoc(req.label)}>
                        Request
                      </Button>
                    )}
                  </>
                )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[0.8125rem] font-semibold">Interview</h2>
            {canWrite && (
              <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    {application.interview_date ? "Reschedule" : "Schedule"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Schedule interview</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-1.5">
                    <Label>Date &amp; time</Label>
                    <Input type="datetime-local" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={pending || !interviewDate}
                      onClick={async () => {
                        const ok = await run(() => scheduleInterviewAction(application.id, new Date(interviewDate).toISOString()));
                        if (ok) setInterviewOpen(false);
                      }}
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <Field label="Scheduled for" value={application.interview_date ? new Date(application.interview_date).toLocaleString() : null} />
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[0.8125rem] font-semibold">Assessment</h2>
            {canWrite && (
              <Dialog open={assessmentOpen} onOpenChange={setAssessmentOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    {application.assessment_date ? "Update" : "Record"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Record assessment</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Input value={assessmentType} onChange={(e) => setAssessmentType(e.target.value)} placeholder="e.g. Entrance test" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Subject</Label>
                      <Input value={assessmentSubject} onChange={(e) => setAssessmentSubject(e.target.value)} placeholder="e.g. Mathematics" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Score</Label>
                      <Input type="number" value={assessmentScore} onChange={(e) => setAssessmentScore(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Comments</Label>
                      <Textarea rows={2} value={assessmentComments} onChange={(e) => setAssessmentComments(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={pending}
                      onClick={async () => {
                        const ok = await run(() =>
                          recordAssessmentAction(application.id, {
                            assessment_type: assessmentType,
                            assessment_subject: assessmentSubject,
                            assessment_score: assessmentScore ? Number(assessmentScore) : null,
                            assessment_comments: assessmentComments,
                          }),
                        );
                        if (ok) setAssessmentOpen(false);
                      }}
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" value={application.assessment_type} />
            <Field label="Score" value={application.assessment_score?.toString()} />
          </div>
          {application.assessment_comments && <div className="mt-2"><Field label="Comments" value={application.assessment_comments} /></div>}
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="mb-3 text-[0.8125rem] font-semibold">Decision</h2>
        {decided && !(reconsiderable && reconsidering) ? (
          <div>
            <StatusBadge tone={application.status === "rejected" ? "danger" : application.status === "waitlisted" ? "warning" : "success"} label={STATUS_LABELS[application.status] ?? application.status} />
            {application.decision_notes && <p className="mt-2 text-[0.8125rem] text-muted-foreground">{application.decision_notes}</p>}
            {application.decision_at && (
              <p className="mt-1 text-[0.75rem] text-muted-foreground">Decided {new Date(application.decision_at).toLocaleString()}</p>
            )}
            {application.status === "conditionally_accepted" && canWrite && (
              <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={() => run(() => markConditionsMetAction(application.id))}>
                Conditions met — move to Admission Pending
              </Button>
            )}
            {(application.status === "admission_pending" || application.status === "conditionally_accepted") && canWrite && (
              <Button size="sm" className="mt-3 ml-2" asChild>
                <Link href={`/admissions/${application.id}/wizard`}>Continue Admission</Link>
              </Button>
            )}
            {reconsiderable && canWrite && (
              <Button size="sm" variant="outline" className="mt-3 ml-2" onClick={() => setReconsidering(true)}>
                Reconsider
              </Button>
            )}
          </div>
        ) : canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            {reconsiderable && reconsidering && (
              <p className="w-full text-[0.75rem] text-muted-foreground">
                Currently {STATUS_LABELS[application.status]?.toLowerCase()}. Choose a new decision below — no reapplication needed.
              </p>
            )}
            <Button size="sm" onClick={() => setDecisionOpen("accept")}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDecisionOpen("conditionally_accept")}>
              Conditionally accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDecisionOpen("waitlist")}>
              Waitlist
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDecisionOpen("reject")}>
              Reject
            </Button>
            {reconsiderable && reconsidering && (
              <Button size="sm" variant="ghost" onClick={() => setReconsidering(false)}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Awaiting a decision.</p>
        )}
      </div>

      {/* Reject document dialog */}
      <Dialog open={rejectingDoc !== null} onOpenChange={(o) => !o && setRejectingDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectingDoc?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea rows={2} value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} placeholder="e.g. Image is blurry, please re-upload" />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || !rejectComment.trim()}
              onClick={async () => {
                if (!rejectingDoc) return;
                const ok = await run(() => rejectDocumentAction(rejectingDoc.id, rejectComment));
                if (ok) {
                  setRejectingDoc(null);
                  setRejectComment("");
                }
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request document dialog */}
      <Dialog open={requestingDoc !== null} onOpenChange={(o) => !o && setRequestingDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request {requestingDoc}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This notifies the guardian by SMS and moves the application to &quot;Documents needed&quot; until they upload it.
          </p>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={async () => {
                if (!requestingDoc) return;
                const ok = await run(() => requestDocumentAction(application.id, requestingDoc));
                if (ok) setRequestingDoc(null);
              }}
            >
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decision dialog */}
      <Dialog open={decisionOpen !== null} onOpenChange={(o) => !o && setDecisionOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionOpen === "accept" && "Accept application"}
              {decisionOpen === "conditionally_accept" && "Conditionally accept application"}
              {decisionOpen === "waitlist" && "Waitlist application"}
              {decisionOpen === "reject" && "Reject application"}
            </DialogTitle>
          </DialogHeader>
          {decisionOpen === "accept" && application.application_source === "online" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Term</Label>
                <Select value={decisionTermId} onValueChange={setDecisionTermId}>
                  <SelectTrigger><SelectValue placeholder="Select term" /></SelectTrigger>
                  <SelectContent>
                    {termOptions.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select value={decisionStreamId} onValueChange={setDecisionStreamId}>
                  <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    {streamOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className="col-span-full text-[0.75rem] text-muted-foreground">
                Needed now so the fee structure in the acceptance email is accurate — not deferred to enrollment.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Notes {decisionOpen === "conditionally_accept" && "(conditions)"}  {decisionOpen === "reject" && "(reason, optional)"}</Label>
            <Textarea rows={2} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
          </div>
          <p className="text-[0.75rem] text-muted-foreground">
            The guardian will be notified by SMS
            {decisionOpen === "accept" && application.application_source === "online" && ", and emailed the admission form if one is configured"}.
          </p>
          <DialogFooter>
            <Button
              variant={decisionOpen === "reject" ? "destructive" : "default"}
              disabled={
                pending ||
                (decisionOpen === "accept" && application.application_source === "online" && (!decisionTermId || !decisionStreamId))
              }
              onClick={async () => {
                if (!decisionOpen) return;
                const admissionDetails =
                  decisionOpen === "accept" && application.application_source === "online"
                    ? { term_id: decisionTermId, intended_class_id: decisionStreamId }
                    : undefined;
                const ok = await run(() => decideApplicationAction(application.id, decisionOpen, decisionNotes, admissionDetails));
                if (ok) {
                  setDecisionOpen(null);
                  setDecisionNotes("");
                  setDecisionTermId("");
                  setDecisionStreamId("");
                }
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
