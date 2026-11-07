"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureTutorQaAction, reviewTutorQuestionAction } from "@/app/(app)/academics/learning/tutor/questions/actions";
import { deleteQaQuestionsAction, setQaOptOutAction } from "@/app/portal/learning/qa-actions";

export function TutorQaSettings({ staff, contactId, dpia, notice, canConfigure }: { staff: { id: string; name: string }[]; contactId: string | null; dpia: boolean; notice: boolean; canConfigure: boolean }) {
  const router = useRouter();
  const [contact, setContact] = useState(contactId ?? "");
  const [d, setD] = useState(dpia);
  const [n, setN] = useState(notice);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = Boolean(contactId) && dpia && notice;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await configureTutorQaAction({ contactId: contact || null, dpiaConfirmed: d, parentNoticeConfirmed: n });
      if ("error" in res) setMsg(res.error);
      else {
        setMsg("Saved.");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-sm font-semibold">Set-up for learner questions</h2>
      <p className="text-sm">
        Status: <strong>{ready ? "Ready. Learners and parents can ask questions." : "Not ready. Learners cannot ask questions until all three items below are done."}</strong>
      </p>
      <p className="text-xs text-muted-foreground">Only the school owner or principal can change these. Untick an item to switch questions off again.</p>
      <label className="block text-sm">
        Safeguarding contact (a member of staff who will see and follow up worrying messages)
        <select className="mt-1 block w-full rounded border p-2 text-sm" value={contact} onChange={(e) => setContact(e.target.value)} disabled={!canConfigure || pending}>
          <option value="">Not chosen</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={d} onChange={(e) => setD(e.target.checked)} disabled={!canConfigure || pending} className="mt-1" />
        <span>We have completed a data protection impact assessment for children&apos;s questions being processed by an AI service.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={n} onChange={(e) => setN(e.target.checked)} disabled={!canConfigure || pending} className="mt-1" />
        <span>Parents and guardians have been told, in writing, that learners can ask the AI tutor questions and that teachers can see them.</span>
      </label>
      {canConfigure && (
        <button type="button" onClick={save} disabled={pending} className="rounded border px-3 py-1 text-sm font-medium disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </section>
  );
}

export function ReviewButton({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span>
      <button
        type="button"
        disabled={pending}
        className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-50"
        onClick={() => start(async () => {
          const res = await reviewTutorQuestionAction(id);
          if ("error" in res) setMsg(res.error);
          else router.refresh();
        })}
      >
        {pending ? "Saving…" : "Mark as followed up"}
      </button>
      {msg && <span role="alert" className="ml-2 text-xs text-destructive">{msg}</span>}
    </span>
  );
}

// Staff act on a family's request: stop the helper for one learner, switch it back on, or delete the learner's saved questions.
export function TutorQaFamilyRequests({ learners, optedOut, canWrite }: { learners: { id: string; name: string }[]; optedOut: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [student, setStudent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(task: () => Promise<{ ok: true; deleted?: number; kept?: number } | { ok: false; error: string }>, done: (r: { deleted?: number; kept?: number }) => string) {
    setMsg(null);
    start(async () => {
      const res = await task();
      if (!res.ok) setMsg(res.error);
      else {
        setMsg(done(res));
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="text-sm font-semibold">Family requests</h2>
      <p className="text-xs text-muted-foreground">
        A parent or guardian can stop the helper, switch it back on and delete their child&apos;s saved questions themselves in the learning portal. If a family asks the school instead, do it here.
        A worrying message that nobody has followed up yet is kept until someone has.
      </p>
      {!canWrite ? <p className="text-sm text-muted-foreground">You can see this, but only staff who can edit academic records can change it.</p> : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="family-learner">Learner</label>
          <select id="family-learner" className="rounded border p-2 text-sm" value={student} onChange={(e) => setStudent(e.target.value)} disabled={pending}>
            <option value="">Choose a learner</option>
            {learners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button type="button" disabled={!student || pending} className="rounded border px-2 py-1 text-sm disabled:opacity-50" onClick={() => run(() => setQaOptOutAction({ studentId: student, optOut: true }), () => "Questions switched off for this learner.")}>Switch off</button>
          <button type="button" disabled={!student || pending} className="rounded border px-2 py-1 text-sm disabled:opacity-50" onClick={() => run(() => setQaOptOutAction({ studentId: student, optOut: false }), () => "Questions switched back on for this learner.")}>Switch back on</button>
          <button
            type="button"
            disabled={!student || pending}
            className="rounded border px-2 py-1 text-sm disabled:opacity-50"
            onClick={() => {
              if (!window.confirm("Delete all saved questions and answers for this learner? This cannot be undone.")) return;
              run(() => deleteQaQuestionsAction({ studentId: student }), (r) => `Deleted ${r.deleted ?? 0}.${r.kept ? ` ${r.kept} worrying message(s) kept until followed up.` : ""}`);
            }}
          >
            Delete saved questions
          </button>
        </div>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <div>
        <p className="text-xs font-medium">Switched off for {optedOut.length} learner{optedOut.length === 1 ? "" : "s"}</p>
        {optedOut.length > 0 && <p className="text-xs text-muted-foreground">{optedOut.map((o) => o.name).join(", ")}</p>}
      </div>
    </section>
  );
}
