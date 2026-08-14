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
  Gauge,
  Wallet2,
  Receipt,
  FileStack,
  CircleDollarSign,
  AlertTriangle,
  Tag,
  SlidersHorizontal,
} from "lucide-react";

export interface NavChild {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

export interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const financeChildren: NavChild[] = [
  { label: "Dashboard", href: "/finance/dashboard", icon: Gauge },
  { label: "Student Accounts", href: "/finance/student-accounts", icon: Wallet2 },
  { label: "Fee Structures", href: "/finance/fee-structures", icon: FileStack },
  { label: "Invoicing", href: "/finance/invoicing", icon: Receipt },
  { label: "Payments", href: "/finance/payments", icon: CircleDollarSign },
  { label: "Receivables", href: "/finance/receivables", icon: AlertTriangle },
  { label: "Discounts & Waivers", href: "/finance/discounts-waivers", icon: Tag },
  { label: "Finance Reports", href: "/finance/reports", icon: BarChart3 },
  { label: "Configuration", href: "/finance/configuration", icon: SlidersHorizontal },
];

export const navGroups: NavGroup[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Admissions", href: "/admissions", icon: ClipboardList },
      { label: "Academics", href: "/academics", icon: BookOpen },
      { label: "Students", href: "/students", icon: GraduationCap },
      { label: "Staff", href: "/staff", icon: Users },
    ],
  },
  {
    label: "Finance",
    items: [{ label: "Finance", href: "/finance", icon: Wallet, children: financeChildren }],
  },
  {
    label: "Other",
    items: [
      { label: "Attendance", href: "/attendance", icon: CalendarCheck },
      { label: "Exams", href: "/exams", icon: FileText },
      { label: "Homework", href: "/homework", icon: NotebookPen },
      { label: "Discipline & Welfare", href: "/discipline", icon: ShieldAlert },
      { label: "Payroll", href: "/payroll", icon: Banknote },
      { label: "Library", href: "/library", icon: Library },
      { label: "Transport", href: "/transport", icon: Bus },
      { label: "Boarding", href: "/boarding", icon: BedDouble },
      { label: "Health", href: "/health", icon: HeartPulse },
      { label: "Inventory", href: "/inventory", icon: Package },
      { label: "Performance", href: "/performance", icon: TrendingUp },
      { label: "PT Meetings", href: "/pt-meetings", icon: Users2 },
      { label: "Communication", href: "/communication", icon: MessageSquare },
      { label: "Educore AI", href: "/ai", icon: Sparkles },
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "Campuses", href: "/campuses", icon: Building2 },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

// Flat list retained for callers that only need a plain lookup (e.g. command palette).
export const navItems: (NavItem | NavChild)[] = navGroups.flatMap((g) =>
  g.items.flatMap((item) => [item, ...(item.children ?? [])]),
);
