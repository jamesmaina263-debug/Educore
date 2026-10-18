import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// Schools can opt out of AI exam papers (school_modules key "exam_papers"). Absence of an
// override means enabled, and a failed lookup leaves the page available (fails safe), exactly
// like the other module layouts.
export default async function ExamPapersLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const user = await getCachedUser();

  if (user) {
    const { data: moduleEnabled } = await supabase.rpc("auth_school_module_enabled", { p_key: "exam_papers" });
    if (moduleEnabled === false) {
      notFound();
    }
  }

  return children;
}
