import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AppShell } from "@/components/app-shell/app-shell";
import { AdminWhitelabelTable, type WhitelabelGroupRow } from "@/components/admin/admin-whitelabel-table";

export default async function AdminWhitelabelPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const [{ data: currentUser }, { data: groups }] = await Promise.all([
    supabase.from("school_users").select("full_name, roles(display_name)").eq("auth_user_id", user.id).maybeSingle(),
    supabase
      .from("school_groups")
      .select("id, name, whitelabel_enabled, custom_domain, custom_domain_status, verified_at")
      .order("name"),
  ]);

  const roleName = (currentUser?.roles as unknown as { display_name: string } | null)?.display_name;

  return (
    <AppShell
      breadcrumbs={[{ label: "Platform admin" }, { label: "White-label" }]}
      userName={currentUser?.full_name ?? user.email ?? "Account"}
      userRole={roleName}
      onSignOut={logout}
    >
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">White-label &amp; domain verification</h1>
          <p className="text-sm text-muted-foreground">
            Grant white-label to a school group and confirm custom domains — visible to
            platform staff only.
          </p>
        </div>
        <AdminWhitelabelTable rows={(groups ?? []) as WhitelabelGroupRow[]} />
      </div>
    </AppShell>
  );
}
