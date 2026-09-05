"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateDemoRequestStatus } from "@/app/(admin)/admin/demo-requests/actions";

export type DemoRequestRow = {
  id: string;
  created_at: string;
  name: string;
  school_name: string;
  role: string;
  email: string;
  phone: string | null;
  student_count: number | null;
  message: string | null;
  status: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  new: "warning",
  contacted: "neutral",
  closed: "success",
};

const STATUS_OPTIONS = ["new", "contacted", "closed"] as const;

function toneFor(status: string) {
  return STATUS_TONE[status] ?? "neutral";
}

export function AdminDemoRequestsTable({ rows }: { rows: DemoRequestRow[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleStatusChange(id: string, status: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateDemoRequestStatus(id, status);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">Submissions</h2>
        <span className="text-[0.6875rem] text-muted-foreground">
          {rows.length} request{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="table-dense w-full">
          <thead className="bg-muted/70">
            <tr>
              <th>Submitted</th>
              <th>Name</th>
              <th>School</th>
              <th>Role</th>
              <th>Status</th>
              <th>Source</th>
              <th className="text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground">
                  No demo requests yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <>
                <tr key={row.id}>
                  <td className="text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="font-medium">{row.name}</td>
                  <td>{row.school_name}</td>
                  <td>{row.role}</td>
                  <td>
                    <Select
                      value={row.status}
                      disabled={pending}
                      onValueChange={(value) => handleStatusChange(row.id, value)}
                    >
                      <SelectTrigger className="h-7 w-[8.5rem] text-[0.75rem]">
                        <SelectValue>
                          <StatusBadge tone={toneFor(row.status)} label={row.status} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="text-muted-foreground">
                    {row.utm_source ?? "direct"}
                    {row.utm_medium ? ` / ${row.utm_medium}` : ""}
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {expanded === row.id ? "Close" : "View"}
                    </Button>
                  </td>
                </tr>
                {expanded === row.id && (
                  <tr key={`${row.id}-expanded`}>
                    <td colSpan={7} className="bg-muted/30">
                      <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
                        <p>
                          <span className="text-muted-foreground">Email:</span> {row.email}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Phone:</span> {row.phone ?? "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Student count:</span>{" "}
                          {row.student_count ?? "—"}
                        </p>
                        <p>
                          <span className="text-muted-foreground">Campaign:</span>{" "}
                          {row.utm_campaign ?? "—"}
                        </p>
                        <p className="sm:col-span-2">
                          <span className="text-muted-foreground">Message:</span>{" "}
                          {row.message ?? "—"}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
