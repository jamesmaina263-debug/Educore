"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  getPlatformNotifications,
  markPlatformNotificationReadAction,
  clearAllPlatformNotificationsAction,
  type PlatformNotification,
} from "@/app/(admin)/admin/notifications/actions";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function PlatformNotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  async function load() {
    const result = await getPlatformNotifications();
    if ("success" in result) {
      setNotifications(result.notifications);
      setLoaded(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    getPlatformNotifications().then((result) => {
      if (cancelled) return;
      if ("success" in result) {
        setNotifications(result.notifications);
        setLoaded(true);
      }
    });
    // Polling, not realtime -- matches this app's other admin pages (no Supabase Realtime
    // subscription infra exists here yet). 60s is frequent enough that "a new demo request came
    // in" surfaces well before anyone would notice it missing, without hammering the DB.
    const interval = setInterval(() => {
      getPlatformNotifications().then((result) => {
        if (!cancelled && "success" in result) setNotifications(result.notifications);
      });
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) await load();
  }

  async function handleClearAll() {
    setClearing(true);
    const result = await clearAllPlatformNotificationsAction();
    setClearing(false);
    if (result && "success" in result) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    }
  }

  async function handleClick(n: PlatformNotification) {
    if (!n.read_at) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      await markPlatformNotificationReadAction(n.id);
    }
    if (n.action_path) {
      setOpen(false);
      router.push(n.action_path);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="size-4.5" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex size-2 rounded-full bg-danger" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          <span className="flex items-center gap-2">
            {unreadCount > 0 && <span className="text-[0.6875rem] font-normal text-muted-foreground">{unreadCount} unread</span>}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={clearing}
                className="text-[0.6875rem] font-normal text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!loaded ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted ${!n.read_at ? "bg-primary/5" : ""}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-[0.75rem] font-medium">{n.title}</span>
                  {!n.read_at && (
                    <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-danger">
                      New
                    </span>
                  )}
                </span>
                <span className="text-[0.8125rem] text-foreground/90">{n.body}</span>
                <span className="text-[0.6875rem] text-muted-foreground">{timeAgo(n.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
