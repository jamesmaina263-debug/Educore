import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { CommandPaletteProvider } from "./command-palette-context";
import type { BreadcrumbItem } from "./breadcrumbs";

export function AppShell({
  breadcrumbs,
  userName,
  userRole,
  onSignOut,
  children,
}: {
  breadcrumbs: BreadcrumbItem[];
  userName: string;
  userRole?: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
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
            breadcrumbs={breadcrumbs}
            userName={userName}
            userRole={userRole}
            onSignOut={onSignOut}
          />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
    </CommandPaletteProvider>
  );
}
