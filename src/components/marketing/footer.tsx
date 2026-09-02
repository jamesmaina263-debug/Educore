import Link from "next/link";
import Image from "next/image";

const FOOTER_GROUPS = [
  {
    heading: "Product",
    links: [
      { href: "/platform", label: "Platform" },
      { href: "/solutions", label: "Solutions" },
      { href: "/student-management-system", label: "Student Management" },
      { href: "/cbc-school-management", label: "CBC School Management" },
      { href: "/school-attendance-management", label: "Attendance Management" },
      { href: "/parent-communication", label: "Parent Communication" },
      { href: "/ai-automation", label: "AI & Automation" },
      { href: "/finance-fees", label: "Finance & Fees" },
      { href: "/security", label: "Security & Privacy" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/faq", label: "FAQ" },
      { href: "/blog/best-school-management-system-kenya", label: "Blog" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/signup", label: "Start a school" },
    ],
  },
];

// Kept separate from the Company nav links (rather than appended to that
// list) so it reads as its own thing -- "skip the form, reach us directly"
// -- instead of sitting flush under the /contact link and looking like a
// near-duplicate of it.
const DIRECT_CONTACTS = [
  { href: "https://wa.me/254702904562", label: "WhatsApp +254 702 904562" },
  { href: "mailto:support@educoreafrica.com", label: "support@educoreafrica.com" },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-marketing-gold-500/20 bg-marketing-navy-950">
      <div className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Image
              src="/educore-logo-lockup.png"
              alt="EduCore"
              width={140}
              height={41}
              className="h-8 w-auto"
            />
            <p className="mt-4 max-w-xs text-sm text-white/60">
              School operations, brought into one connected platform.
            </p>
            <p className="mt-4 text-xs text-white/50">Nairobi, Kenya</p>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-white/50">
                {group.heading}
              </p>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/70 transition-colors hover:text-marketing-gold-400"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>

              {group.heading === "Company" && (
                <div className="mt-6 border-t border-white/10 pt-4">
                  <p className="text-xs text-white/50">Prefer to skip the form?</p>
                  <ul className="mt-3 space-y-3">
                    {DIRECT_CONTACTS.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="text-sm text-white/70 transition-colors hover:text-marketing-gold-400"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/50">
            © {new Date().getFullYear()} EduCore. All rights reserved.
          </p>
          <div className="flex gap-6 text-xs text-white/50">
            <Link href="/privacy" className="hover:text-white/70">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white/70">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
