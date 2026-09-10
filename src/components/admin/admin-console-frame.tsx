"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CreditCard,
  BarChart3,
  Inbox,
  Palette,
  RotateCcw,
  Mail,
  HeartPulse,
  Megaphone,
  ScrollText,
  Flag,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { clearOfflineCaches } from "@/lib/offline/clear-on-logout";
import { PlatformNotificationBell } from "@/components/admin/platform-notification-bell";

interface AdminNavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

// Grouped the same way the school console's sidebar groups its nav (see
// src/components/app-shell/nav-items.tsx) -- a labelled section header per group, plain links
// underneath. Kept as a flat (non-collapsible) list since no admin section here has children,
// unlike the school sidebar's Academics/Finance drilldowns.
const NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Revenue",
    items: [
      { href: "/admin/billing", label: "Plans & Billing", icon: CreditCard },
      { href: "/admin/whitelabel", label: "White-label", icon: Palette },
    ],
  },
  {
    label: "Growth & Comms",
    items: [
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/admin/broadcast", label: "Broadcast", icon: Megaphone },
      { href: "/admin/company-email", label: "Company Email", icon: Mail },
      { href: "/admin/demo-requests", label: "Requests", icon: Inbox },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/system-health", label: "System Health", icon: HeartPulse },
      { href: "/admin/feature-flags", label: "Feature Flags", icon: Flag },
      { href: "/admin/activity-log", label: "Activity Log", icon: ScrollText },
      { href: "/admin/demo-reset", label: "Demo Reset", icon: RotateCcw },
    ],
  },
];

const ALL_ITEMS: AdminNavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function AdminSidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary/10 text-sidebar-primary"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminConsoleFrame({
  children,
  userName,
  onSignOut,
}: {
  children: ReactNode;
  userName: string;
  onSignOut: () => void;
}) {
  const pathname = usePathname();
  const currentLabel = ALL_ITEMS.find((item) => isActive(pathname, item.href))?.label;

  // Same pattern as the school app's Topbar sign-out: clear this session's offline-cached
  // pages before the server action runs, so a different person signing in on this device
  // afterward is never served a stale cached page from this session.
  function handleSignOut() {
    void clearOfflineCaches();
    onSignOut();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Link
          href="/admin"
          className="flex h-14 items-center border-b border-sidebar-border px-4 text-sm font-semibold text-sidebar-foreground transition-opacity hover:opacity-80"
        >
          EduCore <span className="ml-1.5 font-normal text-sidebar-foreground/60">Platform Admin</span>
        </Link>
        <AdminSidebarNav pathname={pathname} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="size-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-sidebar p-0">
              <SheetHeader className="shrink-0 border-b border-sidebar-border p-4">
                <SheetTitle className="text-sidebar-foreground">EduCore Platform Admin</SheetTitle>
              </SheetHeader>
              <AdminSidebarNav pathname={pathname} />
            </SheetContent>
          </Sheet>

          <span className="text-sm font-medium">{currentLabel ?? "Platform Admin"}</span>

          <div className="ml-auto flex items-center gap-1">
            <PlatformNotificationBell />

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
                  <span className="font-medium">{userName}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
