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
  Library,
  Bus,
  BedDouble,
  Package,
  MessageSquare,
  Settings,
  Sparkles,
  BarChart3,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

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
  { label: "Library", href: "/library", icon: Library },
  { label: "Transport", href: "/transport", icon: Bus },
  { label: "Hostel", href: "/hostel", icon: BedDouble },
  { label: "Inventory", href: "/inventory", icon: Package },
  { label: "Performance", href: "/performance", icon: TrendingUp },
  { label: "Communication", href: "/communication", icon: MessageSquare },
  { label: "Trimora AI", href: "/ai", icon: Sparkles },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Settings", href: "/settings", icon: Settings },
];
