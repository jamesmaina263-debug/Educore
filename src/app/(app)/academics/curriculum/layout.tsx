import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/get-user";

// This page exists to ground Scheme of Work AI generation (see
// academics/scheme-of-work/actions.ts's Phase 1 refusal) -- so it's gated on
// the same "scheme_of_work" module toggle as that route, via the identical
// notFound() fallback pattern scheme-of-work/layout.tsx just introduced
// (#467). A school with Scheme of Work switched off has no use for a page
// whose only purpose is feeding that feature.
export default async function CurriculumContentLayout({ children }: { children: ReactNode }) {
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
