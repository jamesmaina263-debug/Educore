"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { CommandPaletteProvider } from "./command-palette-context";
import { GoToShortcuts } from "./go-to-shortcuts";
import { useAppShellChrome } from "./app-shell-chrome-context";

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

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <Link
            href="/dashboard"
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
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <GoToShortcuts />
    </CommandPaletteProvider>
  );
}
