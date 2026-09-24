"use client";

import { useRouter } from "next/navigation";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { FilterOption } from "@/app/(app)/academics/scheme-of-work/_types";

interface Props {
  yearOptions: FilterOption[];
  termOptions: FilterOption[];
  classOptions: FilterOption[];
  subjectOptions: FilterOption[];
  teacherOptions: FilterOption[];
  statusOptions: FilterOption[];
  filters: { year?: string; term?: string; class?: string; subject?: string; teacher?: string; status?: string };
  showTeacherFilter: boolean;
}

const ALL = "__all__";

export function SchemeOfWorkFilters({
  yearOptions,
  termOptions,
  classOptions,
  subjectOptions,
  teacherOptions,
  statusOptions,
  filters,
  showTeacherFilter,
}: Props) {
  const router = useRouter();

  function go(next: Partial<typeof filters>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    router.push(`/academics/scheme-of-work${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const pickers: { key: keyof typeof filters; label: string; options: FilterOption[] }[] = [
    { key: "year", label: "Academic Year", options: yearOptions },
    { key: "term", label: "Term", options: termOptions },
    { key: "class", label: "Class", options: classOptions },
    { key: "subject", label: "Subject", options: subjectOptions },
    ...(showTeacherFilter ? [{ key: "teacher" as const, label: "Teacher", options: teacherOptions }] : []),
    { key: "status", label: "Status", options: statusOptions },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pickers.map((p) => (
        <Select key={p.key} value={filters[p.key] ?? ALL} onValueChange={(v) => go({ [p.key]: v === ALL ? undefined : v })}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={p.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {p.label}</SelectItem>
            {p.options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
}
