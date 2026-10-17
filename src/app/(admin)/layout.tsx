import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminOperator } from "@/lib/admin-operator-server";
import { getAdminMfaState, isSuperAdminAnyAal } from "@/lib/admin-mfa";
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

  // Step 1: is this a platform admin at all (regardless of MFA)? Not one -> out.
  if (!(await isSuperAdminAnyAal(supabase))) redirect("/dashboard");

  // Step 2: MFA. Only active once the owner has switched enforcement on in the database
  // (public.set_admin_mfa_required(true)); until then this is a no-op. The database also refuses
  // super-admin access to a non-aal2 session, so this redirect is UX, not the control.
  const mfa = await getAdminMfaState(supabase);
  if (mfa.required && mfa.currentLevel !== "aal2") redirect("/admin/mfa");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) {
    // aal2 but still refused: the account has a verified authenticator that is not on the pinned list.
    redirect(mfa.required ? "/admin/mfa?reason=unrecognized-factor" : "/dashboard");
  }

  // Shared login: every session must say which person is using it (see lib/admin-operator.ts)
  // before any admin page renders, so the activity log can attribute what they do. With MFA on,
  // the name comes from the authenticator that was verified, not from a self-declared picker.
  const operator = await getAdminOperator();
  if (!operator) redirect(mfa.required ? "/admin/mfa" : "/admin/who");

  const { data: currentUser } = await supabase
    .from("school_users")
    .select("full_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return (
    <AdminConsoleFrame
      userName={currentUser?.full_name ?? user.email ?? "Account"}
      operatorName={operator}
      onSignOut={logout}
    >
      {children}
    </AdminConsoleFrame>
  );
}
