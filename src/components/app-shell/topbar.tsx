"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarNav } from "./sidebar-nav";
import { NotificationBell } from "./notification-bell";
import { clearOfflineCaches } from "@/lib/offline/clear-on-logout";

// Breadcrumbs + the visible ⌘K search box have been retired from the header
// (see command-palette-context.tsx -- the ⌘K keyboard shortcut itself still
// works globally, it just never needed a visible button). Notifications and
// the account/sign-out menu stay exactly where they were, top-right, per
// request -- only the clutter around them was removed.
export function Topbar({
  userName,
  userRole,
  onSignOut,
  schoolName,
}: {
  userName: string;
  userRole?: string;
  onSignOut: () => void;
  schoolName?: string;
}) {
  // Wipe this session's offline-cached pages before the actual sign-out
  // Server Action runs, so a different person signing in on this device
  // afterward can never be served a stale cached page from this session.
  // See clearOfflineCaches() for exactly what is/isn't cleared.
  function handleSignOut() {
    void clearOfflineCaches();
    onSignOut();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 print:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetHeader className="shrink-0 border-b border-sidebar-border p-4">
            <SheetTitle className="text-sidebar-foreground">{schoolName ?? "EduCore"}</SheetTitle>
          </SheetHeader>
          <SidebarNav />
        </SheetContent>
      </Sheet>

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted">
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">
                  {userName
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{userName}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{userName}</span>
                {userRole && (
                  <span className="text-xs font-normal text-muted-foreground">{userRole}</span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
