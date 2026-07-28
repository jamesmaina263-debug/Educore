"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

export interface StaffRow {
  id: string;
  full_name: string;
  role: string;
  status: string;
  email: string | null;
}

const columns: ColumnDef<StaffRow>[] = [
  { accessorKey: "full_name", header: "Name" },
  { accessorKey: "role", header: "Role" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue<string>("status");
      return (
        <Badge
          dot
          variant={status === "active" ? "success" : status === "suspended" ? "danger" : "secondary"}
        >
          {status}
        </Badge>
      );
    },
  },
  { accessorKey: "email", header: "Email" },
];

export function StaffDirectoryTable({ rows }: { rows: StaffRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchColumnId="full_name"
      searchPlaceholder="Search staff by name…"
    />
  );
}
