import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { FleetLiveSection } from "@/components/transport/fleet-live-section";
import { LIVE_TRACKING_FLAG, parseFleetRows } from "@/lib/bus-live";

// WP 5.3: where school staff see every vehicle's latest position. Hidden entirely (404) unless the school has
// live tracking on, and only for staff with transport.read_any. fleet_live_status() enforces the same rules in
// the database, so this page cannot show more than the caller is allowed to read.
export default async function FleetLivePage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  if (!(await hasFeatureFlag(supabase, LIVE_TRACKING_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canReadAny }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.read_any" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let body: React.ReactNode = (
    <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">You don&apos;t have access to live vehicle positions.</div>
  );
  if (canReadAny === true) {
    const { data } = await supabase.rpc("fleet_live_status");
    body = <FleetLiveSection initialVehicles={parseFleetRows(data)} initialFetchedAt={new Date().toISOString()} />;
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Transport", href: "/transport" }, { label: "Live view" }]}
      userName={schoolUser?.full_name ?? ""}
      userRole={roleName}
      onSignOut={logout}
    >
      {body}
    </AppShell>
  );
}
