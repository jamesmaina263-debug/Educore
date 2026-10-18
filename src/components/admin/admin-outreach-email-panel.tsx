"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createOutreachEmailCampaign,
  getOutreachEmailAudience,
  sendOutreachTestEmail,
  type OutreachEmailCandidate,
  type OutreachEmailQuota,
} from "@/app/(admin)/admin/outreach/actions";
import { sendCampaignBatch } from "@/app/(admin)/admin/email-campaigns/actions";

type Progress = { campaignId: string; sent: number; failed: number; remaining: number };

// Emails the reviewed drafts of APPROVED schools, through the same sender as Email Campaigns. Nothing here
// is automatic: the admin ticks schools, sends a test to themselves, confirms, and the batches then run.
export function AdminOutreachEmailPanel({
  initialCandidates,
  initialQuota,
  initialError,
}: {
  initialCandidates: OutreachEmailCandidate[];
  initialQuota: OutreachEmailQuota;
  initialError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<OutreachEmailCandidate[]>(initialCandidates);
  const [quota, setQuota] = useState<OutreachEmailQuota>(initialQuota);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<OutreachEmailCandidate | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    const res = await getOutreachEmailAudience();
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setCandidates(res.candidates);
    setQuota(res.quota);
    setSelected(new Set());
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < quota.remaining) next.add(id);
      return next;
    });
  }

  function selectUpToLimit() {
    setSelected(new Set(candidates.slice(0, quota.remaining).map((c) => c.prospect_id)));
  }

  async function runBatches(campaignId: string) {
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < 20; i++) {
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
        setNotice(`Finished: ${sent} sent, ${failed} failed.`);
        setProgress(null);
        await load();
        router.refresh();
        return;
      }
    }
  }

  function handleTest() {
    const first = candidates.find((c) => selected.has(c.prospect_id)) ?? candidates[0];
    if (!first) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await sendOutreachTestEmail(first.prospect_id);
      if ("error" in res) setError(res.error);
      else setNotice(`Test of "${first.school_name}" sent to ${res.sentTo} (nobody else).`);
    });
  }

  function handleSend() {
    setError(null);
    setNotice(null);
    setConfirmOpen(false);
    startTransition(async () => {
      const created = await createOutreachEmailCampaign(Array.from(selected));
      if ("error" in created) {
        setError(created.error);
        return;
      }
      setSelected(new Set());
      await runBatches(created.campaignId);
    });
  }

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-[0.8125rem] font-semibold">Email approved schools</h2>
        <p className="text-xs text-muted-foreground">
          Sends each school&apos;s reviewed draft from the Email Campaigns sender, with an unsubscribe link. Only
          approved schools with confirmed details that were never emailed are listed. Limit: {quota.cap} per 24 hours
          ({quota.remaining} left now). You&apos;re notified when someone unsubscribes.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-success">{notice}</p>}
      {progress && (
        <p className="text-sm">
          Sending… {progress.sent} sent, {progress.failed} failed
          {progress.remaining >= 0 ? `, ${progress.remaining} left` : ""}
          {progress.remaining < 0 && (
            <Button
              size="sm"
              className="ml-2"
              disabled={pending}
              onClick={() => startTransition(async () => runBatches(progress.campaignId))}
            >
              Resume
            </Button>
          )}
        </p>
      )}

      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No schools are ready to email. Approve prospects that have an email and a draft, and confirm any contact
          details found by the website or AI search.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table-dense w-full">
              <thead className="bg-muted/70">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 text-left">School</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.prospect_id}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Include ${c.school_name}`}
                        checked={selected.has(c.prospect_id)}
                        onChange={() => toggle(c.prospect_id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {c.school_name}
                      {c.town_county ? <span className="text-muted-foreground"> · {c.town_county}</span> : null}
                    </td>
                    <td className="px-3 py-2">{c.email}</td>
                    <td className="px-3 py-2">{c.subject}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => setPreview(c)}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={pending || quota.remaining === 0} onClick={selectUpToLimit}>
              Select up to today&apos;s limit
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={handleTest}>
              Send test to me
            </Button>
            <Button size="sm" disabled={pending || selected.size === 0} onClick={() => setConfirmOpen(true)}>
              Send {selected.size} email{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{preview?.subject}</DialogTitle>
            <DialogDescription>
              To {preview?.contact_name ? `${preview.contact_name}, ` : ""}
              {preview?.email}
            </DialogDescription>
          </DialogHeader>
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm">{preview?.body}</p>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Send {selected.size} email{selected.size === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              Each school gets its own reviewed draft with an unsubscribe link. This can&apos;t be undone, and each
              school will only ever be emailed once.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={handleSend}>
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
