import { createClient } from "@/lib/supabase/server";

interface AuditLogRow {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

const ACTION_TONE: Record<string, string> = {
  insert: "text-success",
  update: "text-info",
  delete: "text-danger",
};

export async function AuditLogPanel() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("id, table_name, record_id, action, reason, created_at, school_users(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows: AuditLogRow[] = (data ?? []).map((r) => ({
    id: r.id,
    table_name: r.table_name,
    record_id: r.record_id,
    action: r.action,
    reason: r.reason,
    created_at: r.created_at,
    actor_name: (r.school_users as unknown as { full_name: string } | null)?.full_name ?? null,
  }));

  return (
    <div className="panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-sm font-medium">Audit log</p>
        <p className="text-xs text-muted-foreground">Most recent {rows.length} events</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No audited changes have been recorded yet.</p>
      ) : (
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
            {rows.map((r) => (
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
      )}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        Covers the tables that already write audit entries (attendance edits, finance
        reversals/discounts/waivers/expense approvals, and enrollment completion). Not every
        table in the system writes to this log yet — see Phase 17&apos;s remit for extending
        coverage system-wide.
      </p>
    </div>
  );
}
