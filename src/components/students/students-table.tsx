"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
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

export function StudentsTable({ rows }: { rows: StudentRow[] }) {
  const [statusFilter, setStatusFilter] = useState("all");

  // All statuses shown by default -- this only narrows the view, it never
  // hides withdrawn/transferred/graduated students from the roster.
  const filteredRows = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
        data={filteredRows}
        searchColumnId="full_name"
        searchPlaceholder="Search students by name…"
      />
    </div>
  );
}
