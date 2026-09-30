import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Scoped to this route only (not academics/layout.tsx, which is shared with every other
// academics page) -- mirrors inventory/discipline/health layout.tsx's own module-check
// fallback. See those files' comments for why this exists alongside _data.ts's redirect
// rather than replacing it.
export default async function SchemeOfWorkLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "scheme_of_work" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
