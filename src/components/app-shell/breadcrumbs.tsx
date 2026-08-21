"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-online-status";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  const online = useOnlineStatus();
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center text-sm", className)}>
      <ol className="flex items-center gap-1.5">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  onClick={(e) => {
                    // Same offline-forces-hard-navigation reasoning as
                    // sidebar-nav.tsx -- a soft <Link> navigation can't be
                    // served from the service worker's page cache.
                    if (!online) {
                      e.preventDefault();
                      window.location.href = item.href!;
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "font-medium text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              )}
              {!last && (
                <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
