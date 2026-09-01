"use client";

import * as React from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavDropdown } from "@/components/marketing/nav-data";

// Trigger opens on click (Radix default) and also on hover-intent for
// desktop pointer users, with a short close delay so moving the cursor
// diagonally from the trigger into the panel doesn't clip the menu shut.
// Radix still owns focus management, Escape-to-close, outside-click, and
// keyboard navigation between items -- this component only adds the
// optional hover affordance on top of that.
//
// Deliberately no scale/zoom transform on open: an animating transform
// changes the panel's effective hit-test box every frame, so a cursor
// sitting near the (still-growing) edge repeatedly falls in and out of
// bounds mid-animation, firing mouseenter/mouseleave back and forth and
// reading as a "blinking" menu. Fade-only avoids that; the close delay
// below covers the (now small, fixed) trigger-to-panel gap instead of
// relying on a moving hit box.
//
// modal={false} on the Root below is load-bearing, not cosmetic: Radix's
// default modal mode sets `pointer-events: none` on document.body (every-
// thing except the portaled panel) while open, to block interaction with
// the rest of the page -- correct for a click-triggered menu, but this
// trigger lives outside the portal. With modal mode on, opening the menu
// makes the trigger itself briefly un-hoverable, which reads as the mouse
// "leaving" it -> closeSoon() -> closes -> pointer-events restored ->
// trigger hoverable again -> reopens -> repeat, forever, even with the
// cursor perfectly still. That self-sustaining loop is a separate root
// cause from the hit-test-box issue above; both had to be fixed for the
// menu to actually stay open on hover.
const CLOSE_DELAY_MS = 200;

export function NavDropdownMenu({ item }: { item: NavDropdown }) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNow = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const closeSoon = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  React.useEffect(() => clearCloseTimer, []);

  const isMega = item.groups.length > 2;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <div onMouseEnter={openNow} onMouseLeave={closeSoon}>
        <DropdownMenu.Trigger
          className="group flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-white/80 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-marketing-gold-500 data-[state=open]:bg-white/5 data-[state=open]:text-white"
        >
          {item.label}
          <ChevronDown
            className="h-3.5 w-3.5 text-white/50 transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            onMouseEnter={openNow}
            onMouseLeave={closeSoon}
            className={cn(
              "z-50 rounded-xl border border-white/10 bg-marketing-navy-900 p-4 shadow-xl",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              isMega ? "grid w-[640px] grid-cols-4 gap-6" : "grid w-[420px] grid-cols-2 gap-6",
            )}
          >
            {item.groups.map((group) => (
              <div key={group.heading}>
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
                  {group.heading}
                </p>
                <ul className="mt-3 space-y-0.5">
                  {group.links.map((link) => (
                    <li key={`${group.heading}-${link.label}`}>
                      <DropdownMenu.Item asChild>
                        <Link
                          href={link.href}
                          className="block rounded-md px-2 py-1.5 text-sm text-white/75 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:bg-white/5 focus-visible:text-white"
                        >
                          {link.label}
                        </Link>
                      </DropdownMenu.Item>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </div>
    </DropdownMenu.Root>
  );
}
