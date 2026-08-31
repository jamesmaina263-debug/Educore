"use server";

import { createClient } from "@/lib/supabase/server";

// PR-13 (GTM Readiness Protocol): Demo Academy is the sample data used for live sales
// demos of PR-07 (parent announcements). This lets a platform admin clear whatever was
// published during the last demo without touching any other table -- see the migration
// header (20260831130500_reset_demo_academy_announcements.sql) for why the scope stops
// there. auth_is_super_admin() is re-checked inside the RPC itself, not just relied on
// via this route being under the (admin) layout gate -- same defense-in-depth pattern
// the rest of /admin follows.
export async function resetDemoAcademyAnnouncementsAction(): Promise<
  { error: string } | { success: true }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.rpc("reset_demo_academy_announcements");
  if (error) return { error: error.message };

  return { success: true };
}
