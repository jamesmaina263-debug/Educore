"use client";

import { useState } from "react";
import Link from "next/link";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { saveTrainingAction, cancelTrainingAction } from "@/app/(app)/staff/training/actions";
import {
  CATEGORY_LABELS,
  KIND_LABELS,
  TRAINING_CATEGORIES,
  WINDOW_OPTIONS,
  dueLabel,
  formatDate,
  overviewCounts,
  sortRecords,
  urgency,
  type OverviewRow,
  type TrainingCategory,
  type TrainingInput,
  type TrainingRecord,
} from "@/lib/staff/training";

export interface StaffOption {
  id: string;
  name: string;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

const EMPTY = (): TrainingInput => ({
  id: null,
  staffId: "",
  title: "",
  provider: "",
  category: "cpd",
  status: "completed",
  startDate: "",
  endDate: "",
  hours: "",
  expiresOn: "",
  notes: "",
});

export function StaffTrainingSection({
  overview,
  records,
  staff,
  canManage,
  windowDays,
}: {
  overview: OverviewRow[];
  records: TrainingRecord[];
  staff: StaffOption[];
  canManage: boolean;
  windowDays: number;
}) {
  const toHref = useSchoolHref();
  const [form, setForm] = useState<TrainingInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const counts = overviewCounts(overview);
  const sorted = sortRecords(records);

  async function run(fn: () => Promise<{ error: string } | { success: true }>, ok: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if ("error" in result) setError(result.error);
      else {
        setNotice(ok);
        after?.();
      }
    } finally {
      setBusy(false);
    }
  }

  function edit(r: TrainingRecord) {
    setForm({
      id: r.id,
      staffId: r.staffId,
      title: r.title,
      provider: r.provider ?? "",
      category: r.category,
      status: r.status === "planned" ? "planned" : "completed",
      startDate: r.startDate,
      endDate: r.endDate ?? "",
      hours: r.hours === null ? "" : String(r.hours),
      expiresOn: r.expiresOn ?? "",
      notes: r.notes ?? "",
    });
    setError(null);
    setNotice(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border p-2 text-sm text-muted-foreground">{notice}</p>}

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Expiring soon</p>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Next</span>
            {WINDOW_OPTIONS.map((d) => (
              <Link
                key={d}
                href={toHref(`/staff/training?days=${d}`)}
                className={`rounded-md border px-2 py-1 ${d === windowDays ? "bg-muted font-medium" : "text-muted-foreground"}`}
              >
                {d} days
              </Link>
            ))}
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {counts.overdue} overdue, {counts.soon} due within 14 days, {counts.later} later in the window. Contracts come from the staff employment details;
          qualifications from the staff qualifications tab. Renew those on the staff member&apos;s own page.
        </p>
        {overview.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing expiring in the next {windowDays} days.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {overview.map((r) => {
              const u = urgency(r.daysLeft);
              return (
                <li key={`${r.kind}-${r.staffId}-${r.label}-${r.dueDate}`} className="flex flex-wrap items-center gap-2 py-2">
                  <StatusBadge tone={u === "overdue" ? "danger" : u === "soon" ? "warning" : "neutral"} label={dueLabel(r.daysLeft)} />
                  <Link href={toHref(`/staff/${r.staffId}`)} className="text-sm font-medium underline-offset-2 hover:underline">
                    {r.staffName}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {KIND_LABELS[r.kind]}: {r.label}, {formatDate(r.dueDate)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">{form ? (form.id ? "Edit training record" : "New training record") : "Training records"}</p>
            {!form && (
              <Button size="sm" onClick={() => { setForm(EMPTY()); setError(null); setNotice(null); }}>
                Add training
              </Button>
            )}
          </div>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-staff">Staff member</Label>
                <select id="tr-staff" className={selectClass} value={form.staffId} disabled={form.id !== null} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
                  <option value="">Choose a staff member</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-title">Title</Label>
                <Input id="tr-title" value={form.title} maxLength={150} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-cat">Category</Label>
                <select id="tr-cat" className={selectClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TrainingCategory })}>
                  {TRAINING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-status">Status</Label>
                <select id="tr-status" className={selectClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "planned" | "completed" })}>
                  <option value="completed">Completed</option>
                  <option value="planned">Planned</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-prov">Provider (optional)</Label>
                <Input id="tr-prov" value={form.provider} maxLength={150} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-hours">Hours (optional)</Label>
                <Input id="tr-hours" inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-start">Starts</Label>
                <Input id="tr-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-end">Ends (optional)</Label>
                <Input id="tr-end" type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="tr-exp">Certificate expires (optional)</Label>
                <Input id="tr-exp" type="date" value={form.expiresOn} min={form.startDate} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="tr-notes">Notes (optional)</Label>
                <Textarea id="tr-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button disabled={busy} onClick={() => run(() => saveTrainingAction(form), "Training record saved.", () => setForm(null))}>
                  {busy ? "Saving..." : "Save record"}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setForm(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel p-4">
        {!canManage && <p className="mb-3 text-sm font-semibold">Training records</p>}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No training records yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {sorted.map((r) => {
              const cancelled = r.status === "cancelled";
              return (
                <li key={r.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${cancelled ? "text-muted-foreground line-through" : ""}`}>{r.title}</span>
                    <StatusBadge
                      tone={cancelled ? "danger" : r.status === "completed" ? "success" : "info"}
                      label={cancelled ? "Cancelled" : r.status === "completed" ? "Completed" : "Planned"}
                    />
                    <StatusBadge tone="neutral" label={CATEGORY_LABELS[r.category]} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.staffName}, {formatDate(r.startDate)}
                    {r.endDate ? ` to ${formatDate(r.endDate)}` : ""}
                    {r.provider ? `, ${r.provider}` : ""}
                    {r.hours !== null ? `, ${r.hours} h` : ""}
                    {r.expiresOn ? `, expires ${formatDate(r.expiresOn)}` : ""}
                  </p>
                  {r.notes && !cancelled && <p className="text-sm">{r.notes}</p>}
                  {canManage && !cancelled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => edit(r)}>
                        Edit
                      </Button>
                      {confirmId === r.id ? (
                        <>
                          <Button variant="destructive" size="sm" disabled={busy} onClick={() => run(() => cancelTrainingAction(r.id), "Training record cancelled.", () => setConfirmId(null))}>
                            Confirm cancel
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setConfirmId(null)}>
                            Keep record
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmId(r.id)}>
                          Cancel record
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
