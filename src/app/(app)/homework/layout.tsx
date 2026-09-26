import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors every other gated module's layout.tsx fallback. Homework had no layout.tsx at all
// before this, same situation Transport was in.
export default async function HomeworkLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "homework" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
