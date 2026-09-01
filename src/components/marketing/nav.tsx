import Image from "next/image";
import Link from "next/link";
import { MarketingButton } from "@/components/marketing/button";
import { MobileNav } from "@/components/marketing/mobile-nav";

const NAV_LINKS = [
  { href: "/platform", label: "Platform" },
  { href: "/solutions", label: "Solutions" },
  { href: "/ai-automation", label: "AI & Automation" },
  { href: "/finance-fees", label: "Finance & Fees" },
  { href: "/security", label: "Security" },
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
            className="h-8 w-auto"
            priority
          />
        </Link>

        <nav className="hidden items-center gap-5 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-white/80 transition-colors hover:text-marketing-gold-400"
            >
              {link.label}
            </Link>
          ))}
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
