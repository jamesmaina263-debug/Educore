import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { PtMeetingsSection, type SlotRow } from "@/components/pt-meetings/pt-meetings-section";

export default async function PtMeetingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canWriteAny }, { data: slotRows }] = await Promise.all([
    supabase.from("school_users").select("id, full_name, roles(display_name), schools(name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "academics.write" }),
    supabase
      .from("pt_meeting_slots")
      .select("id, teacher_id, slot_date, start_time, end_time, location, capacity, school_users(full_name), pt_meeting_bookings(id, status, students(first_name, last_name))")
      .order("slot_date", { ascending: true })
      .order("start_time", { ascending: true }),
  ]);

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  const slots: SlotRow[] = (slotRows ?? []).map((s) => {
    const teacher = s.school_users as unknown as { full_name: string } | null;
    const bookings = (s.pt_meeting_bookings ?? []) as { id: string; status: string; students: { first_name: string; last_name: string }[] | { first_name: string; last_name: string } | null }[];
    const booked = bookings.filter((b) => b.status === "booked");
    return {
      id: s.id,
      teacher_id: s.teacher_id,
      teacher_name: teacher?.full_name ?? "—",
      slot_date: s.slot_date,
      start_time: s.start_time,
      end_time: s.end_time,
      location: s.location,
      capacity: s.capacity,
      is_own: s.teacher_id === schoolUser?.id,
      booked_count: booked.length,
      booked_students: booked.map((b) => {
        const st = Array.isArray(b.students) ? b.students[0] : b.students;
        return st ? `${st.first_name} ${st.last_name}` : "Unknown";
      }),
    };
  });

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "PT Meetings" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Parent-teacher meetings</h1>
          <p className="text-sm text-muted-foreground">Publish available slots — parents book them from the portal.</p>
        </div>
        <PtMeetingsSection slots={slots} schoolUserId={schoolUser?.id ?? null} canWriteAny={canWriteAny === true} />
      </div>
    </AppShell>
  );
}
