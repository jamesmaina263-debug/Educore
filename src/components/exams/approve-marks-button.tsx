"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveMarks } from "@/app/exams/actions";

export function ApproveMarksButton({ examId, classId, subjectId }: { examId: string; classId: string; subjectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleApprove() {
    setPending(true);
    await approveMarks({ exam_id: examId, class_id: classId, subject_id: subjectId });
    setPending(false);
    router.refresh();
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={handleApprove}>
      {pending ? "Approving…" : "Approve"}
    </Button>
  );
}
