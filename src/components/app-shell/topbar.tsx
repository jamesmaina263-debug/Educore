"use client";

import { Bell, Menu, Search } from "lucide-react";
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
import { useCommandPalette } from "./command-palette-context";
import type { BreadcrumbItem } from "./breadcrumbs";
import { Breadcrumbs } from "./breadcrumbs";

export function Topbar({
  breadcrumbs,
  userName,
  userRole,
  onSignOut,
}: {
  breadcrumbs: BreadcrumbItem[];
  userName: string;
  userRole?: string;
  onSignOut: () => void;
}) {
  const { setOpen } = useCommandPalette();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle>EduCore</SheetTitle>
          </SheetHeader>
          <SidebarNav />
        </SheetContent>
      </Sheet>

      <Breadcrumbs items={breadcrumbs} className="hidden sm:flex" />

      <button
        onClick={() => setOpen(true)}
        className="ml-2 flex h-8 flex-1 max-w-sm items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-4.5" />
        </Button>

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
            <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
