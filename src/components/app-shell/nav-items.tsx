import {
  LayoutDashboard,
  Users,
  GraduationCap,
  ClipboardList,
  BookOpen,
  CalendarCheck,
  FileText,
  Wallet,
  Banknote,
  TrendingUp,
  MessageSquare,
  Settings,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

// Staff still points at a page that doesn't exist yet — the nav shell
// doesn't need to wait for every module to be built before it's wired in.
export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: GraduationCap },
  { label: "Admissions", href: "/admissions", icon: ClipboardList },
  { label: "Academics", href: "/academics", icon: BookOpen },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Exams", href: "/exams", icon: FileText },
  { label: "Staff", href: "/staff", icon: Users },
  { label: "Finance", href: "/finance", icon: Wallet },
  { label: "Payroll", href: "/payroll", icon: Banknote },
  { label: "Performance", href: "/performance", icon: TrendingUp },
  { label: "Communication", href: "/communication", icon: MessageSquare },
  { label: "Settings", href: "/settings", icon: Settings },
];
