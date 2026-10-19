"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { updateReportSettings } from "@/app/(app)/settings/report-settings-actions";
import type { ReportSettings } from "@/lib/academics/report-settings";

const OPTIONS: { key: keyof ReportSettings; label: string; hint: string }[] = [
  {
    key: "rankingEnabled",
    label: "Show learner positions (ranking)",
    hint: "Positions appear on mark sheets, report cards and the parent portal. Turn off if your school does not rank learners. Averages are still shown.",
  },
  { key: "showCompetencyRatings", label: "Show competency ratings on report cards", hint: "The CBC strand and sub-strand ratings table." },
  { key: "showSignatures", label: "Show signature lines", hint: "Class teacher, principal and parent lines on report cards, and the prepared-by / verified-by block on mark sheets." },
  { key: "showClassStatistics", label: "Show class statistics on mark sheets", hint: "Class mean, highest and lowest (or the performance-level summary for competency-based exams)." },
];

export function ReportSettingsForm({ initial, canWrite }: { initial: ReportSettings; canWrite: boolean }) {
  const router = useRouter();
  const [settings, setSettings] = useState<ReportSettings>(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    const result = await updateReportSettings(settings);
    setPending(false);
    if ("error" in result) return setMessage({ ok: false, text: result.error });
    setMessage({ ok: true, text: "Report settings saved." });
    router.refresh();
  }

  return (
    <div className="panel max-w-2xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">Choose what appears on this school&apos;s mark sheets and report cards. New settings default to on.</p>
      {OPTIONS.map((o) => (
        <div key={o.key} className="flex items-start gap-3">
          <Checkbox id={`rs-${o.key}`} checked={settings[o.key]} disabled={!canWrite} onCheckedChange={(v) => setSettings((s) => ({ ...s, [o.key]: v === true }))} />
          <Label htmlFor={`rs-${o.key}`} className="flex-1 font-normal">
            <span className="font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.hint}</span>
          </Label>
        </div>
      ))}
      {!canWrite && <p className="text-sm text-muted-foreground">You can view these settings but only exam administrators can change them.</p>}
      {message && <p className={message.ok ? "text-sm text-success" : "text-sm text-danger"}>{message.text}</p>}
      {canWrite && (
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      )}
    </div>
  );
}
