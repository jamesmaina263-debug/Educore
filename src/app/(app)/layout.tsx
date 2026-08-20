import type { ReactNode } from "react";
import { AppShellChromeProvider } from "@/components/app-shell/app-shell-chrome-context";
import { AppShellFrame } from "@/components/app-shell/app-shell-frame";
import { createClient } from "@/lib/supabase/server";

// Shared by every authenticated staff-facing route (see the folders grouped under this route
// group). A route group's parentheses are stripped from the URL by Next.js, so moving pages
// in here does not change any path. Because this layout persists across client-side
// navigations within the group, the sidebar/topbar it renders (via AppShellFrame) mounts once
// and never remounts on navigation -- see AppShell (still called identically by every page)
// for how each page's breadcrumbs/user info still reach this shared chrome.
//
// The school name is fetched once here (rather than via AppShellChromeContext, which updates
// per-page) since it's tenant-level, not page-level, and shouldn't flicker on navigation.
export default async function AppRouteGroupLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let schoolName: string | undefined;
  if (user) {
    const { data: schoolUser } = await supabase
      .from("school_users")
      .select("schools(name)")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    schoolName = (schoolUser?.schools as unknown as { name: string } | null)?.name;
  }

  return (
    <AppShellChromeProvider>
      <AppShellFrame schoolName={schoolName}>{children}</AppShellFrame>
    </AppShellChromeProvider>
  );
}
