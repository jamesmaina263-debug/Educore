import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors health/discipline/library layout.tsx's own module-check fallback. See those files'
// comments for why this exists alongside _data.ts's redirect rather than replacing it.
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "inventory" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
