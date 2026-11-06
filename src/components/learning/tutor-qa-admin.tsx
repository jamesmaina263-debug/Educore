"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureTutorQaAction, reviewTutorQuestionAction } from "@/app/(app)/academics/learning/tutor/questions/actions";

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
