"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, ChevronDown } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";
import { NAV_ITEMS, isDropdown, type NavItem } from "@/components/marketing/nav-data";
import { cn } from "@/lib/utils";

// Expandable disclosure for a Platform/Solutions item on mobile. Each
// dropdown's groups are flattened into one indented list under a heading --
// the group headings (e.g. "Core School Management") are kept as small
// labels so the hierarchy still reads, without nesting a second level of
// collapse inside the first.
function MobileNavSection({
  item,
  onNavigate,
}: {
  item: Extract<NavItem, { groups: unknown }>;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const panelId = React.useId();

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-md px-2 py-3 text-lg font-medium text-white/90 transition-colors hover:bg-white/5 hover:text-marketing-gold-400"
      >
        {item.label}
        <ChevronDown
          className={cn("h-5 w-5 text-white/50 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div id={panelId} className="pb-2 pl-2">
          {item.groups.map((group) => (
            <div key={group.heading} className="mb-3 last:mb-0">
              <p className="px-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white/40">
                {group.heading}
              </p>
              <div className="mt-1 flex flex-col">
                {group.links.map((link) => (
                  <Dialog.Close asChild key={`${group.heading}-${link.label}`}>
                    <Link
                      href={link.href}
                      onClick={onNavigate}
                      className="rounded-md px-2 py-2 text-base text-white/75 transition-colors hover:bg-white/5 hover:text-marketing-gold-400"
                    >
                      {link.label}
                    </Link>
                  </Dialog.Close>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:text-white lg:hidden"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-sm flex-col overflow-y-auto bg-marketing-navy-950 p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right lg:hidden"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-white/50">
              Menu
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:text-white"
              >
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <nav className="mt-8 flex flex-col gap-1" aria-label="Primary">
            {NAV_ITEMS.map((item) =>
              isDropdown(item) ? (
                <MobileNavSection key={item.label} item={item} onNavigate={() => setOpen(false)} />
              ) : (
                <Dialog.Close asChild key={item.href}>
                  <Link
                    href={item.href}
                    className="rounded-md px-2 py-3 text-lg font-medium text-white/90 transition-colors hover:bg-white/5 hover:text-marketing-gold-400"
                  >
                    {item.label}
                  </Link>
                </Dialog.Close>
              ),
            )}
          </nav>

          <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-6">
            <Dialog.Close asChild>
              <Link
                href="/login"
                className="rounded-md px-2 py-2 text-center text-sm font-medium text-white/80 hover:text-white"
              >
                Sign in
              </Link>
            </Dialog.Close>
            <MarketingButton asChild>
              <Dialog.Close asChild>
                <Link href="/contact">Book a Demo</Link>
              </Dialog.Close>
            </MarketingButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
