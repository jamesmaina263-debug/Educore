"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/status-badge";
import { DataTable } from "@/components/ui/data-table";

export interface ParentRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  children: string[];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const columns: ColumnDef<ParentRow>[] = [
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
    id: "children",
    header: "Children",
    cell: ({ row }) =>
      row.original.children.length > 0 ? (
        row.original.children.join(", ")
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => row.original.email ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "phone",
    header: "Phone",
    cell: ({ row }) => row.original.phone ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status;
      const tone = status === "active" ? "success" : status === "suspended" ? "danger" : "neutral";
      return <StatusBadge tone={tone} label={status} />;
    },
  },
];

export function ParentsTable({ rows }: { rows: ParentRow[] }) {
  return (
    <DataTable columns={columns} data={rows} searchColumnId="full_name" searchPlaceholder="Search parents by name…" />
  );
}
