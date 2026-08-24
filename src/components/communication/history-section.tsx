"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { dispatchPending, deleteCommunicationPermanentlyAction } from "@/app/(app)/communication/actions";

export interface LogRow {
  id: string;
  channel: "sms" | "email" | "whatsapp" | "in_app";
  recipient_phone: string | null;
  recipient_email: string | null;
  subject: string | null;
  student_name: string | null;
  body: string;
  status: "queued" | "sent" | "failed" | "delivered";
  provider_response: string | null;
  read_at: string | null;
  created_at: string;
  // Null until the daily retention sweep (7 days after created_at) archives this row; see
  // 20260824153119_communication_retention_archive_purge.sql. Optional so any existing caller
  // that doesn't pass it (there shouldn't be any left, but this keeps the type change non-breaking)
  // still type-checks.
  archived_at?: string | null;
}

const CHANNEL_LABELS: Record<LogRow["channel"], string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp", in_app: "In-app" };

export function HistorySection({ logs, canDelete = false }: { logs: LogRow[]; canDelete?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [confirmTarget, setConfirmTarget] = useState<LogRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const activeLogs = logs.filter((l) => !l.archived_at);
  const archivedLogs = logs.filter((l) => l.archived_at);
  const visibleLogs = tab === "active" ? activeLogs : archivedLogs;

  const hasQueued = activeLogs.some((l) => l.status === "queued");

  async function handleDelete() {
    if (!confirmTarget) return;
    setDeleting(true);
    setError(null);
    const result = await deleteCommunicationPermanentlyAction({ table: "notification_logs", id: confirmTarget.id });
    setDeleting(false);
    if ("error" in result) return setError(result.error);
    setConfirmTarget(null);
    router.refresh();
  }

  // "not configured" is the exact substring assertDevFallbackAllowed() throws with
  // (see supabase/functions/_shared/devFallbackGuard.ts) — surfaced separately from
  // ordinary delivery failures (bad number, provider rejected, etc.) because this one
  // means the channel needs setup, not that any individual message was at fault.
  const configFailuresByChannel = logs
    .filter((l) => l.status === "failed" && l.provider_response?.includes("not configured"))
    .reduce<Record<string, number>>((acc, l) => {
      acc[l.channel] = (acc[l.channel] ?? 0) + 1;
      return acc;
    }, {});
  const unconfiguredChannels = Object.entries(configFailuresByChannel);

  async function handleDispatch() {
    setPending(true);
    setError(null);
    const result = await dispatchPending();
    setPending(false);
    if ("error" in result) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      {unconfiguredChannels.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm font-medium text-danger">
            {unconfiguredChannels.length === 1 ? "A channel isn't" : "Some channels aren't"} set up yet
          </p>
          <p className="mt-0.5 text-sm text-danger/90">
            {unconfiguredChannels
              .map(([channel, count]) => `${CHANNEL_LABELS[channel as LogRow["channel"]]} (${count} message${count === 1 ? "" : "s"})`)
              .join(", ")}{" "}
            {unconfiguredChannels.length === 1 ? "has" : "have"} not actually been delivered — the provider credentials for{" "}
            {unconfiguredChannels.length === 1 ? "it haven't" : "these haven't"} been configured yet. Contact your administrator.
          </p>
        </div>
      )}

      {hasQueued && (
        <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/10 p-3">
          <p className="text-sm text-warning">
            Some messages are still queued — including any automatic absence alerts since the last visit.
          </p>
          <Button size="sm" disabled={pending} onClick={handleDispatch}>
            {pending ? "Sending…" : "Send pending"}
          </Button>
        </div>
      )}

      <div className="panel">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-1">
            <h2 className="text-[0.8125rem] font-semibold">Delivery history</h2>
            <div className="ml-3 flex gap-1">
              <Button variant={tab === "active" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("active")}>
                Active ({activeLogs.length})
              </Button>
              <Button variant={tab === "archived" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("archived")}>
                Archived ({archivedLogs.length})
              </Button>
            </div>
          </div>
          <span className="text-[0.6875rem] text-muted-foreground">
            {visibleLogs.length} message{visibleLogs.length === 1 ? "" : "s"}
          </span>
        </header>
        {tab === "archived" && (
          <p className="border-b border-border bg-muted/40 px-4 py-1.5 text-[0.6875rem] text-muted-foreground">
            Archived messages are auto-deleted permanently 7 days after archiving, 14 days after they were sent.
          </p>
        )}
        {visibleLogs.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {tab === "active" ? "No messages sent yet." : "Nothing archived yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Student</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Read</th>
                  <th>Sent</th>
                  {canDelete && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <StatusBadge tone="neutral" label={CHANNEL_LABELS[l.channel]} />
                    </td>
                    <td className="text-muted-foreground">
                      {l.channel === "email" ? l.recipient_email : l.channel === "in_app" ? "—" : l.recipient_phone}
                    </td>
                    <td>{l.student_name ?? "—"}</td>
                    <td className="max-w-xs truncate" title={l.subject ? `${l.subject}\n\n${l.body}` : l.body}>
                      {l.subject ? `${l.subject}: ` : ""}
                      {l.body}
                    </td>
                    <td>
                      <StatusBadge
                        tone={l.status === "sent" || l.status === "delivered" ? "success" : l.status === "failed" ? "danger" : "neutral"}
                        label={l.status}
                        title={l.provider_response ?? undefined}
                      />
                    </td>
                    <td className="max-w-[16rem] truncate text-muted-foreground" title={l.provider_response ?? undefined}>
                      {l.status === "failed" ? (l.provider_response ?? "Unknown error") : "—"}
                    </td>
                    <td className="text-muted-foreground">
                      {l.channel === "in_app" ? (l.read_at ? <StatusBadge tone="success" label="Read" /> : <StatusBadge tone="neutral" label="Unread" />) : "—"}
                    </td>
                    <td className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                    {canDelete && (
                      <td>
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirmTarget(l)}>
                          Delete
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this message permanently?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This immediately and permanently deletes this record from the delivery history. This cannot be undone, and it skips the
            normal 7/14-day archive schedule.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
