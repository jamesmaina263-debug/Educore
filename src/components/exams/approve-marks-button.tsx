"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveMarks } from "@/app/(app)/exams/actions";

export function ApproveMarksButton({ examId, classId, subjectId }: { examId: string; classId: string; subjectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setPending(true);
    setError(null);
    const result = await approveMarks({ exam_id: examId, class_id: classId, subject_id: subjectId });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={handleApprove}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
