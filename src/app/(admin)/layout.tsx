import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { AdminConsoleFrame } from "@/components/admin/admin-console-frame";

// Distinct from src/app/(app)/layout.tsx on purpose: platform-admin pages are a different
// product surface (cross-tenant, super-admin only) from the per-school app, so they get their
// own chrome instead of inheriting the school sidebar/topbar. A route group's parentheses are
// stripped from the URL, so every page under here keeps its existing path (e.g. /admin/billing).
//
// Gate lives here (not just per-page) so a super-admin check always happens before any admin
// page renders, even ones added later that forget to check themselves. Individual pages may
// still carry their own redundant check from before this layout existed -- harmless,
// deliberately left in place rather than stripped out (defense in depth on the platform's most
// sensitive routes is worth a duplicate query).
export default async function AdminRouteGroupLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const { data: currentUser } = await supabase
    .from("school_users")
    .select("full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (
    <AdminConsoleFrame userName={currentUser?.full_name ?? user.email ?? "Account"} onSignOut={logout}>
      {children}
    </AdminConsoleFrame>
  );
}
