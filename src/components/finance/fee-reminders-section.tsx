"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import {
  WEEKDAYS,
  describeSchedule,
  reminderTone,
  type DeliveryStatus,
  type ReminderChannel,
  type ReminderFrequency,
  type ReminderSchedule,
  type ReminderStatus,
} from "@/lib/fee-reminders";
import {
  saveScheduleAction,
  draftNowAction,
  updateReminderDraftAction,
  dismissReminderAction,
  approveReminderAction,
  refreshReminderAction,
} from "@/app/(app)/finance/reminders/actions";

export interface ReminderRow {
  id: string;
  studentName: string;
  guardianName: string;
  guardianPhone: string;
  balance: number;
  draftBody: string;
  status: ReminderStatus;
  channel: ReminderChannel;
  runOn: string;
  sentAt: string | null;
  dismissReason: string | null;
  cancelReason: string | null;
  edited: boolean;
  delivery: DeliveryStatus | null;
}

export interface TemplateOption {
  id: string;
  name: string;
  channel: string | null;
  body: string;
  /** Plain-language reason the template cannot be used, or null when it is fine. */
  problem: string | null;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

function fmt(n: number) {
  return `KES ${n.toLocaleString()}`;
}

export function FeeRemindersSection({
  schedule,
  reminders,
  templates,
  canWrite,
}: {
  schedule: ReminderSchedule;
  reminders: ReminderRow[];
  templates: TemplateOption[];
  canWrite: boolean;
}) {
  const toHref = useSchoolHref();
  const [form, setForm] = useState<ReminderSchedule>(schedule);
  const [minBalanceText, setMinBalanceText] = useState(String(schedule.minBalance));
  const [gapText, setGapText] = useState(String(schedule.minDaysBetween));
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingRows = reminders.filter((r) => r.status === "draft");
  const historyRows = reminders.filter((r) => r.status !== "draft");

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveScheduleAction({
        ...form,
        minBalance: Number(minBalanceText),
        minDaysBetween: Number(gapText),
      });
      if ("error" in result) setError(result.error);
      else setNotice("Schedule saved.");
    } finally {
      setSaving(false);
    }
  }

  async function draftNow() {
    setDrafting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await draftNowAction();
      if ("error" in result) setError(result.error);
      else setNotice(result.created > 0 ? `${result.created} reminder(s) drafted for review.` : "No new drafts: nobody is eligible right now.");
    } finally {
      setDrafting(false);
    }
  }

  function run(id: string, fn: () => Promise<{ error: string } | { success: true }>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      setBusyId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="panel p-4">
        <p className="mb-1 text-sm font-semibold">Schedule</p>
        <p className="mb-3 text-sm text-muted-foreground">
          On the days you choose, EduCore drafts a reminder for each family with a balance. Nothing is sent
          automatically: you review, edit and approve every message here. Guardians who opted out of fee
          reminders on the chosen channel are skipped, and so are families already reminded recently.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="rem_enabled"
              checked={form.enabled}
              disabled={!canWrite}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v === true }))}
            />
            <Label htmlFor="rem_enabled">Schedule on</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem_freq">How often</Label>
            <select
              id="rem_freq"
              className={selectClass}
              disabled={!canWrite}
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as ReminderFrequency }))}
            >
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Every two weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {form.frequency === "monthly" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rem_dom">Day of month (1-28)</Label>
              <Input
                id="rem_dom"
                type="number"
                min={1}
                max={28}
                className="w-24"
                disabled={!canWrite}
                value={form.runDayOfMonth}
                onChange={(e) => setForm((f) => ({ ...f, runDayOfMonth: Number(e.target.value) }))}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rem_wd">Day</Label>
              <select
                id="rem_wd"
                className={selectClass}
                disabled={!canWrite}
                value={form.runWeekday}
                onChange={(e) => setForm((f) => ({ ...f, runWeekday: Number(e.target.value) }))}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rem_channel">Channel</Label>
            <select
              id="rem_channel"
              className={selectClass}
              disabled={!canWrite}
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value as ReminderChannel }))}
            >
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem_min">Minimum balance (KES)</Label>
            <Input
              id="rem_min"
              type="number"
              min={1}
              step={100}
              className="w-36"
              disabled={!canWrite}
              value={minBalanceText}
              onChange={(e) => setMinBalanceText(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem_gap">Days between reminders</Label>
            <Input
              id="rem_gap"
              type="number"
              min={1}
              max={90}
              className="w-28"
              disabled={!canWrite}
              value={gapText}
              onChange={(e) => setGapText(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rem_tpl">Message</Label>
            <select
              id="rem_tpl"
              className={selectClass}
              disabled={!canWrite}
              value={form.templateId ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value || null }))}
            >
              <option value="">EduCore default message</option>
              {templates.map((t) => {
                const wrongChannel = t.channel !== null && t.channel !== form.channel;
                return (
                  <option key={t.id} value={t.id} disabled={Boolean(t.problem) || wrongChannel}>
                    {t.name}
                    {t.problem ? " (needs fixing)" : wrongChannel ? ` (${t.channel} only)` : ""}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{describeSchedule({ ...form, minBalance: Number(minBalanceText) || 0, minDaysBetween: Number(gapText) || 0 })}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Write your own message in{" "}
          <a href={toHref("/communication")} className="underline">
            Communication &gt; Templates
          </a>{" "}
          (category &quot;Fee reminder&quot;). You can use {"{{guardian_name}}"}, {"{{student_name}}"}, {"{{school_name}}"} and {"{{balance}}"}; the balance is
          always filled in from the live fee records at the time of sending.
        </p>
        {templates.some((t) => t.problem) && (
          <p className="mt-1 text-xs text-destructive">
            {templates.filter((t) => t.problem).map((t) => `${t.name}: ${t.problem}`).join(" ")}
          </p>
        )}
        {form.channel === "whatsapp" && (
          <p className="mt-1 text-xs text-muted-foreground">
            WhatsApp messages the school starts need a template approved by WhatsApp; if yours is not approved yet,
            delivery may fail. SMS always works.
          </p>
        )}
        {canWrite && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save schedule"}
            </Button>
            <Button size="sm" variant="secondary" onClick={draftNow} disabled={drafting}>
              {drafting ? "Drafting…" : "Draft now"}
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Pending review ({pendingRows.length})</p>
          {pendingRows.length > 0 && (
            <a href={toHref("/finance/reminders/slips")} target="_blank" rel="noreferrer" className="text-sm underline">
              Print slips for pending drafts
            </a>
          )}
        </div>
        {pendingRows.length === 0 && (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">Nothing pending review right now.</div>
        )}
        <div className="flex flex-col gap-3">
          {pendingRows.map((r) => (
            <div key={r.id} className="panel p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{r.studentName}</p>
                  <p className="text-xs text-muted-foreground">
                    Guardian: {r.guardianName} ({r.guardianPhone}), balance {fmt(r.balance)}, via {r.channel === "sms" ? "SMS" : "WhatsApp"}
                  </p>
                </div>
                <StatusBadge tone={reminderTone(r.status)} label={r.status} />
              </div>
              <Textarea
                value={drafts[r.id] ?? r.draftBody}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                disabled={!canWrite || busyId === r.id}
                rows={4}
                className="mb-3"
              />
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === r.id}
                    onClick={() => run(r.id, () => updateReminderDraftAction(r.id, drafts[r.id] ?? r.draftBody))}
                  >
                    Save edits
                  </Button>
                  {r.edited && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending && busyId === r.id}
                      onClick={() => {
                        setDrafts((d) => {
                          const next = { ...d };
                          delete next[r.id];
                          return next;
                        });
                        run(r.id, () => refreshReminderAction(r.id));
                      }}
                    >
                      Refresh from template
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={pending && busyId === r.id}
                    onClick={() =>
                      run(r.id, async () => {
                        // Save any unsaved edit first so what is sent is exactly what is on screen.
                        if (drafts[r.id] !== undefined && drafts[r.id] !== r.draftBody) {
                          const saved = await updateReminderDraftAction(r.id, drafts[r.id]);
                          if ("error" in saved) return saved;
                        }
                        return approveReminderAction(r.id);
                      })
                    }
                  >
                    Approve &amp; send
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending && busyId === r.id}
                    onClick={() => run(r.id, () => dismissReminderAction(r.id, ""))}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {historyRows.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">History ({historyRows.length})</p>
          <div className="flex flex-col gap-2">
            {historyRows.map((r) => (
              <div key={r.id} className="panel flex items-center justify-between gap-2 p-3 text-sm">
                <span>
                  {r.studentName}: {fmt(r.balance)}
                  {r.dismissReason ? ` (${r.dismissReason})` : ""}
                  {r.cancelReason ? ` (${r.cancelReason})` : ""}
                  {r.delivery === "failed" ? " Delivery failed: eligible to be drafted again at the next run." : ""}
                </span>
                <StatusBadge
                  tone={r.delivery === "failed" ? "warning" : reminderTone(r.status)}
                  label={r.delivery === "failed" ? "delivery failed" : r.status}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
