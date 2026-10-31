"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveHeadTeacherComment } from "@/app/(app)/exams/report-cards/head-comment-actions";

// One report card's head teacher comment. Editors (report_cards.comment_head) can write or clear it;
// everyone else sees it read-only, and nothing at all when there is none. Self-contained so the
// shared report card list only needs one line to host it.
export function HeadTeacherCommentEditor({
  reportCardId,
  initial,
  canEdit,
  onSaved,
}: {
  reportCardId: string;
  initial: string;
  canEdit: boolean;
  /** Optional: lets a host that loads the card lazily refetch it after a successful save. */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    if (!initial.trim()) return null;
    return (
      <div className="mt-2 rounded-md border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Head teacher&apos;s comment</p>
        <p className="mt-1 text-sm">{initial}</p>
      </div>
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await saveHeadTeacherComment(reportCardId, text);
      if ("error" in result) return setError(result.error);
      router.refresh();
      onSaved?.();
    } catch {
      setError("Couldn't save the comment. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={`hc-${reportCardId}`}>
        Head teacher&apos;s comment
      </label>
      <Textarea id={`hc-${reportCardId}`} rows={2} maxLength={1000} value={text} placeholder="Write the head teacher's comment…" onChange={(e) => setText(e.target.value)} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        <Button size="sm" disabled={pending || text.trim() === initial.trim()} onClick={save}>
          {pending ? "Saving…" : text.trim() ? "Save comment" : "Clear comment"}
        </Button>
      </div>
    </div>
  );
}
