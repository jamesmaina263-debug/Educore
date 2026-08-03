"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { dispatchPending } from "@/app/communication/actions";

export interface LogRow {
  id: string;
  channel: "sms" | "email" | "whatsapp";
  recipient_phone: string | null;
  recipient_email: string | null;
  subject: string | null;
  student_name: string | null;
  body: string;
  status: "queued" | "sent" | "failed" | "delivered";
  provider_response: string | null;
  created_at: string;
}

const CHANNEL_LABELS: Record<LogRow["channel"], string> = { sms: "SMS", email: "Email", whatsapp: "WhatsApp" };

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

      {logs.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No messages sent yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Badge variant="outline">{CHANNEL_LABELS[l.channel]}</Badge>
                </TableCell>
                <TableCell>{l.channel === "email" ? l.recipient_email : l.recipient_phone}</TableCell>
                <TableCell>{l.student_name ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate" title={l.subject ? `${l.subject}\n\n${l.body}` : l.body}>
                  {l.subject ? `${l.subject}: ` : ""}
                  {l.body}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={l.status === "sent" || l.status === "delivered" ? "success" : l.status === "failed" ? "danger" : "secondary"}
                    title={l.provider_response ?? undefined}
                  >
                    {l.status}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(l.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
