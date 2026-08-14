"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { navGroups, type NavItem } from "./nav-items";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
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
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [manuallyOpen, setManuallyOpen] = useState<Record<string, boolean>>({});

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
      {navGroups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
            {group.label}
          </p>
          {group.items.map((item) => {
            const hasChildren = !!item.children?.length;
            const parentActive = isActive(pathname, item.href);
            const expanded = manuallyOpen[item.href] ?? parentActive;

            if (!hasChildren) {
              return (
                <NavRow key={item.href} item={item} active={parentActive} onNavigate={onNavigate} />
              );
            }

            return (
              <div key={item.href} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setManuallyOpen((prev) => ({ ...prev, [item.href]: !expanded }))
                  }
                  aria-expanded={expanded}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    parentActive
                      ? "bg-sidebar-primary/10 text-sidebar-primary"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown
                    className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
                  />
                </button>
                {expanded && (
                  <div className="ml-3.5 flex flex-col gap-0.5 border-l border-sidebar-border pl-2.5">
                    {item.children!.map((child) => {
                      const childActive = isActive(pathname, child.href);
                      const ChildIcon = child.icon;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavigate}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                            childActive
                              ? "bg-sidebar-primary/10 font-medium text-sidebar-primary"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <ChildIcon className="size-3.5 shrink-0" />
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
