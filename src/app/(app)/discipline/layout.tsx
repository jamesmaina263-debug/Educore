import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors health/layout.tsx's own module-check fallback. See that file's comment for why this
// exists alongside _data.ts's redirect rather than replacing it.
export default async function DisciplineLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "discipline" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
