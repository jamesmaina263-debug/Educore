import { createClient } from "@/lib/supabase/server";
import { AuditLogTable, type AuditLogRow } from "@/components/settings/audit-log-table";

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

  return <AuditLogTable rows={rows} />;
}
