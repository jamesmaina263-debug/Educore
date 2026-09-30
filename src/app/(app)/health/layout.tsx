import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors boarding/layout.tsx's own module-check -- _data.ts's redirect covers every /health/*
// page today, but a route guard here closes the same gap boarding/layout.tsx closed: without
// it, a school with Health disabled could still reach a /health/* page directly by URL if a
// future page under this route ever forgot to call loadHealthContext(). auth_school_module_enabled
// fails safe to true, so this only ever narrows access for a school explicitly toggled off.
export default async function HealthLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "health" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
