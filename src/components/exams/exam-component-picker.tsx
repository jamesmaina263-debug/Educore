"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { setExamComponent } from "@/app/(app)/exams/actions";

export function ExamComponentPicker({
  examId,
  currentComponentId,
  options,
  canWrite,
}: {
  examId: string;
  currentComponentId: string | null;
  options: { id: string; label: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();

  async function handleChange(value: string) {
    await setExamComponent(examId, value === "__none__" ? null : value);
    router.refresh();
  }

  if (!canWrite && !currentComponentId) return null;

  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground">Counts toward</Label>
      {canWrite ? (
        <Select value={currentComponentId ?? "__none__"} onValueChange={handleChange}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Not part of a weighted scheme" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not part of a weighted scheme</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm text-muted-foreground">{options.find((o) => o.id === currentComponentId)?.label ?? "—"}</span>
      )}
    </div>
  );
}
