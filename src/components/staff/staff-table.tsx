"use client";

import { useState } from "react";
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
import { setStaffGender } from "@/app/(app)/staff/actions";

export interface StaffRow {
  id: string;
  full_name: string;
  role_name: string;
  department: string | null;
  position: string | null;
  status: string;
  gender: "male" | "female" | null;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function GenderCell({ staffId, gender, canManage }: { staffId: string; gender: "male" | "female" | null; canManage: boolean }) {
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(gender);

  if (!canManage) {
    return value ? <span className="capitalize">{value}</span> : <span className="text-muted-foreground">—</span>;
  }

  async function handleChange(v: "male" | "female") {
    setSaving(true);
    const result = await setStaffGender(staffId, v);
    setSaving(false);
    if (!("error" in result)) setValue(v);
  }

  return (
    <Select value={value ?? undefined} onValueChange={handleChange} disabled={saving}>
      <SelectTrigger className="h-8 w-28">
        <SelectValue placeholder="Set…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="male">Male</SelectItem>
        <SelectItem value="female">Female</SelectItem>
      </SelectContent>
    </Select>
  );
}

const buildColumns = (canManage: boolean): ColumnDef<StaffRow>[] => [
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
    accessorKey: "role_name",
    header: "Role",
  },
  {
    id: "position",
    header: "Position",
    cell: ({ row }) => row.original.position ?? <span className="text-muted-foreground">—</span>,
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ row }) => row.original.department ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "gender",
    header: "Gender",
    cell: ({ row }) => (
      <GenderCell staffId={row.original.id} gender={row.original.gender} canManage={canManage} />
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue<string>("status");
      const tone = status === "active" ? "success" : status === "suspended" ? "danger" : "neutral";
      return <StatusBadge tone={tone} label={status} />;
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/staff/${row.original.id}`}>View</Link>
      </Button>
    ),
    enableSorting: false,
  },
];

export function StaffTable({ rows, canManage }: { rows: StaffRow[]; canManage: boolean }) {
  return (
    <DataTable
      columns={buildColumns(canManage)}
      data={rows}
      searchColumnId="full_name"
      searchPlaceholder="Search staff by name…"
    />
  );
}
