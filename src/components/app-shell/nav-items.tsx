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
  NotebookPen,
  Users2,
  Building2,
  HeartPulse,
  ShieldAlert,
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
  { label: "Homework", href: "/homework", icon: NotebookPen },
  { label: "Discipline & Welfare", href: "/discipline", icon: ShieldAlert },
  { label: "Staff", href: "/staff", icon: Users },
  { label: "Finance", href: "/finance", icon: Wallet },
  { label: "Payroll", href: "/payroll", icon: Banknote },
  { label: "Library", href: "/library", icon: Library },
  { label: "Transport", href: "/transport", icon: Bus },
  { label: "Boarding", href: "/boarding", icon: BedDouble },
  { label: "Health", href: "/health", icon: HeartPulse },
  { label: "Inventory", href: "/inventory", icon: Package },
  { label: "Performance", href: "/performance", icon: TrendingUp },
  { label: "PT Meetings", href: "/pt-meetings", icon: Users2 },
  { label: "Communication", href: "/communication", icon: MessageSquare },
  { label: "Trimora AI", href: "/ai", icon: Sparkles },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Campuses", href: "/campuses", icon: Building2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

