"use client";

import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { CommandPaletteProvider } from "./command-palette-context";
import { useAppShellChrome } from "./app-shell-chrome-context";

// Renders the sidebar + topbar + main frame exactly once, at the (app) layout level, so it
// never remounts across navigations between pages -- this is what keeps the sidebar's scroll
// position (and any section a user has open, e.g. Health) stable instead of snapping back to
// the top of the nav list on every click. Breadcrumbs/userName/userRole/onSignOut come from
// AppShellChromeContext, published per-page by the (now-passthrough) AppShell component.
export function AppShellFrame({ children }: { children: ReactNode }) {
  const { chrome } = useAppShellChrome();

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <div className="flex h-14 items-center border-b border-sidebar-border px-4 text-sm font-semibold text-sidebar-foreground">
            EduCore
          </div>
          <SidebarNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            breadcrumbs={chrome?.breadcrumbs ?? []}
            userName={chrome?.userName ?? ""}
            userRole={chrome?.userRole}
            onSignOut={chrome?.onSignOut ?? (() => {})}
          />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
    </CommandPaletteProvider>
  );
}
