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
  // disabledHrefs generalizes the old single `boardingEnabled` boolean to a list, so each
  // additional module toggled through school_modules (see auth_school_module_enabled) is one
  // more entry here rather than one more prop threaded through AppShellFrame/SidebarNav/
  // CommandPalette. Boarding keeps reading schools.boarding_enabled directly (unmigrated, see
  // #425's own note) -- everything else reads the new module system.
  const disabledHrefs: string[] = [];
  if (user) {
    const [{ data: schoolUser }, { data: healthEnabled }, { data: disciplineEnabled }] = await Promise.all([
      supabase.from("school_users").select("schools(name, boarding_enabled)").eq("auth_user_id", user.id).maybeSingle(),
      supabase.rpc("auth_school_module_enabled", { p_key: "health" }),
      supabase.rpc("auth_school_module_enabled", { p_key: "discipline" }),
    ]);
    const school = schoolUser?.schools as unknown as { name: string; boarding_enabled: boolean } | null;
    schoolName = school?.name;
    if (school?.boarding_enabled === false) disabledHrefs.push("/boarding");
    if (healthEnabled === false) disabledHrefs.push("/health");
    if (disciplineEnabled === false) disabledHrefs.push("/discipline");
  }

  return (
    <AppShellChromeProvider>
      <AppShellFrame schoolName={schoolName} disabledHrefs={disabledHrefs}>{children}</AppShellFrame>
    </AppShellChromeProvider>
  );
}
