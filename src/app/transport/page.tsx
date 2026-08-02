import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { TransportSection, type RouteRow, type VehicleRow, type AssignmentRow, type StudentOption } from "@/components/transport/transport-section";

export default async function TransportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "transport.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const [{ data: routeRows }, { data: vehicleRows }, { data: assignmentRows }] = await Promise.all([
    supabase.from("transport_routes").select("*").order("name"),
    supabase.from("transport_vehicles").select("*").order("registration_number"),
    supabase
      .from("student_transport_assignments")
      .select("id, student_id, route_id, vehicle_id, pickup_point, start_date, end_date, status, students(first_name, last_name), transport_routes(name)")
      .order("start_date", { ascending: false }),
  ]);

  let studentOptions: StudentOption[] = [];
  if (canWrite) {
    const { data: students } = await supabase.from("students").select("id, first_name, last_name, admission_number").eq("status", "active").order("first_name");
    studentOptions = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})` }));
  }

  const routes: RouteRow[] = (routeRows ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description, fee_amount: Number(r.fee_amount) }));
  const vehicles: VehicleRow[] = (vehicleRows ?? []).map((v) => ({
    id: v.id,
    registration_number: v.registration_number,
    capacity: v.capacity,
    driver_name: v.driver_name,
    driver_phone: v.driver_phone,
  }));
  const assignments: AssignmentRow[] = (assignmentRows ?? []).map((a) => ({
    id: a.id,
    student_name: (() => {
      const s = a.students as unknown as { first_name: string; last_name: string } | null;
      return s ? `${s.first_name} ${s.last_name}` : "Unknown";
    })(),
    route_name: (a.transport_routes as unknown as { name: string } | null)?.name ?? "Unknown",
    pickup_point: a.pickup_point,
    start_date: a.start_date,
    status: a.status as "active" | "ended",
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Transport" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Transport</h1>
          <p className="text-sm text-muted-foreground">
            {canReadAny ? "Routes, vehicles and student assignments." : "Your child's transport assignment."}
          </p>
        </div>
        <TransportSection routes={routes} vehicles={vehicles} assignments={assignments} studentOptions={studentOptions} canWrite={canWrite === true} />
      </div>
    </AppShell>
  );
}
