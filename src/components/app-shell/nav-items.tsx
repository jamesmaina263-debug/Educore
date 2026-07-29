import {
  LayoutDashboard,
  Users,
  GraduationCap,
  ClipboardList,
  BookOpen,
  CalendarCheck,
  Wallet,
  Settings,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

// Some of these still point at pages that don't exist yet (Staff, Fees,
// Settings) — the nav shell doesn't need to wait for every module to be
// built before it's wired in.
export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: GraduationCap },
  { label: "Admissions", href: "/admissions", icon: ClipboardList },
  { label: "Academics", href: "/academics", icon: BookOpen },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Staff", href: "/staff", icon: Users },
  { label: "Fees", href: "/fees", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];
