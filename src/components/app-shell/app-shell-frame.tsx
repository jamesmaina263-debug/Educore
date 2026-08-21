"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { CommandPaletteProvider } from "./command-palette-context";
import { GoToShortcuts } from "./go-to-shortcuts";
import { useAppShellChrome } from "./app-shell-chrome-context";
import { useOnlineStatus } from "@/hooks/use-online-status";

// Renders the sidebar + topbar + main frame exactly once, at the (app) layout level, so it
// never remounts across navigations between pages -- this is what keeps the sidebar's scroll
// position (and any section a user has open, e.g. Health) stable instead of snapping back to
// the top of the nav list on every click. Breadcrumbs/userName/userRole/onSignOut come from
// AppShellChromeContext, published per-page by the (now-passthrough) AppShell component.
export function AppShellFrame({
  children,
  schoolName,
}: {
  children: ReactNode;
  schoolName?: string;
}) {
  const { chrome } = useAppShellChrome();
  const online = useOnlineStatus();

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <Link
            href="/dashboard"
            onClick={(e) => {
              if (!online) {
                e.preventDefault();
                window.location.href = "/dashboard";
              }
            }}
            className="flex h-14 items-center border-b border-sidebar-border px-4 text-sm font-semibold text-sidebar-foreground transition-opacity hover:opacity-80"
          >
            {schoolName ?? "EduCore"}
          </Link>
          <SidebarNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            breadcrumbs={chrome?.breadcrumbs ?? []}
            userName={chrome?.userName ?? ""}
            userRole={chrome?.userRole}
            onSignOut={chrome?.onSignOut ?? (() => {})}
            schoolName={schoolName}
          />
          {!online && (
            // App-wide, distinct from each module's own offline-write banner
            // (e.g. attendance/exams) -- this one is about the page you're
            // *reading*, not what you're submitting. Every page you reach
            // offline (see sidebar-nav.tsx / breadcrumbs.tsx / command-
            // palette.tsx forcing hard navigations) was cached from some
            // earlier visit, so it can be behind what's actually on the
            // server now.
            <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground">
              <WifiOff className="size-4 shrink-0" aria-hidden />
              <span>You&apos;re offline. Pages you visited before are available, but may not show the latest data.</span>
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <GoToShortcuts />
    </CommandPaletteProvider>
  );
}
