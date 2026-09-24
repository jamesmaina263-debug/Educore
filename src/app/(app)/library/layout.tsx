import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Mirrors health/discipline layout.tsx's own module-check fallback.
export default async function LibraryLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "library" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
