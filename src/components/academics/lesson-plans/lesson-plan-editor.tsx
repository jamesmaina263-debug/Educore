"use client";

import { useState, useTransition } from "react";
import { saveLessonPlanAction } from "@/app/(app)/academics/scheme-of-work/[id]/lesson-plans/actions";
import type { LessonPlanFields, LessonPlanStatus } from "@/lib/lesson-plans";

const TEXT_FIELDS: { key: keyof LessonPlanFields; label: string; rows: number }[] = [
  { key: "objectives", label: "Learning objectives", rows: 3 },
  { key: "introduction", label: "Introduction", rows: 3 },
  { key: "development", label: "Lesson development", rows: 6 },
  { key: "conclusion", label: "Conclusion", rows: 3 },
  { key: "assessment", label: "Assessment", rows: 3 },
  { key: "resources", label: "Resources", rows: 2 },
  { key: "homework", label: "Homework", rows: 2 },
  { key: "reflection", label: "Reflection after teaching", rows: 3 },
];

export function LessonPlanEditor({ planId, schemeId, initial, canEdit }: { planId: string; schemeId: string; initial: LessonPlanFields; canEdit: boolean }) {
  const [plan, setPlan] = useState<LessonPlanFields>(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function save() {
    setMessage(null);
    start(async () => {
      const r = await saveLessonPlanAction(planId, schemeId, plan);
      setMessage("error" in r ? { kind: "error", text: r.error } : { kind: "ok", text: "Saved." });
    });
  }

  return (
    <div className="space-y-4">
      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="font-medium">{f.label}</span>
          <textarea
            className="mt-1 w-full rounded border bg-background px-2 py-1"
            rows={f.rows}
            maxLength={4000}
            disabled={!canEdit}
            value={plan[f.key] as string}
            onChange={(e) => setPlan({ ...plan, [f.key]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label>
          <span className="block font-medium">Duration (minutes)</span>
          <input
            type="number"
            min={5}
            max={240}
            className="mt-1 w-24 rounded border bg-background px-2 py-1"
            disabled={!canEdit}
            value={plan.durationMinutes ?? ""}
            onChange={(e) => setPlan({ ...plan, durationMinutes: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>
        <label>
          <span className="block font-medium">Status</span>
          <select
            className="mt-1 rounded border bg-background px-2 py-1"
            disabled={!canEdit}
            value={plan.status}
            onChange={(e) => setPlan({ ...plan, status: e.target.value as LessonPlanStatus })}
          >
            <option value="draft">Draft</option>
            <option value="ready">Ready</option>
            <option value="taught">Taught</option>
          </select>
        </label>
        {plan.status === "taught" && (
          <label>
            <span className="block font-medium">Taught on</span>
            <input
              type="date"
              className="mt-1 rounded border bg-background px-2 py-1"
              disabled={!canEdit}
              value={plan.taughtOn ?? ""}
              onChange={(e) => setPlan({ ...plan, taughtOn: e.target.value || null })}
            />
          </label>
        )}
        {canEdit && (
          <button type="button" className="rounded bg-primary px-4 py-1.5 text-primary-foreground disabled:opacity-50" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save plan"}
          </button>
        )}
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
