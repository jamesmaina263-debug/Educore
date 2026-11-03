import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { FleetLive } from "@/components/transport/fleet-live";
import type { FleetRow } from "@/lib/fleet-live";

const LIVE_TRACKING_FLAG = "feature.transport.live_tracking";

export default async function LiveBusPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has live tracking on. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, LIVE_TRACKING_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canRead }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.read_any" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let body: React.ReactNode = (
    <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">You don&apos;t have access to the live bus view.</div>
  );
  if (canRead) {
    // SECURITY INVOKER function: RLS decides what is returned (own school, transport.read_any).
    const { data } = await supabase.rpc("fleet_live_status");
    body = <FleetLive rows={(data ?? []) as FleetRow[]} />;
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Transport", href: "/transport" }, { label: "Live buses" }]}
      userName={schoolUser?.full_name ?? ""}
      userRole={roleName}
      onSignOut={logout}
    >
      {body}
    </AppShell>
  );
}
