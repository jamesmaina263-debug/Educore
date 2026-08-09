"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { submitHomeworkAction } from "@/app/portal/actions";

export interface PortalAssignmentRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  subject_name: string;
  submission: { submission_text: string; status: "submitted" | "graded"; grade: string | null; feedback: string | null } | null;
}

export function PortalHomeworkSection({ studentId, assignments }: { studentId: string; assignments: PortalAssignmentRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(assignmentId: string) {
    const text = drafts[assignmentId] ?? "";
    setSaving(assignmentId);
    setError(null);
    const res = await submitHomeworkAction(assignmentId, studentId, text);
    setSaving(null);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  if (assignments.length === 0) {
    return <p className="text-sm text-muted-foreground">No homework assigned yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      {assignments.map((a) => (
        <div key={a.id} className="rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {a.title} <span className="text-xs text-muted-foreground">({a.subject_name})</span>
            </p>
            <span className="text-xs text-muted-foreground">Due {a.due_date}</span>
          </div>
          {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}

          {a.submission ? (
            <div className="mt-2">
              <StatusBadge
                tone={a.submission.status === "graded" ? "success" : "neutral"}
                label={a.submission.status === "graded" ? `Graded${a.submission.grade ? `: ${a.submission.grade}` : ""}` : "Submitted"}
              />
              <p className="mt-1 text-sm">{a.submission.submission_text}</p>
              {a.submission.feedback && (
                <p className="mt-1 text-xs text-muted-foreground">Feedback: {a.submission.feedback}</p>
              )}
              {a.submission.status === "submitted" && (
                <p className="mt-1 text-xs text-muted-foreground">You can still edit this before it&apos;s graded.</p>
              )}
            </div>
          ) : null}

          {(!a.submission || a.submission.status === "submitted") && (
            <div className="mt-2 flex flex-col gap-2">
              <Textarea
                placeholder="Write your answer…"
                defaultValue={a.submission?.submission_text ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
              />
              <Button size="sm" onClick={() => submit(a.id)} disabled={saving === a.id}>
                {saving === a.id ? "Submitting…" : a.submission ? "Update submission" : "Submit"}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
