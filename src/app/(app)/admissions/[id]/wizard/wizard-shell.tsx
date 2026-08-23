"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveWizardStep, discardDraft } from "./actions";
import {
  AdmissionDetailsStep, StudentStep, GuardianStep, DocumentsStep, AcademicsStep,
  BoardingStep, TransportStep, HealthStep, FinanceStep, ReviewStep, CompleteStep,
  type ReviewSummary,
} from "./step-forms";
import type { WizardStepData } from "./wizard-data";
import type { EnrollmentResult } from "./actions";

export interface WizardStep {
  id: string;
  label: string;
  /** Whether this step applies to this particular admission — the dynamic skip logic
   *  (Brief 4.16.9: "must be dynamic, skipping irrelevant steps"). */
  applicable: boolean;
  /** Fallback note for steps that don't yet have a real form (Review/Complete — Phase 13). */
  note: string;
}

export function WizardShell({
  applicationId,
  applicantLabel,
  steps,
  initialStep,
  data,
}: {
  applicationId: string;
  applicantLabel: string;
  steps: WizardStep[];
  initialStep: number;
  data: WizardStepData;
}) {
  const router = useRouter();
  const applicableSteps = steps.filter((s) => s.applicable);
  const clampedInitial = Math.min(initialStep, applicableSteps.length - 1);
  const [currentIndex, setCurrentIndex] = useState(Math.max(clampedInitial, 0));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = applicableSteps[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === applicableSteps.length - 1;
  const progressPct = Math.round(((currentIndex + 1) / applicableSteps.length) * 100);
  const [enrolled, setEnrolled] = useState<EnrollmentResult | null>(data.enrollmentResult);

  function navigateToStepId(stepId: string) {
    const idx = applicableSteps.findIndex((s) => s.id === stepId);
    if (idx >= 0) goTo(idx);
  }

  const bedLabel = (() => {
    if (!data.currentBedId) return null;
    for (const h of data.houseOptions) {
      for (const d of h.dormitories) {
        for (const r of d.rooms) {
          const bed = r.beds.find((b) => b.id === data.currentBedId);
          if (bed) return `${h.name} / ${d.name} / Room ${r.room_number} / Bed ${bed.bed_number}`;
        }
      }
    }
    return null;
  })();

  const verifiedCount = data.documents.filter((d) => d.verification_status === "verified").length;
  const requiredCount = data.documentRequirements.filter((r) => r.required).length;

  const reviewSummary: ReviewSummary = {
    admissionType: data.application.admission_type,
    academicYearLabel: data.academicYears.find((y) => y.id === data.application.academic_year_id)?.name ?? null,
    termLabel: data.terms.find((t) => t.id === data.application.term_id)?.name ?? null,
    studentName: `${data.application.first_name} ${data.application.last_name}`,
    admissionNumber: data.admissionNumber,
    guardianName: data.guardian?.full_name ?? null,
    guardianRelationship: data.guardian?.relationship ?? null,
    documentsSummary: data.documentRequirements.length > 0 ? `${verifiedCount}/${requiredCount} required documents verified` : "No document checklist configured",
    streamLabel: data.streamOptions.find((s) => s.id === data.currentStreamId)?.label ?? null,
    boardingLabel: bedLabel,
    transportLabel: data.hasTransportAssignment ? "Assigned" : null,
    financeTotal: null,
  };

  function goTo(index: number) {
    setError(null);
    startTransition(async () => {
      const result = await saveWizardStep(applicationId, index);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setCurrentIndex(index);
    });
  }

  function handleDiscard() {
    setError(null);
    startTransition(async () => {
      const result = await discardDraft(applicationId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push("/admissions");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {currentIndex + 1} of {applicableSteps.length}
          </span>
          <span>{progressPct}% complete</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {applicableSteps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            disabled={pending}
            onClick={() => goTo(i)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              i === currentIndex
                ? "border-primary bg-primary text-primary-foreground"
                : i < currentIndex
                  ? "border-success/25 bg-success-subtle text-success"
                  : "border-border bg-surface text-muted-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && <p className="rounded-md border border-danger/25 bg-destructive-subtle px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="panel min-h-64 p-6">
        <p className="label-eyebrow">
          {applicantLabel} · Step {currentIndex + 1}
        </p>
        <div className="mt-3">
          {current.id === "admission_details" && (
            <AdmissionDetailsStep applicationId={applicationId} academicYears={data.academicYears} terms={data.terms} initial={data.application} />
          )}
          {current.id === "student" && (
            <StudentStep applicationId={applicationId} applicantSummary={data.application} resultingStudentId={data.resultingStudentId} />
          )}
          {current.id === "guardian" && (
            <GuardianStep applicationId={applicationId} resultingStudentId={data.resultingStudentId} />
          )}
          {current.id === "documents" && (
            <DocumentsStep applicationId={applicationId} requirements={data.documentRequirements} documents={data.documents} />
          )}
          {current.id === "academics" && (
            <AcademicsStep applicationId={applicationId} streamOptions={data.streamOptions} currentStreamId={data.currentStreamId} />
          )}
          {current.id === "boarding" && (
            <BoardingStep applicationId={applicationId} houseOptions={data.houseOptions} currentBedId={data.currentBedId} />
          )}
          {current.id === "transport" && (
            <TransportStep applicationId={applicationId} routeOptions={data.routeOptions} vehicleOptions={data.vehicleOptions} hasAssignment={data.hasTransportAssignment} />
          )}
          {current.id === "health" && (
            <HealthStep applicationId={applicationId} initial={data.medicalRecord} canWrite={data.canWriteMedical} />
          )}
          {current.id === "finance" && (
            <FinanceStep
              applicationId={applicationId}
              hasStudentAndTerm={!!data.resultingStudentId && !!data.application.term_id}
              canWrite={data.canWriteFinance}
              initial={data.financeDecision}
              resultingStudentId={data.resultingStudentId}
              mpesaActive={data.mpesaActive}
            />
          )}
          {(current.id === "review") && (
            <ReviewStep applicationId={applicationId} summary={reviewSummary} onNavigateToStep={navigateToStepId} />
          )}
          {(current.id === "complete") && (
            <CompleteStep
              applicationId={applicationId}
              applicantName={`${data.application.first_name} ${data.application.last_name}`}
              alreadyEnrolled={enrolled}
              onCompleted={setEnrolled}
            />
          )}
        </div>
      </div>

      {current.id !== "complete" && (
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={handleDiscard}>
            Discard draft
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending || isFirst} onClick={() => goTo(currentIndex - 1)}>
              Back
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() => (isLast ? router.push("/admissions") : goTo(currentIndex + 1))}
            >
              {isLast ? "Save and exit" : "Next"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
