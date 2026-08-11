"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveWizardStep, discardDraft } from "./actions";

export interface WizardStep {
  id: string;
  label: string;
  /** Whether this step applies to this particular admission — the dynamic skip logic
   *  (Brief 4.16.9: "must be dynamic, skipping irrelevant steps"). */
  applicable: boolean;
  /** Phase 11 builds only the shell; each step's real form is Phase 12's job. */
  note: string;
}

export function WizardShell({
  applicationId,
  applicantLabel,
  steps,
  initialStep,
}: {
  applicationId: string;
  applicantLabel: string;
  steps: WizardStep[];
  initialStep: number;
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
        <h2 className="mt-1 text-lg font-semibold">{current.label}</h2>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">{current.note}</p>
      </div>

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
    </div>
  );
}
