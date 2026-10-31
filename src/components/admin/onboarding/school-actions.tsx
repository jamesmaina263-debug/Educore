"use client";

import { useState, useTransition } from "react";
import { addOnboardingNote, triggerOnboardingFollowup } from "@/app/(admin)/admin/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NO_ONE, TeamSelect, type Team } from "@/components/admin/onboarding/team-select";
import { NOTE_KINDS, NOTE_KIND_LABELS, NOTE_MAX, formatDateTime, isNoteKind, type NoteKind, type SchoolDetail } from "@/lib/onboarding/onboarding";

// Manual follow-up and admin notes for one school. A manual follow-up only PROPOSES the email into the trial message
// queue; a person still approves the exact text and clicks Send there.

export function SchoolActions({
  schoolId,
  status,
  notes,
  team,
}: {
  schoolId: string;
  status: string;
  notes: SchoolDetail["notes"];
  team: Team;
}) {
  const [actor, setActor] = useState(NO_ONE);
  const [kind, setKind] = useState<NoteKind>("call");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const canRemind = status === "password_pending";
  const canGuide = status === "not_started";

  function needActor(): boolean {
    if (actor === NO_ONE) {
      setMsg({ ok: false, text: "Pick your name first." });
      return false;
    }
    return true;
  }

  function propose(rule: "password_reminder_email" | "login_guidance_email") {
    setMsg(null);
    if (!needActor()) return;
    start(async () => {
      const res = await triggerOnboardingFollowup({ schoolId, rule, by: actor });
      setMsg("error" in res ? { ok: false, text: res.error } : { ok: true, text: "Proposed. Review and send it from Trial messages; nothing has been sent yet." });
    });
  }

  function saveNote() {
    setMsg(null);
    if (!needActor()) return;
    start(async () => {
      const res = await addOnboardingNote({ schoolId, kind, note: text, by: actor });
      if ("error" in res) setMsg({ ok: false, text: res.error });
      else {
        setText("");
        setMsg({ ok: true, text: "Note saved." });
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="followup-heading" className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="followup-heading" className="text-sm font-semibold">
            Trigger a follow-up
          </h2>
          <TeamSelect team={team} value={actor} onChange={setActor} />
        </div>
        <p className="text-xs text-muted-foreground">
          This proposes a service email to the school owner. It is not sent until a person approves it on the Trial messages page, and every
          existing safeguard (unsubscribes, &quot;asked to stop&quot;, frequency limits) still applies.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending || !canRemind} onClick={() => propose("password_reminder_email")}>
            Propose password reminder
          </Button>
          <Button size="sm" variant="outline" disabled={pending || !canGuide} onClick={() => propose("login_guidance_email")}>
            Propose login guidance
          </Button>
        </div>
        {!canRemind && !canGuide && (
          <p className="text-xs text-muted-foreground">Neither email applies to this school right now. Use a note to record a call or demonstration.</p>
        )}
      </section>

      {msg && (
        <p role="status" className={msg.ok ? "text-xs text-emerald-800" : "text-xs text-destructive"}>
          {msg.text}
        </p>
      )}

      <section aria-labelledby="notes-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 id="notes-heading" className="text-sm font-semibold">
          Admin notes
        </h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of note">
            {NOTE_KINDS.map((k) => (
              <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} aria-pressed={kind === k} onClick={() => isNoteKind(k) && setKind(k)}>
                {NOTE_KIND_LABELS[k]}
              </Button>
            ))}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="What was discussed, shown or reported?"
            aria-label="Note"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {text.length}/{NOTE_MAX}
            </span>
            <Button size="sm" disabled={pending || text.trim() === ""} onClick={saveNote}>
              Save note
            </Button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 py-2">
                <span className="text-xs text-muted-foreground">
                  {NOTE_KIND_LABELS[n.kind as NoteKind] ?? n.kind} · {formatDateTime(n.created_at)}
                  {n.author ? ` · ${n.author}` : ""}
                </span>
                <p className="whitespace-pre-wrap text-sm">{n.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
