import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors health/discipline/library/payroll layout.tsx's own module-check fallback. Transport
// had no layout.tsx at all before this -- page.tsx's own redirect covers /transport itself, but
// this closes the same gap the others closed: without it, a school with Transport disabled
// could still reach a /transport page directly if a future page under this route ever skipped
// its own check. auth_school_module_enabled fails safe to true, so this only ever narrows
// access for a school explicitly toggled off.
export default async function TransportLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "transport" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
