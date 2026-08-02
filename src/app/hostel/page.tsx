import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { HostelSection, type RoomRow, type AllocationRow, type StudentOption } from "@/components/hostel/hostel-section";

export default async function HostelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canReadAny }, { data: canWrite }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "hostel.read_any" }),
    supabase.rpc("auth_has_permission", { p_permission_key: "hostel.write" }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const [{ data: roomRows }, { data: allocationRows }] = await Promise.all([
    supabase.from("hostel_rooms").select("*").order("room_number"),
    supabase
      .from("hostel_allocations")
      .select("id, student_id, hostel_room_id, start_date, end_date, status, students(first_name, last_name), hostel_rooms(room_number, block)")
      .order("start_date", { ascending: false }),
  ]);

  let studentOptions: StudentOption[] = [];
  if (canWrite) {
    const { data: students } = await supabase.from("students").select("id, first_name, last_name, admission_number").eq("status", "active").order("first_name");
    studentOptions = (students ?? []).map((s) => ({ id: s.id, name: `${s.first_name} ${s.last_name} (${s.admission_number})` }));
  }

  const occupancy = new Map<string, number>();
  for (const a of allocationRows ?? []) {
    if (a.status === "active") occupancy.set(a.hostel_room_id, (occupancy.get(a.hostel_room_id) ?? 0) + 1);
  }

  const rooms: RoomRow[] = (roomRows ?? []).map((r) => ({
    id: r.id,
    room_number: r.room_number,
    block: r.block,
    capacity: r.capacity,
    gender: r.gender as "male" | "female" | "mixed",
    occupied: occupancy.get(r.id) ?? 0,
  }));

  const allocations: AllocationRow[] = (allocationRows ?? []).map((a) => ({
    id: a.id,
    student_name: (() => {
      const s = a.students as unknown as { first_name: string; last_name: string } | null;
      return s ? `${s.first_name} ${s.last_name}` : "Unknown";
    })(),
    room_label: (() => {
      const r = a.hostel_rooms as unknown as { room_number: string; block: string | null } | null;
      return r ? `${r.block ? r.block + " " : ""}${r.room_number}` : "Unknown";
    })(),
    start_date: a.start_date,
    status: a.status as "active" | "ended",
  }));

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Hostel" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Hostel</h1>
          <p className="text-sm text-muted-foreground">
            {canReadAny ? "Rooms and boarder allocations." : "Your child's boarding allocation."}
          </p>
        </div>
        <HostelSection rooms={rooms} allocations={allocations} studentOptions={studentOptions} canWrite={canWrite === true} />
      </div>
    </AppShell>
  );
}
