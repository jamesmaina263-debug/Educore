import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminBroadcastForm } from "@/components/admin/admin-broadcast-form";
import { AdminMaintenanceToggle } from "@/components/admin/admin-maintenance-toggle";
import type { BroadcastHistoryRow } from "@/app/(admin)/admin/broadcast/actions";
import { getMaintenanceStatus } from "@/app/(admin)/admin/broadcast/maintenance-actions";

export default async function AdminBroadcastPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: history } = await supabase.rpc("get_platform_announcement_history");
  const maintenanceStatus = await getMaintenanceStatus();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Broadcast announcements</h1>
        <p className="text-sm text-muted-foreground">
          Sends an in-app notification-bell entry to every active staff account, across every school -- for product
          updates, planned downtime, or policy changes. Distinct from any school&apos;s own guardian-facing
          announcements.
        </p>
      </div>

      <AdminMaintenanceToggle status={maintenanceStatus} />

      <AdminBroadcastForm history={(history as BroadcastHistoryRow[]) ?? []} />
    </div>
  );
}
