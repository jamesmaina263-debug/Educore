"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { composeAndSendAction, type Recipient } from "@/app/communication/actions";

export interface TemplateOption {
  id: string;
  name: string;
  body: string;
  channel: "sms" | "email" | "whatsapp" | "in_app";
}

export interface RosterEntry {
  student_id: string;
  student_name: string;
  class_id: string;
  class_name: string;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_school_user_id: string | null;
}

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "in_app", label: "In-app" },
] as const;

export function ComposeSection({
  roster,
  classes,
  templates,
  schoolName,
}: {
  roster: RosterEntry[];
  classes: { id: string; name: string }[];
  templates: TemplateOption[];
  schoolName: string;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["value"]>("sms");
  const [subject, setSubject] = useState("");
  const [scope, setScope] = useState<"all" | "class" | "student">("all");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [studentId, setStudentId] = useState(roster[0]?.student_id ?? "");
  const [templateId, setTemplateId] = useState<string>("__none__");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  const contactField = channel === "email" ? "guardian_email" : channel === "in_app" ? "guardian_school_user_id" : "guardian_phone";
  const withContact = roster.filter((r) => r[contactField]);
  const scoped =
    scope === "all" ? withContact : scope === "class" ? withContact.filter((r) => r.class_id === classId) : withContact.filter((r) => r.student_id === studentId);

  const previewBody = templateId !== "__none__" ? templates.find((t) => t.id === templateId)?.body ?? "" : body;
  const previewRendered = previewBody
    .replace("{{student_name}}", scoped[0]?.student_name ?? "{{student_name}}")
    .replace("{{school_name}}", schoolName)
    .replace("{{balance}}", "{{balance}}");
  const segments = Math.max(1, Math.ceil(previewRendered.length / 160));

  const skippedNoContact = useMemo(() => {
    const all = scope === "all" ? roster : scope === "class" ? roster.filter((r) => r.class_id === classId) : roster.filter((r) => r.student_id === studentId);
    return all.length - scoped.length;
  }, [scope, classId, studentId, roster, scoped.length]);

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    if (id !== "__none__") {
      const t = templates.find((tpl) => tpl.id === id);
      if (t) setChannel(t.channel);
    }
  }

  async function handleSend() {
    setPending(true);
    setError(null);
    setResult(null);
    const recipients: Recipient[] = scoped.map((r) => ({
      ...(channel === "email" ? { email: r.guardian_email as string } : channel !== "in_app" ? { phone: r.guardian_phone as string } : {}),
      student_id: r.student_id,
      recipient_type: "guardian",
      school_user_id: r.guardian_school_user_id ?? undefined,
      values: { student_name: r.student_name, school_name: schoolName },
    }));
    const res = await composeAndSendAction({
      recipients,
      template_id: templateId !== "__none__" ? templateId : undefined,
      body: templateId === "__none__" ? body : undefined,
      channel,
      subject: channel === "email" ? subject : undefined,
    });
    setPending(false);
    if ("error" in res) return setError(res.error);
    setResult({ sent: res.sent, failed: res.failed, total: res.total });
    setBody("");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <p className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          Sent {result.sent} of {result.total}{result.failed > 0 && ` — ${result.failed} failed, check History`}
        </p>
      )}

      <div className="panel max-w-3xl">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Compose message</h2>
        </header>
        <div className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Recipients</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All guardians</SelectItem>
                  <SelectItem value="class">A specific class</SelectItem>
                  <SelectItem value="student">A single student</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "class" && (
              <div className="space-y-1.5">
                <Label>Class</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {scope === "student" && (
              <div className="space-y-1.5">
                <Label>Student</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roster.map((r) => (
                      <SelectItem key={r.student_id} value={r.student_id}>
                        {r.student_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select value={templateId} onValueChange={handleTemplateChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Write my own</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {channel === "email" && (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Fee reminder" />
            </div>
          )}

          {templateId === "__none__" ? (
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Use {{student_name}} to personalize per recipient." />
            </div>
          ) : (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="mb-1 text-[0.6875rem] text-muted-foreground">Preview (first recipient)</p>
              <p className="text-sm">{previewRendered}</p>
            </div>
          )}

          <div className="flex items-center justify-between text-[0.75rem] text-muted-foreground">
            <span>
              {scoped.length} recipient{scoped.length !== 1 && "s"}
              {skippedNoContact > 0 && ` (${skippedNoContact} skipped — no ${channel === "email" ? "email" : channel === "in_app" ? "linked account" : "phone"} on file)`}
            </span>
            {channel === "sms" && (
              <span>{previewRendered.length} chars — {segments} segment{segments !== 1 && "s"}</span>
            )}
          </div>

          <Button
            onClick={handleSend}
            disabled={pending || scoped.length === 0 || (templateId === "__none__" && !body.trim()) || (channel === "email" && !subject.trim())}
            className="self-start"
          >
            {pending ? "Sending…" : `Send to ${scoped.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
