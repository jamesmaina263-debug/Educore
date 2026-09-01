import Image from "next/image";
import Link from "next/link";

import { MarketingButton } from "@/components/marketing/button";
import { MobileNav } from "@/components/marketing/mobile-nav";
import { NavDropdownMenu } from "@/components/marketing/nav-dropdown";
import { NAV_ITEMS, isDropdown } from "@/components/marketing/nav-data";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-marketing-navy-950/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="EduCore home">
          <Image
            src="/educore-logo-lockup.png"
            alt="EduCore"
            width={140}
            height={41}
            className="h-8 w-auto"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) =>
            isDropdown(item) ? (
              <NavDropdownMenu key={item.label} item={item} />
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm font-medium text-white/80 hover:text-white sm:inline"
          >
            Sign in
          </Link>
          <MarketingButton asChild size="sm">
            <Link href="/contact">Book a Demo</Link>
          </MarketingButton>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
