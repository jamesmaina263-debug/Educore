"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import {
  updateNewsletterDraftBodyAction,
  previewTermNewsletterDraftAction,
  polishNewsletterDraftWithAIAction,
  sendTermNewsletterDraftAction,
} from "@/app/(app)/academics/newsletter-actions";

export interface NewsletterDraftRow {
  id: string;
  termId: string;
  termName: string;
  termEndDate: string;
  triggerType: "automatic" | "manual";
  draftBody: string;
  aiDrafted: boolean;
  status: "draft" | "approved" | "sent";
  generatedAt: string;
  sentAt: string | null;
  recipientCount: number | null;
}

function statusTone(status: NewsletterDraftRow["status"]) {
  if (status === "sent") return "success" as const;
  return "warning" as const;
}

export function NewslettersSection({
  drafts,
  canWrite,
}: {
  drafts: NewsletterDraftRow[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function bodyValue(d: NewsletterDraftRow) {
    return edits[d.id] ?? d.draftBody;
  }

  function runOn(id: string, fn: () => Promise<{ error: string } | { success: true }>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        setError(result.error);
      }
      setBusyId(null);
    });
  }

  async function handlePreview(id: string) {
    setPreviewingId(id);
    setError(null);
    const result = await previewTermNewsletterDraftAction(id);
    setPreviewingId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPreviews((p) => ({ ...p, [id]: result.preview }));
  }

  async function handleSend(id: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    const result = await sendTermNewsletterDraftAction(id);
    setBusyId(null);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setNotice(`Sent to ${result.recipientCount} guardian(s).`);
  }

  const pendingDrafts = drafts.filter((d) => d.status === "draft" || d.status === "approved");
  const sentDrafts = drafts.filter((d) => d.status === "sent");

  return (
    <div className="flex flex-col gap-6">
      <div className="panel p-4">
        <p className="text-sm text-muted-foreground">
          Newsletters prepared here (automatically once a term&apos;s end date passes, or via &ldquo;Prepare
          newsletter&rdquo; in Years &amp; Terms) sit here for review first. Edit the wording, preview it merged
          with a real guardian and fee breakdown, optionally polish the tone with AI, then approve &amp; send —
          nothing goes out until you do.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}

      <div>
        <p className="mb-2 text-sm font-semibold">Pending review ({pendingDrafts.length})</p>
        {pendingDrafts.length === 0 && (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing pending review right now.
          </div>
        )}
        <div className="flex flex-col gap-4">
          {pendingDrafts.map((d) => (
            <div key={d.id} className="panel p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{d.termName}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.triggerType === "automatic" ? "Prepared automatically" : "Prepared manually"} — term ends{" "}
                    {d.termEndDate}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {d.aiDrafted && <StatusBadge tone="info" label="AI-polished" />}
                  <StatusBadge tone={statusTone(d.status)} label={d.status} />
                </div>
              </div>

              <Textarea
                value={bodyValue(d)}
                onChange={(e) => setEdits((s) => ({ ...s, [d.id]: e.target.value }))}
                disabled={!canWrite || busyId === d.id}
                rows={7}
                className="mb-2 font-mono text-xs"
              />
              <p className="mb-3 text-xs text-muted-foreground">
                Placeholders like <code>{"{{guardian_name}}"}</code>, <code>{"{{student_name}}"}</code>,{" "}
                <code>{"{{fee_section}}"}</code> merge in real values per guardian at send time — keep them intact.
              </p>

              {canWrite && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === d.id}
                    onClick={() => runOn(d.id, () => updateNewsletterDraftBodyAction(d.id, bodyValue(d)))}
                  >
                    Save edits
                  </Button>
                  <Button size="sm" variant="secondary" disabled={previewingId === d.id} onClick={() => handlePreview(d.id)}>
                    {previewingId === d.id ? "Loading preview…" : "Preview (real sample)"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending && busyId === d.id}
                    onClick={() => runOn(d.id, () => polishNewsletterDraftWithAIAction(d.id))}
                  >
                    {pending && busyId === d.id ? "Polishing…" : "Polish with AI"}
                  </Button>
                  <Button size="sm" disabled={busyId === d.id} onClick={() => handleSend(d.id)}>
                    {busyId === d.id ? "Sending…" : "Approve & send"}
                  </Button>
                </div>
              )}

              {previews[d.id] && (
                <div className="panel border-dashed bg-muted/30 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Preview — merged with a real guardian/student on file:
                  </p>
                  <pre className="whitespace-pre-wrap text-xs">{previews[d.id]}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {sentDrafts.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Sent ({sentDrafts.length})</p>
          <div className="flex flex-col gap-2">
            {sentDrafts.map((d) => (
              <div key={d.id} className="panel p-3 text-sm flex items-center justify-between gap-2">
                <span>
                  {d.termName} — {d.recipientCount ?? 0} guardian(s)
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {d.sentAt}
                  <StatusBadge tone={statusTone(d.status)} label={d.status} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
