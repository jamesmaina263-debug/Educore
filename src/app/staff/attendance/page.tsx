import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import Link from "next/link";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { StaffRegisterForm, type StaffRosterRow } from "@/components/staff/staff-register-form";
import { StaffDatePicker } from "@/components/staff/staff-date-picker";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const attendanceDate = dateParam || todayISO();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schoolUser }, { data: canMark }, { data: staffRows }, { data: existingRows }] = await Promise.all([
    supabase
      .from("school_users")
      .select("full_name, roles(display_name), schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle(),
    supabase.rpc("auth_has_permission", { p_permission_key: "staff_attendance.mark" }),
    supabase
      .from("school_users")
      .select("id, full_name, roles!inner(name, display_name)")
      .eq("status", "active")
      .not("roles.name", "in", "(parent,student,super_admin)")
      .order("full_name"),
    supabase.from("staff_attendance").select("id, staff_id, status").eq("attendance_date", attendanceDate),
  ]);

  const existingByStaff = new Map((existingRows ?? []).map((r) => [r.staff_id, r]));

  const roster: StaffRosterRow[] = (staffRows ?? [])
    .filter((s) => (s.roles as unknown as { display_name: string } | null)?.display_name)
    .map((s) => {
      const existing = existingByStaff.get(s.id);
      return {
        staff_id: s.id,
        full_name: s.full_name,
        role_name: (s.roles as unknown as { display_name: string } | null)?.display_name ?? "",
        existing: existing
          ? { record_id: existing.id, status: existing.status as "present" | "absent" | "late" | "on_leave" | "half_day" }
          : null,
      };
    });

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[
        { label: schoolName ?? "EduCore", href: "/dashboard" },
        { label: "Staff", href: "/staff" },
        { label: "Attendance" },
      ]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Staff attendance</h1>
            <p className="text-sm text-muted-foreground">Daily attendance register — {attendanceDate}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff">← Staff directory</Link>
            </Button>
            <StaffDatePicker date={attendanceDate} />
          </div>
        </div>
        <StaffRegisterForm attendanceDate={attendanceDate} roster={roster} canMark={canMark === true} />
      </div>
    </AppShell>
  );
}
