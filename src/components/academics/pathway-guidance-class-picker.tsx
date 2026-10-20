"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";

export function PathwayGuidanceClassPicker({
  classOptions,
  selectedClassId,
  basePath = "/academics/pathway-guidance",
}: {
  classOptions: { id: string; name: string }[];
  selectedClassId: string | null;
  /** The page the picker navigates within; reused by other class-based academics pages. */
  basePath?: string;
}) {
  const router = useRouter();
  const toHref = useSchoolHref();

  return (
    <Select value={selectedClassId ?? undefined} onValueChange={(v) => router.push(toHref(`${basePath}?class=${v}`))}>
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
