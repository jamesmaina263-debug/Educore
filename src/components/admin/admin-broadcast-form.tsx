"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { sendBroadcastAnnouncement, type BroadcastHistoryRow } from "@/app/(admin)/admin/broadcast/actions";

function timeAgo(iso: string): string {
  const hours = Math.floor((new Date().getTime() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AdminBroadcastForm({ history }: { history: BroadcastHistoryRow[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);

  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  function handleSend() {
    setError(null);
    startTransition(async () => {
      const res = await sendBroadcastAnnouncement(subject.trim(), body.trim());
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setConfirmOpen(false);
      setSubject("");
      setBody("");
      setLastSent(res.recipientCount);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {lastSent !== null && (
          <p className="text-sm text-success">Sent to {lastSent} staff account{lastSent === 1 ? "" : "s"}.</p>
        )}
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Subject</p>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Planned maintenance, Sat 14 Sep" />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Message</p>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="EduCore will be briefly unavailable between 1am and 2am EAT for scheduled maintenance."
            rows={4}
          />
        </div>
        <div>
          <Button disabled={!canSend || pending} onClick={() => setConfirmOpen(true)}>
            Send to all schools
          </Button>
        </div>
      </div>

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Past broadcasts</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Subject</th>
                <th>Message</th>
                <th>Recipients</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-sm text-muted-foreground">
                    No broadcasts sent yet.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.sent_at + h.subject}>
                    <td className="font-medium">{h.subject}</td>
                    <td className="max-w-96 truncate text-muted-foreground" title={h.body}>
                      {h.body}
                    </td>
                    <td className="text-muted-foreground">{h.recipient_count}</td>
                    <td className="text-muted-foreground">{timeAgo(h.sent_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this to every school?</DialogTitle>
            <DialogDescription>
              This reaches every active staff account at every school right now, as an in-app notification. It can&apos;t
              be recalled once sent.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{subject}</p>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{body}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={pending}>
              {pending ? "Sending…" : "Send now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
