"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  setDemoPartialLeadContacted,
  deleteDemoPartialLead,
} from "@/app/(admin)/admin/demo-requests/actions";

export type IncompleteDemoLeadRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  name: string;
  school_name: string;
  email: string;
  phone: string | null;
  utm_source: string | null;
  utm_medium: string | null;
};

// People who filled in step 1 of the demo form (name, school, email) and pressed Continue but
// never submitted step 2. Rows here are auto-deleted after 60 days.
export function AdminIncompleteDemoLeads({ rows }: { rows: IncompleteDemoLeadRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error: string } | { success: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
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
          <div>
            <h2 className="text-[0.8125rem] font-semibold">Started but didn&apos;t finish</h2>
            <p className="text-[0.6875rem] text-muted-foreground">
              Saved when a visitor pressed Continue on step 1 of the demo form. Removed
              automatically after 60 days.
            </p>
          </div>
          <span className="text-[0.6875rem] text-muted-foreground">
            {rows.length} lead{rows.length === 1 ? "" : "s"}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Started</th>
                <th>Name</th>
                <th>School</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Source</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted-foreground">
                    No unfinished demo requests.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="font-medium">{row.name}</td>
                  <td>{row.school_name}</td>
                  <td>
                    <a href={`mailto:${row.email}`} className="text-primary hover:underline">
                      {row.email}
                    </a>
                  </td>
                  <td>{row.phone ?? "—"}</td>
                  <td>
                    <StatusBadge
                      tone={row.status === "contacted" ? "neutral" : "warning"}
                      label={row.status === "contacted" ? "contacted" : "not finished"}
                    />
                  </td>
                  <td className="text-muted-foreground">
                    {row.utm_source ?? "direct"}
                    {row.utm_medium ? ` / ${row.utm_medium}` : ""}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          run(() => setDemoPartialLeadContacted(row.id, row.status !== "contacted"))
                        }
                      >
                        {row.status === "contacted" ? "Undo contacted" : "Mark contacted"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => run(() => deleteDemoPartialLead(row.id))}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
