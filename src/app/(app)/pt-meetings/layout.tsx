import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Mirrors every other gated module's layout.tsx fallback. PT-Meetings had no layout.tsx at all
// before this, same situation Transport and Homework were in.
export default async function PtMeetingsLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "pt_meetings" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
