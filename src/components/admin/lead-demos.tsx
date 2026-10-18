"use client";

import { useState, useTransition } from "react";
import {
  bookSalesLeadDemo,
  closeSalesLeadDemo,
  rescheduleSalesLeadDemo,
} from "@/app/(admin)/admin/sales-pipeline/demo-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatInstantNairobi } from "@/lib/sales/pipeline";
import {
  DEMO_MODES,
  MODE_LABELS,
  STATUS_LABELS,
  demoHistory,
  isDemoMode,
  isoToEatLocal,
  needsOutcome,
  type DemoMode,
  type DemoRow,
  type DemoStatus,
} from "@/lib/sales/demos";

// Manual demo booking for one lead. Records what a person arranged: nothing is sent to the school and no
// calendar is touched. Times are entered and shown in East Africa Time.

const NOT_STATED = "none";
const NEED_WORKING_AS = "Pick who you are working as (top of the pipeline) before recording a demo.";

function statusLabel(s: string): string {
  return STATUS_LABELS[s as DemoStatus] ?? s;
}

export function LeadDemos({
  leadId,
  leadClosed,
  demos,
  repNameById,
  workingAs,
  onChanged,
}: {
  leadId: string;
  /** Paid or lost: the database refuses new bookings, so the form is not offered. */
  leadClosed: boolean;
  demos: DemoRow[];
  repNameById: Map<string, string>;
  workingAs: string;
  onChanged: () => void;
}) {
  const history = demoHistory(demos);
  const scheduled = history.find((d) => d.status === "scheduled") ?? null;
  const reps = Array.from(repNameById, ([id, name]) => ({ id, name }));

  const [booking, setBooking] = useState(false);
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<DemoMode>("in_person");
  const [where, setWhere] = useState("");
  const [host, setHost] = useState(NOT_STATED);
  const [resched, setResched] = useState(false);
  const [newWhen, setNewWhen] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error: string } | { success: true }>, after: () => void) {
    setError(null);
    if (!workingAs) {
      setError(NEED_WORKING_AS);
      return;
    }
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      after();
      onChanged();
    });
  }

  function submitBooking() {
    run(
      () => bookSalesLeadDemo(leadId, { scheduledLocal: when, mode, locationNote: where }, host === NOT_STATED ? null : host, workingAs),
      () => {
        setBooking(false);
        setWhen("");
        setWhere("");
        setHost(NOT_STATED);
      },
    );
  }

  function close(d: DemoRow, status: "held" | "no_show" | "cancelled") {
    run(() => closeSalesLeadDemo(d.id, status, note, workingAs), () => setNote(""));
  }

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="mb-2 text-[0.8125rem] font-semibold">Demos</p>
      <p className="mb-2 text-xs text-muted-foreground">
        A record of demos your team arranged. Nothing is sent to the school and no calendar is touched. Times are East
        Africa Time.
      </p>

      {scheduled && (
        <div className="mb-3 flex flex-col gap-2 rounded border border-border p-2">
          <div>
            <span className="font-medium">{formatInstantNairobi(scheduled.scheduled_for, true)}</span>{" "}
            <span className="text-xs text-muted-foreground">
              · {MODE_LABELS[scheduled.mode as DemoMode] ?? scheduled.mode}
              {scheduled.host_id && repNameById.get(scheduled.host_id) ? ` · ${repNameById.get(scheduled.host_id)}` : ""}
            </span>
            {scheduled.location_note && <div className="text-xs">{scheduled.location_note}</div>}
            {needsOutcome(scheduled) && (
              <div className="text-xs font-medium text-destructive">The time has passed: record what happened.</div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Outcome note (optional)</Label>
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Short. No learner details." />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || !needsOutcome(scheduled)} onClick={() => close(scheduled, "held")}>
              Held
            </Button>
            <Button size="sm" variant="outline" disabled={pending || !needsOutcome(scheduled)} onClick={() => close(scheduled, "no_show")}>
              No-show
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => close(scheduled, "cancelled")}>
              Cancel demo
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setResched((v) => !v)}>
              Reschedule
            </Button>
          </div>
          {!needsOutcome(scheduled) && (
            <p className="text-xs text-muted-foreground">Held and No-show unlock once the start time has passed.</p>
          )}
          {resched && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">New date and time (EAT)</Label>
                <Input type="datetime-local" value={newWhen || isoToEatLocal(scheduled.scheduled_for)} onChange={(e) => setNewWhen(e.target.value)} />
              </div>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(
                    () => rescheduleSalesLeadDemo(scheduled.id, newWhen || isoToEatLocal(scheduled.scheduled_for), workingAs),
                    () => {
                      setResched(false);
                      setNewWhen("");
                    },
                  )
                }
              >
                Save new time
              </Button>
            </div>
          )}
        </div>
      )}

      {!scheduled && !leadClosed && !booking && (
        <Button size="sm" onClick={() => setBooking(true)}>
          Book a demo
        </Button>
      )}
      {!scheduled && leadClosed && <p className="text-xs text-muted-foreground">This lead is closed, so no demo can be booked.</p>}

      {!scheduled && booking && (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Date and time (EAT)</Label>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">How</Label>
              <Select value={mode} onValueChange={(v) => isDemoMode(v) && setMode(v)}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="How the demo happens">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEMO_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Place or meeting link (optional)</Label>
              <Input value={where} maxLength={300} onChange={(e) => setWhere(e.target.value)} placeholder="No passcodes here" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Who runs it</Label>
              <Select value={host} onValueChange={setHost}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Who runs the demo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_STATED}>Not stated</SelectItem>
                  {reps.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={submitBooking}>
              {pending ? "Saving…" : "Save demo"}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setBooking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {history.some((d) => d.status !== "scheduled") && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-2 text-xs">
          {history
            .filter((d) => d.status !== "scheduled")
            .map((d) => (
              <li key={d.id}>
                <span className="font-medium">{statusLabel(d.status)}</span> · {formatInstantNairobi(d.scheduled_for, true)} ·{" "}
                {MODE_LABELS[d.mode as DemoMode] ?? d.mode}
                {d.outcome_note ? ` · ${d.outcome_note}` : ""}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
