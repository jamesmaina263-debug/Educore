"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveReportFormLayout } from "@/app/(app)/settings/report-form-actions";
import { DEFAULT_WORDING, REPORT_FORM_LIMITS, type ReportFormLayout } from "@/lib/academics/report-form-layout";

type Text = Record<keyof ReportFormLayout, string>;

const toText = (l: ReportFormLayout): Text => ({
  title: l.title ?? "",
  subtitle: l.subtitle ?? "",
  footerNote: l.footerNote ?? "",
  classTeacherLabel: l.classTeacherLabel ?? "",
  headTeacherLabel: l.headTeacherLabel ?? "",
  parentLabel: l.parentLabel ?? "",
});
const toLayout = (t: Text): ReportFormLayout => ({
  title: t.title.trim() || null,
  subtitle: t.subtitle.trim() || null,
  footerNote: t.footerNote.trim() || null,
  classTeacherLabel: t.classTeacherLabel.trim() || null,
  headTeacherLabel: t.headTeacherLabel.trim() || null,
  parentLabel: t.parentLabel.trim() || null,
});

const FIELDS: { key: keyof ReportFormLayout; label: string; hint: string; max: number; placeholder?: string }[] = [
  { key: "title", label: "Report title", hint: "Shown in the header before the exam name.", max: REPORT_FORM_LIMITS.title, placeholder: DEFAULT_WORDING.title },
  { key: "subtitle", label: "Subtitle or motto", hint: "A line under the school name. Leave blank for none.", max: REPORT_FORM_LIMITS.subtitle },
  { key: "footerNote", label: "Footer note", hint: "A line at the bottom of every report card, for example payment or term-opening dates. Leave blank for none.", max: REPORT_FORM_LIMITS.footerNote },
  { key: "classTeacherLabel", label: "Class teacher label", hint: "Signature line and comment heading.", max: REPORT_FORM_LIMITS.label, placeholder: DEFAULT_WORDING.classTeacherLabel },
  { key: "headTeacherLabel", label: "Head teacher label", hint: "Signature line and comment heading.", max: REPORT_FORM_LIMITS.label, placeholder: DEFAULT_WORDING.headTeacherLabel },
  { key: "parentLabel", label: "Parent label", hint: "Signature line and acknowledgement heading.", max: REPORT_FORM_LIMITS.label, placeholder: DEFAULT_WORDING.parentLabel },
];

export function ReportFormDesigner({ initial, canWrite }: { initial: ReportFormLayout; canWrite: boolean }) {
  const router = useRouter();
  const [text, setText] = useState<Text>(toText(initial));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: Text) {
    setPending(true);
    setMessage(null);
    const result = await saveReportFormLayout(toLayout(next));
    setPending(false);
    if ("error" in result) return setMessage({ ok: false, text: result.error });
    setMessage({ ok: true, text: "Report form saved. New and reprinted report cards use it straight away." });
    router.refresh();
  }

  return (
    <div className="panel max-w-2xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Change the wording on this school&apos;s printed report cards. Marks, ranks and who can see a card are not affected. Blank fields use EduCore&apos;s default wording.
      </p>
      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <Label htmlFor={`rf-${f.key}`}>{f.label}</Label>
          <Input
            id={`rf-${f.key}`}
            value={text[f.key]}
            maxLength={f.max}
            placeholder={f.placeholder}
            disabled={!canWrite}
            onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
          />
          <span className="text-xs text-muted-foreground">{f.hint}</span>
        </div>
      ))}
      {!canWrite && <p className="text-sm text-muted-foreground">You can view this form but only exam administrators can change it.</p>}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {message.text}
        </p>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => save(text)} disabled={pending}>
            {pending ? "Saving…" : "Save report form"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              const blank = toText({ title: null, subtitle: null, footerNote: null, classTeacherLabel: null, headTeacherLabel: null, parentLabel: null });
              setText(blank);
              void save(blank);
            }}
          >
            Reset to default wording
          </Button>
        </div>
      )}
    </div>
  );
}
