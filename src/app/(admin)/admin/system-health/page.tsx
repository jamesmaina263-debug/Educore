import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";

// Reads platform_alerts, the durable half of sendSecurityAlert() -- the same events that get
// pushed to Slack (when SECURITY_ALERT_WEBHOOK_URL is configured) also land here, so this page
// stays useful even if a Slack message got missed or the channel wasn't set up at the time.
// See src/lib/security-alert.ts and supabase/functions/_shared/securityAlert.ts.
export default async function AdminSystemHealthPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: alerts } = await supabase
    .from("platform_alerts")
    .select("id, event, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = alerts ?? [];
  const last24h = rows.filter((r) => new Date().getTime() - new Date(r.created_at).getTime() < 24 * 3_600_000);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">System health</h1>
        <p className="text-sm text-muted-foreground">
          M-Pesa webhook failures, deploy/cron job failures, and other security-relevant events across the platform
          -- the same events posted to Slack, kept here so nothing gets missed.
        </p>
      </div>

      <div className="panel p-4">
        <p className="text-xs text-muted-foreground">Last 24 hours</p>
        <p className="mt-1 text-2xl font-semibold">{last24h.length}</p>
      </div>

      <div className="panel">
        <header className="border-b border-border px-4 py-2.5">
          <h2 className="text-[0.8125rem] font-semibold">Recent alerts</h2>
        </header>
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Event</th>
                <th>Detail</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-4 text-sm text-muted-foreground">
                    No alerts recorded yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const detailText = Object.entries((r.detail as Record<string, string>) ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{r.event}</td>
                      <td className="max-w-96 truncate text-muted-foreground" title={detailText}>
                        {detailText || "—"}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {last24h.length > 0 && (
        <div className="flex items-center gap-2">
          <StatusBadge tone="warning" label={`${last24h.length} in the last 24h`} />
        </div>
      )}
    </div>
  );
}
