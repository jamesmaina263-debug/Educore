"use client";

import { Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { useServerTableParams } from "@/hooks/use-server-table-params";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export interface StudentRow {
  id: string;
  admission_number: string;
  full_name: string;
  status: string;
  class_label: string | null;
  guardian_name: string | null;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const columns: ColumnDef<StudentRow>[] = [
  {
    accessorKey: "full_name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <Avatar className="size-7">
          <AvatarFallback className="text-xs">{initials(row.original.full_name)}</AvatarFallback>
        </Avatar>
        <span className="font-medium">{row.original.full_name}</span>
      </div>
    ),
  },
  {
    accessorKey: "admission_number",
    header: "Admission #",
    cell: ({ row }) => (
      <span className="font-mono text-[0.8125rem] text-muted-foreground">
        {row.original.admission_number}
      </span>
    ),
  },
  {
    id: "class",
    header: "Class / Stream",
    cell: ({ row }) => row.original.class_label ?? <span className="text-muted-foreground">Unassigned</span>,
  },
  {
    accessorKey: "guardian_name",
    header: "Primary Guardian",
    cell: ({ row }) => row.original.guardian_name ?? "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue<string>("status");
      const tone =
        status === "active" || status === "enrolled"
          ? "success"
          : status === "withdrawn" || status === "transferred"
            ? "danger"
            : "neutral";
      return <StatusBadge tone={tone} label={status} />;
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/students/${row.original.id}`}>View</Link>
      </Button>
    ),
    enableSorting: false,
  },
];

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "enrolled", label: "Enrolled" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "transferred", label: "Transferred" },
  { value: "graduated", label: "Graduated" },
];

/**
 * `rows` is one page's worth (the server component already ran `.range()` +
 * the status/search filters via SQL) -- not the school's full roster. See
 * `students/page.tsx`. Previously this fetched every student in the school
 * unconditionally and paginated/filtered entirely in the browser, which is
 * fine at pilot scale but doesn't hold up once a school has thousands of
 * students (2026-09-03 production readiness audit, finding A2).
 */
function StudentsTableInner({ rows, totalCount, pageSize }: { rows: StudentRow[]; totalCount: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const manual = useServerTableParams({ totalCount, pageSize });

  const statusFilter = searchParams.get("status") ?? "all";

  function handleStatusChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("status");
    else params.set("status", value);
    // Changing the filter invalidates whatever page you were on.
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status</span>
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="h-8 w-44 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        searchColumnId="full_name"
        searchPlaceholder="Search students by name…"
        pageSize={pageSize}
        manual={manual}
      />
    </div>
  );
}

export function StudentsTable(props: { rows: StudentRow[]; totalCount: number; pageSize: number }) {
  // useSearchParams requires a Suspense boundary around whatever reads it --
  // same pattern already used by src/app/login/page.tsx.
  return (
    <Suspense fallback={null}>
      <StudentsTableInner {...props} />
    </Suspense>
  );
}
