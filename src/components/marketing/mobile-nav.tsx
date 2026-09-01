"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";

import { MarketingButton } from "@/components/marketing/button";

type NavLink = { href: string; label: string; description?: string };
type NavItem = NavLink | { label: string; children: NavLink[] };

export function MobileNav({ links }: { links: NavItem[] }) {
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
          className="fixed inset-y-0 right-0 z-50 flex w-[85vw] max-w-sm flex-col bg-marketing-navy-950 p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right lg:hidden"
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

          <nav className="mt-8 flex flex-col gap-1">
            {links.map((item) =>
              "children" in item ? (
                <div key={item.label} className="py-1">
                  <p className="px-2 pb-1 text-lg font-medium text-white/90">
                    {item.label}
                  </p>
                  <div className="flex flex-col gap-0.5 border-l border-white/10 pl-3">
                    {item.children.map((link) => (
                      <Dialog.Close asChild key={link.href}>
                        <Link
                          href={link.href}
                          className="rounded-md px-2 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-marketing-gold-400"
                        >
                          {link.label}
                        </Link>
                      </Dialog.Close>
                    ))}
                  </div>
                </div>
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
