"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function PathwayGuidanceClassPicker({
  classOptions,
  selectedClassId,
}: {
  classOptions: { id: string; name: string }[];
  selectedClassId: string | null;
}) {
  const router = useRouter();

  return (
    <Select value={selectedClassId ?? undefined} onValueChange={(v) => router.push(`/academics/pathway-guidance?class=${v}`)}>
      <SelectTrigger className="w-52">
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
  );
}
