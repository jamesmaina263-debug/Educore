import type { ReactNode } from "react";
import { AppShellChromeProvider } from "@/components/app-shell/app-shell-chrome-context";
import { AppShellFrame } from "@/components/app-shell/app-shell-frame";

// Shared by every authenticated staff-facing route (see the folders grouped under this route
// group). A route group's parentheses are stripped from the URL by Next.js, so moving pages
// in here does not change any path. Because this layout persists across client-side
// navigations within the group, the sidebar/topbar it renders (via AppShellFrame) mounts once
// and never remounts on navigation -- see AppShell (still called identically by every page)
// for how each page's breadcrumbs/user info still reach this shared chrome.
export default function AppRouteGroupLayout({ children }: { children: ReactNode }) {
  return (
    <AppShellChromeProvider>
      <AppShellFrame>{children}</AppShellFrame>
    </AppShellChromeProvider>
  );
}
