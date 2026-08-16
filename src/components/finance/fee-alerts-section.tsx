"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  checkFeeThresholdsAction,
  updateDraftBodyAction,
  dismissAlertAction,
  polishDraftWithAIAction,
  approveAndSendAction,
} from "@/app/(app)/finance/fee-alerts/actions";

export interface FeeAlertRow {
  id: string;
  studentName: string;
  guardianName: string;
  guardianContact: string;
  balance: number;
  threshold: number;
  draftBody: string;
  aiDrafted: boolean;
  status: "draft" | "approved" | "sent" | "dismissed";
  generatedAt: string;
  sentAt: string | null;
}

function statusTone(status: FeeAlertRow["status"]) {
  if (status === "sent") return "success" as const;
  if (status === "dismissed") return "neutral" as const;
  return "warning" as const;
}

function fmt(n: number) {
  return `KES ${n.toLocaleString()}`;
}

export function FeeAlertsSection({
  alerts,
  threshold,
  canWrite,
}: {
  alerts: FeeAlertRow[];
  threshold: number | null;
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function draftValue(a: FeeAlertRow) {
    return drafts[a.id] ?? a.draftBody;
  }

  async function runCheck() {
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await checkFeeThresholdsAction();
      if ("error" in result) { setError(result.error); return; }
      setNotice(result.created > 0 ? `${result.created} new alert(s) drafted.` : "No new alerts — everyone under threshold already has a draft, or no one has crossed it.");
    } finally {
      setChecking(false);
    }
  }

  function runOnAlert(id: string, fn: () => Promise<{ error: string } | { success: true }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) setError(result.error);
      setBusyId(null);
    });
  }

  if (threshold == null) {
    return (
      <div className="panel border-dashed p-6 text-sm text-muted-foreground">
        No fee alert threshold is set for this school yet. Configure one under{" "}
        <a href="/finance/configuration" className="underline">Finance &rarr; Configuration</a> to start drafting
        arrears reminders.
      </div>
    );
  }

  const pendingAlerts = alerts.filter((a) => a.status === "draft" || a.status === "approved");
  const historyAlerts = alerts.filter((a) => a.status === "sent" || a.status === "dismissed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 panel p-4">
        <p className="text-sm text-muted-foreground">
          Threshold: <span className="font-medium text-foreground">{fmt(threshold)}</span>. Drafts here are never
          sent automatically — review, optionally polish with AI, then approve &amp; send.
        </p>
        {canWrite && (
          <Button size="sm" onClick={runCheck} disabled={checking}>
            {checking ? "Checking…" : "Check now"}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <div>
        <p className="mb-2 text-sm font-semibold">Pending review ({pendingAlerts.length})</p>
        {pendingAlerts.length === 0 && (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing pending review right now.
          </div>
        )}
        <div className="flex flex-col gap-3">
          {pendingAlerts.map((a) => (
            <div key={a.id} className="panel p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{a.studentName}</p>
                  <p className="text-xs text-muted-foreground">
                    Guardian: {a.guardianName} ({a.guardianContact}) — Balance {fmt(a.balance)} (threshold at the time: {fmt(a.threshold)})
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {a.aiDrafted && <StatusBadge tone="info" label="AI-polished" />}
                  <StatusBadge tone={statusTone(a.status)} label={a.status} />
                </div>
              </div>
              <Textarea
                value={draftValue(a)}
                onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                disabled={!canWrite || busyId === a.id}
                rows={4}
                className="mb-3"
              />
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === a.id}
                    onClick={() => runOnAlert(a.id, () => updateDraftBodyAction(a.id, draftValue(a)))}
                  >
                    Save edits
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === a.id}
                    onClick={() => runOnAlert(a.id, () => polishDraftWithAIAction(a.id))}
                  >
                    {pending && busyId === a.id ? "Polishing…" : "Polish with AI"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending && busyId === a.id}
                    onClick={() => runOnAlert(a.id, () => approveAndSendAction(a.id))}
                  >
                    Approve & send
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending && busyId === a.id}
                    onClick={() => runOnAlert(a.id, () => dismissAlertAction(a.id, ""))}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {historyAlerts.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">History ({historyAlerts.length})</p>
          <div className="flex flex-col gap-2">
            {historyAlerts.map((a) => (
              <div key={a.id} className="panel p-3 text-sm flex items-center justify-between gap-2">
                <span>{a.studentName} — {fmt(a.balance)}</span>
                <StatusBadge tone={statusTone(a.status)} label={a.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
