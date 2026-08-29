import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { AdminDemoRequestsTable, type DemoRequestRow } from "@/components/admin/admin-demo-requests-table";

export default async function AdminDemoRequestsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: currentUser }, { data: requests }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name)").eq("auth_user_id", user.id).maybeSingle(),
    // Readable here only because of the new marketing_demo_requests_select_super_admin
    // RLS policy -- this table has no SELECT policy for any other role.
    supabase
      .from("marketing_demo_requests")
      .select(
        "id, created_at, name, school_name, role, email, phone, student_count, message, status, utm_source, utm_medium, utm_campaign",
      )
      .order("created_at", { ascending: false }),
  ]);

  const roleName = (currentUser?.roles as unknown as { display_name: string } | null)?.display_name;

  return (
    <AppShell
      breadcrumbs={[{ label: "Platform admin" }, { label: "Demo Requests" }]}
      userName={currentUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Demo requests</h1>
          <p className="text-sm text-muted-foreground">
            Submissions from the marketing site&apos;s contact/demo form — visible to platform
            staff only. Read-only: change a submission&apos;s status in Supabase Studio.
          </p>
        </div>
        <AdminDemoRequestsTable rows={(requests ?? []) as DemoRequestRow[]} />
      </div>
    </AppShell>
  );
}
