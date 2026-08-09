"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";

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

export function StudentsTable({ rows }: { rows: StudentRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumnId="full_name"
      searchPlaceholder="Search students by name…"
    />
  );
}
