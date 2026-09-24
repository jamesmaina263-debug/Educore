import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors health/discipline/library layout.tsx's own module-check fallback. Uses the shared
// per-request cached getUser() (see #437) rather than a direct auth.getUser() call, consistent
// with every sibling module layout -- this file didn't exist in the pre-#437 form those got
// migrated from, so it needed this added explicitly rather than picking it up via rebase.
export default async function PayrollLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "payroll" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
