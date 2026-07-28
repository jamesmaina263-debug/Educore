import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CalendarCheck,
  Wallet,
  Settings,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

// Placeholder set matching Phase 1's planned modules — pages get built
// out module by module; the nav shell doesn't need to wait for that.
export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: GraduationCap },
  { label: "Staff", href: "/staff", icon: Users },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Fees", href: "/fees", icon: Wallet },
  { label: "Settings", href: "/settings", icon: Settings },
];
