import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";
import { hasFeatureFlag } from "@/lib/feature-flags";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { DriverCodesSection } from "@/components/transport/driver-codes-section";

const LIVE_TRACKING_FLAG = "feature.transport.live_tracking";

export default async function DriverCodesPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) redirect("/login");

  // Hidden entirely unless the school has live tracking on. hasFeatureFlag fails closed.
  if (!(await hasFeatureFlag(supabase, LIVE_TRACKING_FLAG))) notFound();

  const [{ data: schoolUser }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.write" }),
  ]);
  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  let body: React.ReactNode = (
    <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">You don&apos;t have access to driver codes.</div>
  );
  if (canWrite) {
    const [{ data: vehicleRows }, { data: deviceRows }] = await Promise.all([
      supabase.from("transport_vehicles").select("id, registration_number").order("registration_number"),
      supabase.from("vehicle_tracker_devices").select("id, vehicle_id, label, active, last_seen_at, created_at").order("created_at", { ascending: false }),
    ]);
    body = (
      <DriverCodesSection
        vehicles={(vehicleRows ?? []).map((v) => ({ id: v.id as string, registration: v.registration_number as string }))}
        devices={(deviceRows ?? []).map((d) => ({
          id: d.id as string,
          vehicleId: d.vehicle_id as string,
          label: d.label as string,
          active: d.active as boolean,
          lastSeenAt: (d.last_seen_at as string | null) ?? null,
          createdAt: d.created_at as string,
        }))}
      />
    );
  }

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Transport", href: "/transport" }, { label: "Driver codes" }]}
      userName={schoolUser?.full_name ?? ""}
      userRole={roleName}
      onSignOut={logout}
    >
      {body}
    </AppShell>
  );
}
