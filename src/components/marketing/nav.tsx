import Image from "next/image";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import { MarketingButton } from "@/components/marketing/button";
import { MobileNav } from "@/components/marketing/mobile-nav";

// Minimal top-level nav, modeled on the flat item counts of Linear/Stripe/
// Vercel-style SaaS nav bars: 4 top-level entries instead of 7. The three
// specialized product areas (AI & Automation, Finance & Fees, Security)
// move into the "Solutions" dropdown instead of sitting as flat sibling
// links -- they're sub-topics of the same story, not independent sections.
export const SOLUTIONS_LINKS = [
  {
    href: "/solutions",
    label: "Overview",
    description: "Role-based tools for everyone in the building",
  },
  {
    href: "/ai-automation",
    label: "AI & Automation",
    description: "AI drafts the routine work, a person still decides",
  },
  {
    href: "/finance-fees",
    label: "Finance & Fees",
    description: "Fee collection built for how Kenyan schools get paid",
  },
  {
    href: "/security",
    label: "Security",
    description: "Access control and audit logs for student records",
  },
];

type NavItem =
  | { href: string; label: string }
  | { label: string; children: typeof SOLUTIONS_LINKS };

export const NAV_LINKS: NavItem[] = [
  { href: "/platform", label: "Platform" },
  { label: "Solutions", children: SOLUTIONS_LINKS },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

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
            className="h-7 w-auto"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((item) =>
            "children" in item ? (
              <DropdownMenu.Root key={item.label}>
                <DropdownMenu.Trigger className="group flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-white/80 outline-none transition-colors hover:bg-white/5 hover:text-white data-[state=open]:bg-white/5 data-[state=open]:text-white">
                  {item.label}
                  <ChevronDown
                    className="h-3.5 w-3.5 text-white/50 transition-transform group-data-[state=open]:rotate-180"
                    aria-hidden="true"
                  />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="start"
                    sideOffset={10}
                    className="z-50 w-80 rounded-xl border border-white/10 bg-marketing-navy-900 p-2 shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
                  >
                    {item.children.map((link) => (
                      <DropdownMenu.Item key={link.href} asChild>
                        <Link
                          href={link.href}
                          className="block rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-white/5 focus:bg-white/5"
                        >
                          <span className="block text-sm font-medium text-white">
                            {link.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-white/50">
                            {link.description}
                          </span>
                        </Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
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
          <MobileNav links={NAV_LINKS} />
        </div>
      </div>
    </header>
  );
}
