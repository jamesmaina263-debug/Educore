"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CreditCard, BarChart3, Inbox, Palette, RotateCcw, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { clearOfflineCaches } from "@/lib/offline/clear-on-logout";
import { PlatformNotificationBell } from "@/components/admin/platform-notification-bell";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/billing", label: "Plans & Billing", icon: CreditCard },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/demo-requests", label: "Requests", icon: Inbox },
  { href: "/admin/whitelabel", label: "White-label", icon: Palette },
  { href: "/admin/cba-windows", label: "CBA Windows", icon: CalendarClock },
  { href: "/admin/demo-reset", label: "Demo Reset", icon: RotateCcw },
] as const;

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

  // Same pattern as the school app's Topbar sign-out: clear this session's offline-cached
  // pages before the server action runs, so a different person signing in on this device
  // afterward is never served a stale cached page from this session.
  function handleSignOut() {
    void clearOfflineCaches();
    onSignOut();
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-surface">
        <div className="flex h-14 items-center gap-2 px-4">
          <span className="mr-2 shrink-0 text-sm font-semibold">
            EduCore <span className="font-normal text-muted-foreground">Platform Admin</span>
          </span>

          <nav className="flex flex-1 items-center gap-1.5 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <PlatformNotificationBell />

          <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{userName}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
