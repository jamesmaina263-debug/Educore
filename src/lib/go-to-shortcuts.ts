// Maps "g" then "<key>" sequences to top-level modules (mirrors the top-level
// entries in navGroups from components/app-shell/nav-items.tsx, not their
// children -- 23 items already exhausts most easy mnemonic letters).
// Kept as its own file (rather than adding a `goKey` field to nav-items.tsx)
// so the existing nav/command-palette data is untouched.
//
// Not every letter is mnemonic (e.g. Educore AI -> k, Settings -> z) --
// picked for uniqueness once the obvious first-letters ran out. If this
// becomes hard to remember in practice, the command palette (⌘K) already
// lists every page by name and needs no memorization.
export interface GoToShortcut {
  key: string;
  href: string;
  label: string;
}

export const GO_TO_SHORTCUTS: GoToShortcut[] = [
  { key: "d", href: "/dashboard", label: "Dashboard" },
  { key: "m", href: "/admissions", label: "Admissions" },
  { key: "c", href: "/academics", label: "Academics" },
  { key: "s", href: "/students", label: "Students" },
  { key: "t", href: "/staff", label: "Staff" },
  { key: "f", href: "/finance", label: "Finance" },
  { key: "a", href: "/attendance", label: "Attendance" },
  { key: "e", href: "/exams", label: "Exams" },
  { key: "w", href: "/homework", label: "Homework" },
  { key: "x", href: "/discipline", label: "Discipline & Welfare" },
  { key: "p", href: "/payroll", label: "Payroll" },
  { key: "l", href: "/library", label: "Library" },
  { key: "r", href: "/transport", label: "Transport" },
  { key: "b", href: "/boarding", label: "Boarding" },
  { key: "h", href: "/health", label: "Health" },
  { key: "v", href: "/inventory", label: "Inventory & Procurement" },
  { key: "o", href: "/performance", label: "Performance" },
  { key: "q", href: "/pt-meetings", label: "PT Meetings" },
  { key: "u", href: "/communication", label: "Communication" },
  { key: "k", href: "/ai", label: "Educore AI" },
  { key: "y", href: "/reports", label: "Reports" },
  { key: "j", href: "/campuses", label: "Campuses" },
  { key: "z", href: "/settings", label: "Settings" },
];

if (process.env.NODE_ENV !== "production") {
  const seen = new Set<string>();
  for (const s of GO_TO_SHORTCUTS) {
    if (s.key === "g") {
      // eslint-disable-next-line no-console
      console.warn(`[go-to-shortcuts.ts] "g" cannot be a second key -- it's the prefix key.`);
    }
    if (seen.has(s.key)) {
      // eslint-disable-next-line no-console
      console.warn(`[go-to-shortcuts.ts] Duplicate key "${s.key}" -- shortcut collision.`);
    }
    seen.add(s.key);
  }
}
