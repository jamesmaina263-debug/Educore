"use client";

import { StatusBadge } from "@/components/status-badge";

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

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  new: "info",
  contacted: "warning",
  demo_scheduled: "warning",
  converted: "success",
  lost: "danger",
};

function toneFor(status: string) {
  return STATUS_TONE[status] ?? "neutral";
}

// Read-only by design -- this table has no actions, no mutation, no
// server-action wiring. The only way to change a submission's status today
// is Supabase Studio, same as before this page existed; this page is
// purely a view onto the new super-admin SELECT policy.
export function AdminDemoRequestsTable({ rows }: { rows: DemoRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No demo requests submitted yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Submitted</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">School</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Contact</th>
            <th className="px-3 py-2 font-medium">Students</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="align-top">
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {new Date(row.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              <td className="px-3 py-2">{row.school_name}</td>
              <td className="px-3 py-2">{row.role}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <a href={`mailto:${row.email}`} className="text-primary hover:underline">
                    {row.email}
                  </a>
                  {row.phone && <span className="text-muted-foreground">{row.phone}</span>}
                </div>
              </td>
              <td className="px-3 py-2">{row.student_count ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.utm_source ? (
                  <div className="flex flex-col">
                    <span>{row.utm_source}</span>
                    {row.utm_medium && (
                      <span className="text-xs">
                        {row.utm_medium}
                        {row.utm_campaign ? ` · ${row.utm_campaign}` : ""}
                      </span>
                    )}
                  </div>
                ) : (
                  "Direct"
                )}
              </td>
              <td className="px-3 py-2">
                <StatusBadge tone={toneFor(row.status)} label={row.status.replace(/_/g, " ")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
