"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { navItems } from "./nav-items";
import { useCommandPalette } from "./command-palette-context";
import { useOnlineStatus } from "@/hooks/use-online-status";

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const online = useOnlineStatus();

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      // router.push() does a soft navigation (RSC fetch, no cache in front
      // of it -- see public/sw.js) which just fails silently while offline;
      // a hard navigation lets the service worker serve a cached copy
      // instead. Same reasoning as sidebar-nav.tsx.
      if (!online) {
        window.location.href = href;
        return;
      }
      router.push(href);
    },
    [online, router, setOpen],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {navItems.map((item) => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => go(item.href)}
            >
              <item.icon className="size-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
