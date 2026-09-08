import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Covers the console's highest-stakes mutations (per the original ask: "plan changes,
// suspensions, impersonation"): school lifecycle (suspend/reactivate), billing (activate/
// suspend subscription, generate invoice, record payment, send reminder), broadcasts, and
// whitelabel/domain changes. Lower-stakes admin actions (demo-data reset, demo-request status
// triage) aren't wired up to this log -- neither touches real school data or money, and this
// stayed scoped to what the original ask actually named as important.
export default async function AdminActivityLogPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: entries } = await supabase
    .from("platform_admin_activity_log")
    .select("id, actor_email, action, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = entries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          What was done via the admin console, by whom, and when -- matters more once there&apos;s more than one
          platform admin.
        </p>
      </div>

      <div className="panel">
        <div className="overflow-x-auto">
          <table className="table-dense w-full">
            <thead className="bg-muted/70">
              <tr>
                <th>Action</th>
                <th>Detail</th>
                <th>By</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-sm text-muted-foreground">
                    Nothing logged yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const detailText = Object.entries((r.detail as Record<string, unknown>) ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{r.action}</td>
                      <td className="max-w-96 truncate text-muted-foreground" title={detailText}>
                        {detailText || "—"}
                      </td>
                      <td className="text-muted-foreground">{r.actor_email ?? "—"}</td>
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
    </div>
  );
}
