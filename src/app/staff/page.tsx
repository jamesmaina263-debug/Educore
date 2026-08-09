import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { Button } from "@/components/ui/button";
import { StaffTable, type StaffRow } from "@/components/staff/staff-table";

export default async function StaffDirectoryPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const { data: canManage } = await supabase.rpc("auth_has_permission", { p_permission_key: "staff.manage" });

  const { data: staffRows } = await supabase
    .from("school_users")
    .select("id, full_name, department, position, status, roles!inner(name, display_name)")
    .not("roles.name", "in", "(parent,student,super_admin)")
    .order("full_name");

  const rows: StaffRow[] = (staffRows ?? []).map((s) => ({
    id: s.id,
    full_name: s.full_name,
    role_name: (s.roles as unknown as { display_name: string } | null)?.display_name ?? "",
    department: s.department,
    position: s.position,
    status: s.status,
  }));

  const roleName = (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore", href: "/dashboard" }, { label: "Staff" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Staff directory</h1>
            <p className="text-sm text-muted-foreground">{rows.length} staff members</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/staff/attendance">Attendance register</Link>
            </Button>
            {canManage === true && (
              <Button asChild>
                <Link href="/settings?tab=staff">Add staff member</Link>
              </Button>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="panel border-dashed p-10 text-center text-sm text-muted-foreground">
            No staff records yet.
          </div>
        ) : (
          <StaffTable rows={rows} />
        )}
      </div>
    </AppShell>
  );
}
