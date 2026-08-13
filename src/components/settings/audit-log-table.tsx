"use client";

import { useMemo, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export interface AuditLogRow {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

const ACTION_TONE: Record<string, string> = {
  create: "text-success",
  update: "text-info",
  delete: "text-danger",
  approve: "text-success",
  reject: "text-danger",
  reverse: "text-danger",
  revoke: "text-danger",
  complete_enrollment: "text-success",
};

export function AuditLogTable({ rows }: { rows: AuditLogRow[] }) {
  const [tableFilter, setTableFilter] = useState("all");
  const tables = useMemo(() => Array.from(new Set(rows.map((r) => r.table_name))).sort(), [rows]);
  const filtered = tableFilter === "all" ? rows : rows.filter((r) => r.table_name === tableFilter);

  return (
    <div className="panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-sm font-medium">Audit log</p>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length} recent events
          </p>
          <Select value={tableFilter} onValueChange={setTableFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tables</SelectItem>
              {tables.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No audited changes match this filter yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead>
              <tr>
                <th className="text-left">When</th>
                <th className="text-left">Who</th>
                <th className="text-left">Action</th>
                <th className="text-left">Table</th>
                <th className="text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.actor_name ?? "System"}</td>
                  <td className={ACTION_TONE[r.action] ?? ""}>{r.action}</td>
                  <td>{r.table_name}</td>
                  <td className="text-muted-foreground">{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Covers student records, fees/invoices, payments, boarding allocations, medical records,
        discipline records/cases, staff accounts, role permissions, and the full admission
        lifecycle (application status changes through enrollment) — every write to any of those
        tables, however it was made, not only actions taken through a specific button.
      </p>
    </div>
  );
}
