import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import {
  TransportSection,
  type RouteRow,
  type VehicleRow,
  type StopRow,
  type AssignmentRow,
  type StudentOption,
} from "@/components/transport/transport-section";

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

  const [{ data: routeRows }, { data: vehicleRows }, { data: stopRows }, { data: assignmentRows }, { data: routeCapacity }, { data: stopCapacity }] =
    await Promise.all([
      supabase.from("transport_routes").select("*").order("name"),
      supabase.from("transport_vehicles").select("*").order("registration_number"),
      supabase.from("transport_stops").select("*").order("sequence"),
      supabase
        .from("student_transport_assignments")
        .select(
          "id, student_id, route_id, vehicle_id, stop_id, pickup_point, start_date, end_date, status, students(first_name, last_name), transport_routes(name), transport_vehicles(registration_number), transport_stops(name)",
        )
        .order("start_date", { ascending: false }),
      supabase.from("v_transport_route_capacity").select("*"),
      supabase.from("v_transport_stop_capacity").select("*"),
    ]);

  let studentOptions: StudentOption[] = [];
  if (canWrite) {
    const { data: students } = await supabase.from("students").select("id, first_name, last_name, admission_number").eq("status", "active").order("first_name");
    studentOptions = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})` }));
  }

  const capacityByRoute = new Map((routeCapacity ?? []).map((c) => [c.route_id, c]));
  const capacityByStop = new Map((stopCapacity ?? []).map((c) => [c.stop_id, c]));

  const routes: RouteRow[] = (routeRows ?? []).map((r) => {
    const cap = capacityByRoute.get(r.id);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      fee_amount: Number(r.fee_amount),
      capacity: cap?.capacity ?? 0,
      allocated: cap?.allocated ?? 0,
      available: cap?.available ?? 0,
    };
  });

  const vehicles: VehicleRow[] = (vehicleRows ?? []).map((v) => ({
    id: v.id,
    registration_number: v.registration_number,
    capacity: v.capacity,
    route_id: v.route_id,
    driver_name: v.driver_name,
    driver_phone: v.driver_phone,
    conductor_name: v.conductor_name,
    conductor_phone: v.conductor_phone,
    driver_license_number: v.driver_license_number,
    driver_license_expiry: v.driver_license_expiry,
    insurance_expiry: v.insurance_expiry,
    inspection_expiry: v.inspection_expiry,
    status: v.status as "active" | "maintenance" | "inactive",
  }));

  const stops: StopRow[] = (stopRows ?? []).map((s) => {
    const cap = capacityByStop.get(s.id);
    return {
      id: s.id,
      route_id: s.route_id,
      name: s.name,
      sequence: s.sequence,
      pickup_time: s.pickup_time,
      capacity: s.capacity,
      allocated: cap?.allocated ?? 0,
      available: cap?.available ?? null,
    };
  });

  const assignments: AssignmentRow[] = (assignmentRows ?? []).map((a) => ({
    id: a.id,
    student_name: (() => {
      const s = a.students as unknown as { first_name: string; last_name: string } | null;
      return s ? `${s.first_name} ${s.last_name}` : "Unknown";
    })(),
    route_name: (a.transport_routes as unknown as { name: string } | null)?.name ?? "Unknown",
    vehicle_reg: (a.transport_vehicles as unknown as { registration_number: string } | null)?.registration_number ?? null,
    stop_name: (a.transport_stops as unknown as { name: string } | null)?.name ?? null,
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
            {canReadAny ? "Vehicles, drivers, routes, stops and student allocation." : "Your child's transport assignment."}
          </p>
        </div>
        <TransportSection routes={routes} vehicles={vehicles} stops={stops} assignments={assignments} studentOptions={studentOptions} canWrite={canWrite === true} />
      </div>
    </AppShell>
  );
}
