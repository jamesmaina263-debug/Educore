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
import {
  createOwnerCampaign,
  sendCampaignBatch,
  sendCampaignTestEmail,
  type AudienceRow,
  type CampaignHistoryRow,
} from "@/app/(admin)/admin/email-campaigns/actions";

type Progress = { campaignId: string; sent: number; failed: number; remaining: number };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminEmailCampaignForm({
  audience,
  history,
}: {
  audience: AudienceRow[];
  history: CampaignHistoryRow[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const eligible = audience.filter((a) => !a.suppressed && !excluded.has(a.email));
  const suppressedCount = audience.filter((a) => a.suppressed).length;
  const canSend = subject.trim().length > 0 && body.trim().length > 0 && eligible.length > 0;

  function toggle(email: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  // Sends batches until nothing is queued. A batch error stops the loop but keeps the campaign
  // id, so the same campaign can be resumed (recipients already sent are never re-sent).
  async function runBatches(campaignId: string, startingTotals = { sent: 0, failed: 0 }) {
    let sent = startingTotals.sent;
    let failed = startingTotals.failed;
    for (let i = 0; i < 100; i++) {
      const res = await sendCampaignBatch(campaignId);
      if ("error" in res) {
        setError(res.error);
        setProgress({ campaignId, sent, failed, remaining: -1 });
        return;
      }
      sent += res.sent;
      failed += res.failed;
      setProgress({ campaignId, sent, failed, remaining: res.remaining });
      if (res.remaining === 0) {
        setNotice(`Campaign finished: ${sent} sent, ${failed} failed.`);
        setProgress(null);
        router.refresh();
        return;
      }
    }
  }

  function handleTest() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendCampaignTestEmail(subject, body);
      if ("error" in res) setError(res.error);
      else setNotice(`Test email sent to ${res.sentTo}.`);
    });
  }

  function handleSend() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const created = await createOwnerCampaign(subject, body, Array.from(excluded));
      if ("error" in created) {
        setError(created.error);
        setConfirmOpen(false);
        return;
      }
      setConfirmOpen(false);
      setSubject("");
      setBody("");
      setExcluded(new Set());
      await runBatches(created.campaignId);
    });
  }

  function handleResume(campaignId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      await runBatches(campaignId);
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
        {notice && <p className="text-sm text-success">{notice}</p>}
        {progress && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Sending… {progress.sent} sent, {progress.failed} failed
              {progress.remaining >= 0 ? `, ${progress.remaining} left` : ""}
            </span>
            {progress.remaining < 0 && (
              <Button size="sm" disabled={pending} onClick={() => handleResume(progress.campaignId)}>
                Resume
              </Button>
            )}
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Subject</p>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="New in EduCore: ..." />
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Message (plain text; blank line = new paragraph). Use {"{{name}}"} for the owner&apos;s first name and{" "}
            {"{{school}}"} for the school.
          </p>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
            rows={8}
            placeholder={"Hello {{name}},\n\nWe've just released ..."}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || !subject.trim() || !body.trim()} onClick={handleTest}>
            Send test to me
          </Button>
          <Button disabled={!canSend || pending} onClick={() => setConfirmOpen(true)}>
            Send to {eligible.length} owner{eligible.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">
            Recipients ({eligible.length} of {audience.length})
            {suppressedCount > 0 ? ` · ${suppressedCount} unsubscribed` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">Untick anyone to leave them out of this campaign.</p>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left">School</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {audience.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-sm text-muted-foreground">
                    No eligible school owners found.
                  </td>
                </tr>
              )}
              {audience.map((a) => (
                <tr key={a.email} className={a.suppressed ? "opacity-60" : undefined}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${a.email}`}
                      checked={!a.suppressed && !excluded.has(a.email)}
                      disabled={a.suppressed}
                      onChange={() => toggle(a.email)}
                    />
                  </td>
                  <td className="px-3 py-2">{a.school_name}</td>
                  <td className="px-3 py-2">{a.owner_name ?? "-"}</td>
                  <td className="px-3 py-2">{a.email}</td>
                  <td className="px-3 py-2">{a.suppressed ? "Unsubscribed" : a.school_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Past campaigns</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-right">Sent</th>
                <th className="px-3 py-2 text-right">Failed</th>
                <th className="px-3 py-2 text-right">Skipped</th>
                <th className="px-3 py-2 text-right">Pending</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-sm text-muted-foreground">
                    No campaigns sent yet.
                  </td>
                </tr>
              )}
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2">{h.subject}</td>
                  <td className="px-3 py-2">{formatDate(h.created_at)}</td>
                  <td className="px-3 py-2 text-right">{h.sent}</td>
                  <td className="px-3 py-2 text-right">{h.failed}</td>
                  <td className="px-3 py-2 text-right">{h.skipped}</td>
                  <td className="px-3 py-2 text-right">{h.pending}</td>
                  <td className="px-3 py-2 text-right">
                    {h.pending > 0 && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => handleResume(h.id)}>
                        Resume
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>
              &ldquo;{subject.trim()}&rdquo; will be emailed to {eligible.length} school owner
              {eligible.length === 1 ? "" : "s"} as EDUCORE. This can&apos;t be recalled once sent.
            </DialogDescription>
          </DialogHeader>
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
