"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function ReportCardPicker({
  examOptions,
  classOptions,
  selectedExamId,
  selectedClassId,
}: {
  examOptions: { id: string; name: string }[];
  classOptions: { id: string; name: string }[];
  selectedExamId: string | null;
  selectedClassId: string | null;
}) {
  const router = useRouter();

  function go(examId: string | null, classId: string | null) {
    const params = new URLSearchParams();
    if (examId) params.set("exam", examId);
    if (classId) params.set("class", classId);
    router.push(`/exams/report-cards?${params.toString()}`);
  }

  return (
    <div className="flex gap-2">
      <Select value={selectedExamId ?? undefined} onValueChange={(v) => go(v, null)}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select a closed exam" />
        </SelectTrigger>
        <SelectContent>
          {examOptions.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedClassId ?? undefined} onValueChange={(v) => go(selectedExamId, v)} disabled={!selectedExamId}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Select class" />
        </SelectTrigger>
        <SelectContent>
          {classOptions.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
