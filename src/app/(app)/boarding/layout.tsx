import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Mirrors the app layout's own boarding_enabled lookup (src/app/(app)/layout.tsx) -- that one
// only hides the sidebar nav entry, it was never a route guard, so a school with boarding
// disabled (see schools_boarding_enabled_flag.sql) could still reach every /boarding/* page
// directly by URL. This closes that gap the same way the admissions wizard's Boarding step
// and complete_admission_checklist already respect the flag: boarding_enabled defaults to
// true, so every existing school is unaffected; only a school explicitly flipped to false
// (Little Beginners, so far) 404s here instead of rendering.
export default async function BoardingLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("schools(boarding_enabled)")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    const school = schoolUser?.schools as unknown as { boarding_enabled: boolean } | null;
    if (school?.boarding_enabled === false) {
      notFound();
    }
  }

  return children;
}
