"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  saveProspectSequence,
  sendCampaignTestEmail,
  type SequenceConfig,
  type SequenceStep,
} from "@/app/(admin)/admin/email-campaigns/actions";

type StepDraft = Pick<SequenceStep, "step_number" | "delay_days" | "subject" | "body" | "active">;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminProspectSequence({ config }: { config: SequenceConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(config.enabled);
  const [steps, setSteps] = useState<StepDraft[]>(
    config.steps.map(({ step_number, delay_days, subject, body, active }) => ({
      step_number,
      delay_days,
      subject,
      body,
      active,
    })),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stats = new Map(config.steps.map((s) => [s.step_number, s]));

  function update(stepNumber: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.step_number === stepNumber ? { ...s, ...patch } : s)));
  }

  function handleSave() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveProspectSequence(enabled, steps);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setNotice(enabled ? "Saved. The sequence is ON." : "Saved. The sequence is OFF.");
      router.refresh();
    });
  }

  function handleTest(step: StepDraft) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendCampaignTestEmail(step.subject, step.body, "prospects");
      if ("error" in res) setError(res.error);
      else setNotice(`Test of step ${step.step_number} sent to ${res.sentTo}.`);
    });
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-[0.8125rem] font-semibold">Automated prospect sequence</h2>
        <p className="text-xs text-muted-foreground">
          A short series of emails sent automatically to new prospects (demo requests and checklist downloads). Runs
          once a day at 11:00 Nairobi time. Only prospects who arrive after you first switch this on are enrolled, so
          your existing list is never emailed by it; use a manual campaign for that list. Each step is spaced from when
          the previous one was sent, and a prospect stops getting emails as soon as they unsubscribe or are onboarded
          to a school. Step 1 is skipped for anyone first seen more than 30 days ago.
        </p>
        {config.enabled_at && (
          <p className="text-xs text-muted-foreground">First switched on: {formatDate(config.enabled_at)}.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-success">{notice}</p>}

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={pending} />
        Sequence is {enabled ? "ON" : "OFF"}
      </label>

      <div className="flex flex-col gap-3">
        {steps.map((step) => {
          const stat = stats.get(step.step_number);
          return (
            <div key={step.step_number} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">Step {step.step_number}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={step.active}
                    disabled={pending}
                    onChange={(e) => update(step.step_number, { active: e.target.checked })}
                  />
                  Active
                </label>
                <label className="flex items-center gap-1 text-xs">
                  {step.step_number === 1 ? "Days after signup" : "Days after signup (total)"}
                  <Input
                    type="number"
                    min={0}
                    max={90}
                    className="w-20"
                    value={step.delay_days}
                    disabled={pending}
                    onChange={(e) => update(step.step_number, { delay_days: Number(e.target.value) })}
                  />
                </label>
                {stat && (
                  <span className="text-xs text-muted-foreground">
                    {stat.sent} sent{stat.failed > 0 ? `, ${stat.failed} failed` : ""}
                  </span>
                )}
              </div>
              <Input
                value={step.subject}
                maxLength={200}
                disabled={pending}
                onChange={(e) => update(step.step_number, { subject: e.target.value })}
                placeholder="Subject"
              />
              <Textarea
                value={step.body}
                maxLength={10000}
                rows={6}
                disabled={pending}
                onChange={(e) => update(step.step_number, { body: e.target.value })}
              />
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !step.subject.trim() || !step.body.trim()}
                  onClick={() => handleTest(step)}
                >
                  Send test of this step to me
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <Button disabled={pending} onClick={handleSave}>
          {pending ? "Saving…" : "Save sequence"}
        </Button>
      </div>
    </div>
  );
}
