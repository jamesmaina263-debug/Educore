"use client";

import { useState, useTransition } from "react";
import {
  checkTrialNudge,
  editTrialNudge,
  proposeTrialNudge,
  reviewTrialNudge,
  sendTrialNudge,
  setTrialNudgeSettings,
  withdrawTrialNudge,
} from "@/app/(admin)/admin/trials/nudges/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { renderCampaignEmail } from "../../../supabase/functions/_shared/campaignEmail";
import {
  KIND_LABELS,
  LIMITS,
  NUDGE_KINDS,
  SERVICE_STARTERS,
  STATUS_LABELS,
  approvalExpiresAt,
  approvalLapsed,
  contentProblem,
  isNudgeKind,
  proposalLapsed,
  sentInLast24h,
  splitQueue,
  type NudgeKind,
  type NudgeStatus,
} from "@/lib/growth/trial-nudges";

// Trial nudges: propose, approve the exact text, send. Every rule is enforced in the database; this screen only
// shows them. Nothing is sent unless a person clicks Send on an approved message AND the switches below are on.

export type NudgeRow = {
  id: string;
  created_at: string;
  school_id: string;
  school_name: string;
  kind: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  payload_hash: string;
  status: string;
  proposed_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  queued_at: string | null;
  sent_at: string | null;
  error: string | null;
};

type Team = { id: string; name: string }[];

const NO_ONE = "none";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " EAT";
}

function statusLabel(s: string): string {
  return STATUS_LABELS[s as NudgeStatus] ?? s;
}

export function TrialNudgesPanel({
  settings,
  nudges,
  schools,
  team,
  nowIso,
}: {
  settings: { sending_enabled: boolean; promotional_enabled: boolean } | null;
  nudges: NudgeRow[];
  schools: { id: string; name: string; label: string }[];
  team: Team;
  nowIso: string;
}) {
  const now = new Date(nowIso);
  const [actor, setActor] = useState(NO_ONE);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const [schoolId, setSchoolId] = useState("");
  const [kind, setKind] = useState<NudgeKind>("service");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  const { open, history } = splitQueue(nudges);
  const sent24 = sentInLast24h(nudges, now);
  const actorId = actor === NO_ONE ? null : actor;
  const school = schools.find((s) => s.id === schoolId);
  const problem = subject || body ? contentProblem(kind, subject, body) : null;
  const preview =
    subject.trim() && body.trim()
      ? renderCampaignEmail({
          body,
          recipientName: "Owner",
          schoolName: school?.name ?? "Your School",
          unsubscribeUrl: "https://www.educoreafrica.com/unsubscribe/…",
          audience: "owners",
        }).text
      : null;

  function run(fn: () => Promise<{ error: string } | { success: true }>, okText: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setMessage({ ok: false, text: r.error });
      else {
        setMessage({ ok: true, text: okText });
        after?.();
      }
    });
  }
  function needActor(): boolean {
    if (!actorId) {
      setMessage({ ok: false, text: "Pick who you are first (top of the page)." });
      return false;
    }
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">You are</Label>
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger className="h-8 w-[12rem] text-[0.8125rem]" aria-label="Who you are">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ONE}>Pick your name</SelectItem>
                {team.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="max-w-xl text-xs text-muted-foreground">
            Nothing here is sent automatically. A person proposes a message, a person approves exactly that text, and a
            person clicks Send. Sends go to the school owner only, with an unsubscribe link, and never to anyone who has
            unsubscribed or asked not to be contacted.
          </p>
        </div>

        {settings ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
            <span>
              Sending: <strong>{settings.sending_enabled ? "ON" : "OFF"}</strong>
            </span>
            <span>
              Promotional: <strong>{settings.promotional_enabled ? "ON" : "OFF"}</strong>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (needActor()) run(() => setTrialNudgeSettings(!settings.sending_enabled, settings.promotional_enabled, actorId as string), "Sending switch updated.");
              }}
            >
              {settings.sending_enabled ? "Turn sending off" : "Turn sending on"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (needActor()) run(() => setTrialNudgeSettings(settings.sending_enabled, !settings.promotional_enabled, actorId as string), "Promotional switch updated.");
              }}
            >
              {settings.promotional_enabled ? "Turn promotional off" : "Turn promotional on"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Both start OFF. Limits: one message per school every {LIMITS.minDaysBetweenMessages} days, at most{" "}
              {LIMITS.maxPromotionalPer30Days} promotional per school in 30 days, {LIMITS.maxPerDayPlatformWide} a day overall
              ({sent24} so far in the last 24 hours).
            </span>
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-destructive">
            Trial messages are not available yet on this environment (the settings could not be read). Nothing can be sent.
          </p>
        )}
        {settings && (
          <p className="text-xs text-muted-foreground">
            Promotional messages are marketing: have the Data Protection Act position on contacting trial schools settled
            before turning promotional on.
          </p>
        )}
        {message && <p className={`text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</p>}
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">Propose a message</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">School (running trials and trials that ended in the last {LIMITS.winBackDays} days)</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="School">
                <SelectValue placeholder="Pick a school" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.label})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={(v) => isNudgeKind(v) && setKind(v)}>
              <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Kind of message">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUDGE_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {kind === "service" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Start from:</span>
            {SERVICE_STARTERS.map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant="outline"
                onClick={() => {
                  setSubject(t.subject);
                  setBody(t.body);
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Write the offer yourself and make sure it is true. Nothing here changes a price or a subscription, and a
            discount only exists if you separately set it up. Links may only point to educoreafrica.com.
          </p>
        )}
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Subject</Label>
          <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Message ({"{{name}}"} and {"{{school}}"} are filled in)</Label>
          <Textarea rows={7} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {problem && <p className="text-xs text-destructive">{problem}</p>}
        {preview && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Exactly what the owner will read (text version)</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded border border-border bg-background p-2">{preview}</pre>
          </details>
        )}
        <div>
          <Button
            size="sm"
            disabled={pending || !schoolId || !!problem || !subject.trim() || !body.trim()}
            onClick={() => {
              if (!needActor()) return;
              run(
                () => proposeTrialNudge({ schoolId, kind, subject, body, proposedBy: actorId as string }),
                "Proposed. It now waits for review.",
                () => {
                  setSubject("");
                  setBody("");
                },
              );
            }}
          >
            Propose for review
          </Button>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">Waiting, approved and sending</h2>
        {open.length === 0 && <p className="text-xs text-muted-foreground">Nothing is waiting.</p>}
        {open.map((n) => {
          const lapsedProposal = n.status === "proposed" && proposalLapsed(n.created_at, now);
          const lapsedApproval = n.status === "approved" && approvalLapsed(n.reviewed_at, now);
          const expiresAt = approvalExpiresAt(n.reviewed_at);
          return (
            <div key={n.id} className="flex flex-col gap-2 rounded border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{n.school_name}</span>
                <span className="text-xs text-muted-foreground">
                  {KIND_LABELS[n.kind as NudgeKind] ?? n.kind} · to {n.recipient_email} · {statusLabel(n.status)}
                  {n.status === "approved" && expiresAt ? ` · approval lapses ${when(expiresAt.toISOString())}` : ""}
                </span>
              </div>
              {editing === n.id ? (
                <div className="flex flex-col gap-2">
                  <Input value={editSubject} maxLength={200} onChange={(e) => setEditSubject(e.target.value)} />
                  <Textarea rows={6} maxLength={4000} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  {contentProblem(n.kind, editSubject, editBody) && (
                    <p className="text-xs text-destructive">{contentProblem(n.kind, editSubject, editBody)}</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending || !!contentProblem(n.kind, editSubject, editBody)}
                      onClick={() => run(() => editTrialNudge(n.id, n.kind, editSubject, editBody), "Saved. Review the new text before approving.", () => setEditing(null))}
                    >
                      Save changes
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="font-medium">{n.subject}</p>
                  <p className="whitespace-pre-wrap text-xs">{n.body}</p>
                </div>
              )}
              {n.status === "queued" && (
                <p className="text-xs text-muted-foreground">Handed over for sending {when(n.queued_at)}. Use Check status to read the result.</p>
              )}
              {lapsedProposal && <p className="text-xs text-destructive">This proposal is more than 7 days old and will expire when reviewed.</p>}
              {lapsedApproval && <p className="text-xs text-destructive">The approval has lapsed. Sending will mark it expired; propose it again.</p>}
              {n.status === "approved" && !settings?.sending_enabled && (
                <p className="text-xs text-muted-foreground">Sending is OFF, so Send will be refused until it is turned on.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {n.status === "proposed" && editing !== n.id && (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (needActor()) run(() => reviewTrialNudge(n.id, "approve", n.payload_hash, actorId as string), "Approved. It can now be sent.");
                      }}
                    >
                      Approve exactly this text
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (needActor()) run(() => reviewTrialNudge(n.id, "reject", "", actorId as string), "Rejected.");
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setEditing(n.id);
                        setEditSubject(n.subject);
                        setEditBody(n.body);
                      }}
                    >
                      Edit
                    </Button>
                  </>
                )}
                {n.status === "approved" && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`Send this email to ${n.recipient_email} now?`)) return;
                      setMessage(null);
                      startTransition(async () => {
                        const r = await sendTrialNudge(n.id);
                        setMessage("error" in r ? { ok: false, text: r.error } : { ok: true, text: "Sent." });
                      });
                    }}
                  >
                    Send now
                  </Button>
                )}
                {n.status === "queued" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setMessage(null);
                      startTransition(async () => {
                        const r = await checkTrialNudge(n.id);
                        setMessage("error" in r ? { ok: false, text: r.error } : { ok: true, text: `Status: ${statusLabel(r.status)}.` });
                      });
                    }}
                  >
                    Check status
                  </Button>
                )}
                {(n.status === "proposed" || n.status === "approved") && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => withdrawTrialNudge(n.id), "Withdrawn.")}>
                    Withdraw
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel flex flex-col gap-2 p-4">
        <h2 className="text-sm font-medium">History</h2>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {history.slice(0, 50).map((n) => (
              <li key={n.id}>
                <span className="font-medium">{statusLabel(n.status)}</span> · {n.school_name} ·{" "}
                {KIND_LABELS[n.kind as NudgeKind] ?? n.kind} · {when(n.sent_at ?? n.reviewed_at ?? n.created_at)} · {n.subject}
                {n.error ? ` · ${n.error}` : ""}
                {n.review_note ? ` · note: ${n.review_note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
