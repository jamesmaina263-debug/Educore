import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { SummaryStatStrip } from "@/components/dashboard/summary-stat-strip";
import { StaffDirectoryTable, type StaffRow } from "@/components/dashboard/staff-directory-table";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS scopes this to the caller's own row (or all rows, for super_admin) —
  // no manual school_id filter needed here, by design (§6).
  const { data: schoolUser } = await supabase
    .from("school_users")
    .select("full_name, status, roles(display_name), schools(name)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // Directory of colleagues in the same school — again, RLS does the
  // tenant scoping; this query never touches school_id directly.
  const { data: staffRows } = await supabase
    .from("school_users")
    .select("id, full_name, status, email, roles(display_name)")
    .order("full_name");

  const rows: StaffRow[] = (staffRows ?? []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    role:
      (r.roles as unknown as { display_name: string } | null)?.display_name ?? "—",
    status: r.status,
    email: r.email,
  }));

  const roleName =
    (schoolUser?.roles as unknown as { display_name: string } | null)?.display_name;
  const schoolName =
    (schoolUser?.schools as unknown as { name: string } | null)?.name;

  return (
    <AppShell
      breadcrumbs={[{ label: schoolName ?? "EduCore" }, { label: "Dashboard" }]}
      userName={schoolUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {schoolName ? `${schoolName} — ` : ""}
            operational overview
          </p>
        </div>

        <SummaryStatStrip
          stats={[
            { label: "Staff", value: String(rows.length) },
            {
              label: "Active",
              value: String(rows.filter((r) => r.status === "active").length),
            },
            {
              label: "Inactive",
              value: String(rows.filter((r) => r.status !== "active").length),
            },
            { label: "Your role", value: roleName ?? "—" },
          ]}
        />

        <div>
          <h2 className="mb-2 text-sm font-medium">Staff directory</h2>
          <StaffDirectoryTable rows={rows} />
        </div>
      </div>
    </AppShell>
  );
}
