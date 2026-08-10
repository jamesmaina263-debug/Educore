"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { dispatchPending } from "@/app/communication/actions";

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
}

const CHANNEL_LABELS: Record<LogRow["channel"], string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp", in_app: "In-app" };

export function HistorySection({ logs }: { logs: LogRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasQueued = logs.some((l) => l.status === "queued");

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
          <h2 className="text-[0.8125rem] font-semibold">Delivery history</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {logs.length} message{logs.length === 1 ? "" : "s"}
          </span>
        </header>
        {logs.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No messages sent yet.</p>
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
                  <th>Read</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
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
                    <td className="text-muted-foreground">
                      {l.channel === "in_app" ? (l.read_at ? <StatusBadge tone="success" label="Read" /> : <StatusBadge tone="neutral" label="Unread" />) : "—"}
                    </td>
                    <td className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
