"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function MarksPicker({
  examOptions,
  examId,
  classOptions,
  subjectOptions,
  selectedClassId,
  selectedSubjectId,
}: {
  examOptions: { id: string; name: string }[];
  examId: string;
  classOptions: { id: string; name: string }[];
  subjectOptions: { id: string; name: string }[];
  selectedClassId: string | null;
  selectedSubjectId: string | null;
}) {
  const router = useRouter();

  function go(examIdParam: string | null, classId: string | null, subjectId: string | null) {
    const params = new URLSearchParams();
    if (examIdParam) params.set("exam", examIdParam);
    if (classId) params.set("class", classId);
    if (subjectId) params.set("subject", subjectId);
    router.push(`/exams/marks?${params.toString()}`);
  }

  return (
    <div className="flex gap-2">
      <Select value={examId} onValueChange={(v) => go(v, null, null)}>
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Select exam" />
        </SelectTrigger>
        <SelectContent>
          {examOptions.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedClassId ?? undefined} onValueChange={(v) => go(examId, v, null)}>
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

      <Select
        value={selectedSubjectId ?? undefined}
        onValueChange={(v) => go(examId, selectedClassId, v)}
        disabled={!selectedClassId}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Select subject" />
        </SelectTrigger>
        <SelectContent>
          {subjectOptions.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
