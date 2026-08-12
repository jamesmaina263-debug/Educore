"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function CampusFilterSelect({
  campusParam,
  campusOptions,
}: {
  campusParam?: string;
  campusOptions: { id: string; name: string }[];
}) {
  const router = useRouter();

  return (
    <Select
      value={campusParam || "all"}
      onValueChange={(v) => router.push(v === "all" ? "/reports" : `/reports?campus=${v}`)}
    >
      <SelectTrigger className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All campuses</SelectItem>
        {campusOptions.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
