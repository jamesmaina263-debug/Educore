"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminOperator, safeAdminNextPath } from "@/lib/admin-operator";
import { setAdminOperatorCookie } from "@/lib/admin-operator-server";

// Records which person is at the keyboard for this session. Requires a real super-admin
// session first, so the cookie can't be set by someone who isn't signed in as platform staff.
export async function identifyAdminOperator(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: isSuperAdmin } = await supabase.rpc("auth_is_super_admin");
  if (isSuperAdmin !== true) redirect("/dashboard");

  const operator = formData.get("operator");
  if (!isAdminOperator(operator)) redirect("/admin/who");

  setAdminOperatorCookie(await cookies(), operator);
  redirect(safeAdminNextPath(formData.get("next")));
}
