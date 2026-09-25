"use client";

import { useRouter } from "next/navigation";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export function StreamPicker({
  options,
  value,
  date,
}: {
  options: { id: string; label: string }[];
  value: string;
  date: string;
}) {
  const router = useRouter();
  const toHref = useSchoolHref();

  return (
    <Select value={value} onValueChange={(v) => router.push(toHref(`/attendance?stream=${v}&date=${date}`))}>
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
