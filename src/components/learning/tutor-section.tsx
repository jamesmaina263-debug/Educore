"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateTutorDraftAction, reviewTutorDraftAction, updateTutorDraftAction } from "@/app/(app)/academics/learning/tutor/actions";

export interface TutorOption { id: string; label: string }
export interface TutorNoteRow { id: string; streamId: string; subjectId: string; title: string }
export interface TutorDraftRow {
  id: string;
  streamId: string;
  subjectId: string;
  title: string;
  body: string;
  status: "draft" | "approved" | "rejected";
  sources: string[];
  model: string;
  createdAt: string;
  editable: boolean;
}

const STATUS_LABEL = { draft: "Draft — not visible to learners", approved: "Approved — visible to learners", rejected: "Rejected / withdrawn" } as const;

function DraftCard({ d, labels }: { d: TutorDraftRow; labels: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(d.title);
  const [body, setBody] = useState(d.body);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = title !== d.title || body !== d.body;

  function run(fn: () => Promise<{ error: string } | { success: true }>, ok?: string) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if ("error" in r) setMessage(r.error);
      else { if (ok) setMessage(ok); router.refresh(); }
    });
  }

  return (
    <li className="panel space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{d.title}</p>
        <span className="text-xs text-muted-foreground">{STATUS_LABEL[d.status]}</span>
      </div>
      <p className="text-xs text-muted-foreground">{labels} · AI-drafted ({d.model}) · {new Date(d.createdAt).toLocaleString()}</p>
      <p className="text-xs">Made only from: {d.sources.join(", ")}</p>

      {d.status === "draft" && d.editable ? (
        <div className="space-y-2">
          <input className="w-full rounded border bg-background px-2 py-1" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <textarea className="w-full rounded border bg-background px-2 py-1" rows={12} maxLength={12000} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Study guide text" />
          <p className="text-xs text-muted-foreground">Read it all before approving. AI can still get things wrong, even from good notes. You can edit the text; the sources cannot be changed.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border px-3 py-1.5 disabled:opacity-50" disabled={pending || !dirty} onClick={() => run(() => updateTutorDraftAction(d.id, title, body), "Saved.")}>Save edits</button>
            <button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={pending || dirty} title={dirty ? "Save your edits first" : undefined} onClick={() => run(() => reviewTutorDraftAction(d.id, "approve"))}>Approve for learners</button>
            <button type="button" className="rounded border px-3 py-1.5 disabled:opacity-50" disabled={pending} onClick={() => run(() => reviewTutorDraftAction(d.id, "reject"))}>Reject</button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap rounded bg-muted p-2">{d.body}</p>
          {d.status === "approved" && d.editable && (
            <button type="button" className="rounded border px-3 py-1.5 disabled:opacity-50" disabled={pending} onClick={() => run(() => reviewTutorDraftAction(d.id, "withdraw"))}>Withdraw from learners</button>
          )}
        </>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
    </li>
  );
}

export function TutorSection({ streams, subjects, notes, drafts }: { streams: TutorOption[]; subjects: TutorOption[]; notes: TutorNoteRow[]; drafts: TutorDraftRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [streamId, setStreamId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState(false);

  const available = notes.filter((n) => n.streamId === streamId && n.subjectId === subjectId);
  const label = (d: TutorDraftRow) => `${streams.find((s) => s.id === d.streamId)?.label ?? ""} · ${subjects.find((s) => s.id === d.subjectId)?.label ?? ""}`;

  function generate() {
    setError(null);
    setMade(false);
    start(async () => {
      const r = await generateTutorDraftAction({ streamId, subjectId, noteIds: picked, idempotencyKey: crypto.randomUUID() });
      if ("error" in r) setError(r.error);
      else { setMade(true); setPicked([]); router.refresh(); }
    });
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-3 text-sm">
        <h2 className="font-semibold">Draft a study guide with AI</h2>
        <p className="text-muted-foreground">
          The AI reads only the published notes you choose, for one class and subject, and writes a study guide that names the notes it used. It is saved as a draft. Learners see nothing until you approve it, and the guide disappears for them if one of its notes is unpublished or edited.
        </p>
        <div className="flex flex-wrap gap-3">
          <select className="rounded border bg-background px-2 py-1" value={streamId} onChange={(e) => { setStreamId(e.target.value); setPicked([]); }} aria-label="Class">
            <option value="">Choose class…</option>
            {streams.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select className="rounded border bg-background px-2 py-1" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setPicked([]); }} aria-label="Subject">
            <option value="">Choose subject…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        {streamId && subjectId && (
          available.length === 0 ? (
            <p className="text-muted-foreground">There are no published notes for this class and subject yet. Add a note (text) on the Learning page and publish it first. Videos and links can&apos;t be read by the AI.</p>
          ) : (
            <fieldset className="space-y-1">
              <legend className="font-medium">Choose up to 20 notes</legend>
              {available.map((n) => (
                <label key={n.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(n.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, n.id] : p.filter((x) => x !== n.id)))} />
                  <span>{n.title}</span>
                </label>
              ))}
            </fieldset>
          )
        )}
        <button type="button" className="rounded bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-50" disabled={pending || picked.length === 0} onClick={generate}>
          {pending ? "Drafting… (up to a minute)" : "Draft study guide"}
        </button>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {made && <p role="status" className="text-muted-foreground">Draft created below. Read it, edit if needed, then approve.</p>}
      </div>

      <ul className="space-y-3">
        {drafts.length === 0 ? <li className="text-sm text-muted-foreground">No study guides yet.</li> : drafts.map((d) => <DraftCard key={d.id} d={d} labels={label(d)} />)}
      </ul>
    </div>
  );
}
