"use client";

import { useState, useTransition } from "react";
import {
  editSalesWhatsApp,
  markSalesWhatsAppSent,
  proposeSalesWhatsApp,
  recordWhatsAppAgreement,
  reviewSalesWhatsApp,
  setSalesWhatsAppPromotional,
  withdrawSalesWhatsApp,
  withdrawWhatsAppAgreement,
} from "@/app/(admin)/admin/sales-whatsapp/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HOW_OPTIONS,
  KIND_LABELS,
  LIMITS,
  SCOPE_OPTIONS,
  SOURCE_LABELS,
  STATUS_LABELS,
  WHATSAPP_KINDS,
  approvalExpiresAt,
  approvalLapsed,
  displayNumber,
  isHow,
  isKind,
  isScope,
  messageProblem,
  proposalLapsed,
  sentInLast24h,
  splitQueue,
  whatsappLink,
  type AgreedHow,
  type AgreementScope,
  type WhatsAppKind,
  type WhatsAppStatus,
} from "@/lib/growth/sales-whatsapp";

// Sales WhatsApp, first version: a register of who agreed to WhatsApp contact, and an approval queue. A PERSON sends
// an approved message from their own WhatsApp (the button opens WhatsApp with the text filled in) and then marks it
// sent here. Nothing is sent by the system. Every rule is enforced in the database; this screen only shows them.

export type ConsentRow = {
  id: string;
  created_at: string;
  phone: string;
  contact_name: string;
  school_name: string | null;
  source: string;
  scope: string;
  consent_text: string;
  how: string | null;
  note: string | null;
  withdrawn_at: string | null;
};

export type MessageRow = {
  id: string;
  created_at: string;
  consent_id: string;
  phone: string;
  recipient_name: string;
  kind: string;
  body: string;
  payload_hash: string;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  sent_at: string | null;
};

type Team = { id: string; name: string }[];
const NO_ONE = "none";
const NO_SCHOOL = "none";

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + " EAT";
}
function statusLabel(s: string): string {
  return STATUS_LABELS[s as WhatsAppStatus] ?? s;
}

export function SalesWhatsAppPanel({
  settings,
  consents,
  messages,
  schools,
  team,
  nowIso,
}: {
  settings: { promotional_enabled: boolean } | null;
  consents: ConsentRow[];
  messages: MessageRow[];
  schools: { id: string; name: string }[];
  team: Team;
  nowIso: string;
}) {
  const now = new Date(nowIso);
  const [actor, setActor] = useState(NO_ONE);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const actorId = actor === NO_ONE ? null : actor;

  // record an agreement
  const [aName, setAName] = useState("");
  const [aPhone, setAPhone] = useState("");
  const [aSchoolName, setASchoolName] = useState("");
  const [aSchoolId, setASchoolId] = useState(NO_SCHOOL);
  const [aHow, setAHow] = useState<AgreedHow>("call");
  const [aScope, setAScope] = useState<AgreementScope>("service");
  const [aNote, setANote] = useState("");

  // propose a message
  const [consentId, setConsentId] = useState("");
  const [kind, setKind] = useState<WhatsAppKind>("service");
  const [body, setBody] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const active = consents.filter((c) => !c.withdrawn_at);
  const withdrawn = consents.filter((c) => c.withdrawn_at);
  const consent = active.find((c) => c.id === consentId);
  const nameById = new Map(consents.map((c) => [c.id, c]));
  const { open, history } = splitQueue(messages);
  const sent24 = sentInLast24h(messages, now);
  const problem = body ? messageProblem(kind, body) : null;
  const scopeProblem =
    kind === "promotional" && consent && consent.scope !== "service_and_promotional"
      ? "This person agreed to messages about their demo and trial only, not promotional ones."
      : null;

  function run(fn: () => Promise<{ error: string } | { success: true }>, okText: string, after?: () => void) {
    setNotice(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setNotice({ ok: false, text: r.error });
      else {
        setNotice({ ok: true, text: okText });
        after?.();
      }
    });
  }
  function needActor(): boolean {
    if (!actorId) {
      setNotice({ ok: false, text: "Pick who you are first (top of the page)." });
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
            Only people who agreed to WhatsApp contact can be messaged, and only for what they agreed to. A person proposes
            a message, a person approves exactly that text, and a person sends it from their own WhatsApp and marks it sent.{" "}
            <strong>Nothing is sent by the system.</strong> Automatic sending through Twilio comes later.
          </p>
        </div>
        {settings ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
            <span>
              Promotional messages: <strong>{settings.promotional_enabled ? "ON" : "OFF"}</strong>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (needActor()) run(() => setSalesWhatsAppPromotional(!settings.promotional_enabled, actorId as string), "Promotional switch updated.");
              }}
            >
              {settings.promotional_enabled ? "Turn promotional off" : "Turn promotional on"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Starts OFF. Promotional messages are marketing: have the Data Protection Act position settled before turning
              it on. Limits: one message per person every {LIMITS.minDaysBetweenMessages} days, at most{" "}
              {LIMITS.maxPromotionalPer30Days} promotional per person in 30 days, {LIMITS.maxPerDayPlatformWide} a day overall (
              {sent24} so far in the last 24 hours).
            </span>
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-xs text-destructive">
            WhatsApp messaging is not available yet on this environment (its settings could not be read). Nothing can be
            recorded or sent.
          </p>
        )}
        {notice && <p className={`text-xs ${notice.ok ? "text-muted-foreground" : "text-destructive"}`}>{notice.text}</p>}
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">People who agreed to WhatsApp contact</h2>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nobody yet. People who tick the WhatsApp box on the demo form appear here automatically. For anyone else
            (for example a trial-school owner), record their agreement below once they have told you it is fine.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {active.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 rounded border border-border p-2">
                <span className="font-medium">{c.contact_name}</span>
                <span className="tabular-nums">{displayNumber(c.phone)}</span>
                <span className="text-xs text-muted-foreground">
                  {c.school_name ? `${c.school_name} · ` : ""}
                  {SOURCE_LABELS[c.source] ?? c.source} · {SCOPE_OPTIONS.find((o) => o.value === c.scope)?.label ?? c.scope} · {when(c.created_at)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    if (!needActor()) return;
                    if (!window.confirm(`Withdraw ${c.contact_name}'s agreement? This blocks the number from WhatsApp messages permanently.`)) return;
                    run(() => withdrawWhatsAppAgreement(c.id, actorId as string, "Withdrawn on the WhatsApp page."), "Agreement withdrawn and number blocked.");
                  }}
                >
                  Withdraw
                </Button>
              </li>
            ))}
          </ul>
        )}
        {withdrawn.length > 0 && <p className="text-xs text-muted-foreground">{withdrawn.length} withdrawn agreement(s) are blocked and not shown.</p>}

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Record an agreement a person gave you (call, in person, reply, email)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Name</Label>
              <Input value={aName} maxLength={LIMITS.nameMax} onChange={(e) => setAName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">WhatsApp number</Label>
              <Input value={aPhone} onChange={(e) => setAPhone(e.target.value)} placeholder="0712 345 678" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">School name (optional)</Label>
              <Input value={aSchoolName} maxLength={200} onChange={(e) => setASchoolName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Link to a running trial (optional)</Label>
              <Select value={aSchoolId} onValueChange={setASchoolId}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Linked school">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SCHOOL}>No link</SelectItem>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">How they agreed</Label>
              <Select value={aHow} onValueChange={(v) => isHow(v) && setAHow(v)}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="How they agreed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOW_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">What they agreed to</Label>
              <Select value={aScope} onValueChange={(v) => isScope(v) && setAScope(v)}>
                <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="What they agreed to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label className="text-xs">Note (optional)</Label>
              <Input value={aNote} maxLength={LIMITS.noteMax} onChange={(e) => setANote(e.target.value)} placeholder="Only record it if they really said yes." />
            </div>
            <div>
              <Button
                size="sm"
                disabled={pending || !aName.trim() || !aPhone.trim()}
                onClick={() => {
                  if (!needActor()) return;
                  run(
                    () =>
                      recordWhatsAppAgreement({
                        phone: aPhone,
                        name: aName,
                        schoolName: aSchoolName,
                        schoolId: aSchoolId === NO_SCHOOL ? null : aSchoolId,
                        how: aHow,
                        scope: aScope,
                        note: aNote,
                        recordedBy: actorId as string,
                      }),
                    "Agreement recorded.",
                    () => {
                      setAName("");
                      setAPhone("");
                      setASchoolName("");
                      setANote("");
                    },
                  );
                }}
              >
                Record agreement
              </Button>
            </div>
          </div>
        </details>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">Propose a message</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">To</Label>
            <Select value={consentId} onValueChange={setConsentId}>
              <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Who to message">
                <SelectValue placeholder="Pick a person who agreed" />
              </SelectTrigger>
              <SelectContent>
                {active.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.contact_name} ({displayNumber(c.phone)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Kind</Label>
            <Select value={kind} onValueChange={(v) => isKind(v) && setKind(v)}>
              <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Kind of message">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WHATSAPP_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Message (sent exactly as written: write the name yourself, no placeholders)</Label>
          <Textarea rows={5} maxLength={LIMITS.bodyMax} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="text-xs text-muted-foreground">
            {body.length}/{LIMITS.bodyMax}
          </span>
        </div>
        {(problem || scopeProblem) && <p className="text-xs text-destructive">{problem ?? scopeProblem}</p>}
        <div>
          <Button
            size="sm"
            disabled={pending || !consentId || !body.trim() || !!problem || !!scopeProblem}
            onClick={() => {
              if (!needActor()) return;
              run(() => proposeSalesWhatsApp({ consentId, kind, body, proposedBy: actorId as string }), "Proposed. It now waits for review.", () => setBody(""));
            }}
          >
            Propose for review
          </Button>
        </div>
      </section>

      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="text-sm font-medium">Waiting and approved</h2>
        {open.length === 0 && <p className="text-xs text-muted-foreground">Nothing is waiting.</p>}
        {open.map((m) => {
          const lapsedProposal = m.status === "proposed" && proposalLapsed(m.created_at, now);
          const lapsedApproval = m.status === "approved" && approvalLapsed(m.reviewed_at, now);
          const expiresAt = approvalExpiresAt(m.reviewed_at);
          return (
            <div key={m.id} className="flex flex-col gap-2 rounded border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.recipient_name}</span>
                <span className="text-xs text-muted-foreground">
                  {displayNumber(m.phone)} · {KIND_LABELS[m.kind as WhatsAppKind] ?? m.kind} · {statusLabel(m.status)}
                  {m.status === "approved" && expiresAt ? ` · approval lapses ${when(expiresAt.toISOString())}` : ""}
                </span>
              </div>
              {editing === m.id ? (
                <div className="flex flex-col gap-2">
                  <Textarea rows={5} maxLength={LIMITS.bodyMax} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  {messageProblem(m.kind, editBody) && <p className="text-xs text-destructive">{messageProblem(m.kind, editBody)}</p>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={pending || !!messageProblem(m.kind, editBody)}
                      onClick={() => run(() => editSalesWhatsApp(m.id, m.kind, editBody), "Saved. Review the new text before approving.", () => setEditing(null))}
                    >
                      Save changes
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-xs">{m.body}</p>
              )}
              {lapsedProposal && <p className="text-xs text-destructive">This proposal is more than 7 days old and will expire when reviewed.</p>}
              {lapsedApproval && <p className="text-xs text-destructive">The approval has lapsed. Marking it sent will expire it; propose it again.</p>}
              <div className="flex flex-wrap gap-2">
                {m.status === "proposed" && editing !== m.id && (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (needActor()) run(() => reviewSalesWhatsApp(m.id, "approve", m.payload_hash, actorId as string), "Approved. Send it from WhatsApp, then mark it sent.");
                      }}
                    >
                      Approve exactly this text
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (needActor()) run(() => reviewSalesWhatsApp(m.id, "reject", "", actorId as string), "Rejected.");
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setEditing(m.id);
                        setEditBody(m.body);
                      }}
                    >
                      Edit
                    </Button>
                  </>
                )}
                {m.status === "approved" && (
                  <>
                    <a
                      href={whatsappLink(m.phone, m.body)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium"
                    >
                      Open in WhatsApp
                    </a>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        void navigator.clipboard?.writeText(m.body);
                        setNotice({ ok: true, text: "Message copied." });
                      }}
                    >
                      Copy text
                    </Button>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        if (!needActor()) return;
                        if (!window.confirm(`Only mark this as sent if you have really sent it to ${displayNumber(m.phone)}. Mark as sent?`)) return;
                        run(() => markSalesWhatsAppSent(m.id, actorId as string), "Marked as sent.");
                      }}
                    >
                      I sent it: mark as sent
                    </Button>
                  </>
                )}
                {(m.status === "proposed" || m.status === "approved") && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => withdrawSalesWhatsApp(m.id), "Withdrawn.")}>
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
            {history.slice(0, 50).map((m) => (
              <li key={m.id}>
                <span className="font-medium">{statusLabel(m.status)}</span> · {nameById.get(m.consent_id)?.contact_name ?? m.recipient_name} ·{" "}
                {KIND_LABELS[m.kind as WhatsAppKind] ?? m.kind} · {when(m.sent_at ?? m.reviewed_at ?? m.created_at)}
                {m.review_note ? ` · note: ${m.review_note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
