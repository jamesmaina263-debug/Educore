import {
  LayoutDashboard,
  Users,
  GraduationCap,
  ClipboardList,
  BookOpen,
  CalendarCheck,
  FileText,
  FileDown,
  Wallet,
  Banknote,
  TrendingUp,
  Library,
  Bus,
  BedDouble,
  Package,  MessageSquare, Mail, Megaphone,
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
  BellRing,
  Tag,
  SlidersHorizontal,
  CalendarRange,
  School,
  UserCog,
  BookMarked,
  CalendarClock,
  RotateCcw,
  Building,
  Bed,
  ArrowLeftRight,
  Siren,
  ClipboardCheck,
  Stethoscope,
  Pill,
  Ambulance,
  Boxes,
  Handshake,
  ShoppingCart,
  FileSpreadsheet,
  Scale,
  Gavel,
  HeartHandshake,
  ShieldCheck,
  Wrench,
  BookCopy,
  BookOpenCheck,
  CoinsIcon,
  Bell,
  KeyRound,
  History,
  Palette,
  Landmark,
  Smartphone,
  Fingerprint,
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

const financeChildren: NavChild[] = [
  { label: "Dashboard", href: "/finance/dashboard", icon: Gauge },
  { label: "Student Accounts", href: "/finance/student-accounts", icon: Wallet2 },
  { label: "Fee Structures", href: "/finance/fee-structures", icon: FileStack },
  { label: "Invoicing", href: "/finance/invoicing", icon: Receipt },
  { label: "Payments", href: "/finance/payments", icon: CircleDollarSign },
  { label: "Reconciliation", href: "/finance/reconciliation", icon: ArrowLeftRight },
  { label: "Receivables", href: "/finance/receivables", icon: AlertTriangle },
  { label: "Discounts & Waivers", href: "/finance/discounts-waivers", icon: Tag },
  { label: "Fee Alerts", href: "/finance/fee-alerts", icon: BellRing },
  { label: "Finance Reports", href: "/finance/reports", icon: BarChart3 },
  { label: "Configuration", href: "/finance/configuration", icon: SlidersHorizontal },
];

const academicsChildren: NavChild[] = [
  { label: "Years & Terms", href: "/academics/years-terms", icon: CalendarRange },
  { label: "Classes & Streams", href: "/academics/classes-streams", icon: School },
  { label: "Teacher Allocation", href: "/academics/teacher-allocation", icon: UserCog },
  { label: "Subjects", href: "/academics/subjects", icon: BookMarked },
  { label: "Timetable", href: "/academics/timetable", icon: CalendarClock },
  { label: "Newsletters", href: "/academics/newsletters", icon: Mail },
  { label: "Rollover", href: "/academics/rollover", icon: RotateCcw },
];

const boardingChildren: NavChild[] = [
  { label: "Dashboard", href: "/boarding/dashboard", icon: Gauge },
  { label: "Structure", href: "/boarding/structure", icon: Building },
  { label: "Allocation", href: "/boarding/allocation", icon: Bed },
  { label: "Roll Call", href: "/boarding/roll-call", icon: ClipboardCheck },
  { label: "Transfers", href: "/boarding/transfers", icon: ArrowLeftRight },
  { label: "Incidents", href: "/boarding/incidents", icon: Siren },
  { label: "Reports", href: "/boarding/reports", icon: BarChart3 },
];

const healthChildren: NavChild[] = [
  { label: "Dashboard", href: "/health/dashboard", icon: Gauge },
  { label: "Medical Records", href: "/health/records", icon: FileText },
  { label: "Sick Bay", href: "/health/sick-bay", icon: Stethoscope },
  { label: "Medication", href: "/health/medication", icon: Pill },
  { label: "Referrals", href: "/health/referrals", icon: ShieldCheck },
  { label: "Emergencies", href: "/health/emergencies", icon: Ambulance },
  { label: "Inventory", href: "/health/inventory", icon: Boxes },
  { label: "Reports", href: "/health/reports", icon: BarChart3 },
];

const examsChildren: NavChild[] = [
  { label: "Overview", href: "/exams/overview", icon: Gauge },
  { label: "Marks", href: "/exams/marks", icon: ClipboardCheck },
  { label: "Report Cards", href: "/exams/report-cards", icon: BookOpenCheck },
  { label: "Grading Scales", href: "/exams/grading", icon: Scale },
];

const inventoryChildren: NavChild[] = [
  { label: "Stock", href: "/inventory/stock", icon: Boxes },
  { label: "Assets", href: "/inventory/assets", icon: Wrench },
  { label: "Suppliers", href: "/inventory/suppliers", icon: Handshake },
  { label: "Procurement", href: "/inventory/procurement", icon: ShoppingCart },
  { label: "Supplier Invoices", href: "/inventory/invoices", icon: FileSpreadsheet },
];

const disciplineChildren: NavChild[] = [
  { label: "Incidents", href: "/discipline/incidents", icon: Siren },
  { label: "Cases", href: "/discipline/cases", icon: Gavel },
  { label: "Welfare", href: "/discipline/welfare", icon: HeartHandshake },
  { label: "Safeguarding", href: "/discipline/safeguarding", icon: ShieldCheck },
];

const payrollChildren: NavChild[] = [
  { label: "Payroll Runs", href: "/payroll/runs", icon: Banknote },
  { label: "Salary Structures", href: "/payroll/structures", icon: CoinsIcon },
];

const libraryChildren: NavChild[] = [
  { label: "Catalogue & Loans", href: "/library/catalogue", icon: BookCopy },
  { label: "Shelves", href: "/library/shelves", icon: BookOpenCheck },
  { label: "Reservations", href: "/library/reservations", icon: ClipboardList },
  { label: "Fines", href: "/library/fines", icon: CoinsIcon },
];

const campusesChildren: NavChild[] = [
  { label: "Overview", href: "/campuses/overview", icon: Gauge },
  { label: "Branding", href: "/campuses/branding", icon: Palette },
  { label: "API Keys", href: "/campuses/api-keys", icon: KeyRound },
];

const integrationsChildren: NavChild[] = [
  { label: "NEMIS", href: "/integrations/nemis", icon: Landmark },
  { label: "M-Pesa", href: "/integrations/mpesa", icon: Smartphone },
];

const settingsChildren: NavChild[] = [
  { label: "General", href: "/settings/general", icon: Settings },
  { label: "Branding", href: "/settings/branding", icon: Palette },
  { label: "Admission Form", href: "/settings/admission-form", icon: FileText },
  { label: "Users & Roles", href: "/settings/staff", icon: Users },
  { label: "Permission Requests", href: "/settings/permission-requests", icon: ShieldCheck },
  { label: "Leave Types", href: "/settings/leave-types", icon: CalendarClock },
  { label: "Billing", href: "/settings/billing", icon: CoinsIcon },
  { label: "Notifications", href: "/settings/notifications", icon: Bell },
  { label: "API Keys", href: "/settings/api-keys", icon: KeyRound },
  { label: "Biometric Devices", href: "/settings/biometric-devices", icon: Fingerprint },
  { label: "Biometric Events", href: "/settings/biometric-events", icon: History },
  { label: "Audit Log", href: "/settings/audit", icon: History },
  { label: "Data Export", href: "/settings/data-export", icon: FileDown },
];

export const navGroups: NavGroup[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Admissions", href: "/admissions", icon: ClipboardList },
      { label: "Academics", href: "/academics", icon: BookOpen, children: academicsChildren },
      { label: "Students", href: "/students", icon: GraduationCap },
      { label: "Parents", href: "/parents", icon: Handshake },
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
      { label: "Exams", href: "/exams", icon: FileText, children: examsChildren },
      { label: "Homework", href: "/homework", icon: NotebookPen },
      { label: "Discipline & Welfare", href: "/discipline", icon: ShieldAlert, children: disciplineChildren },
      { label: "Payroll", href: "/payroll", icon: Banknote, children: payrollChildren },
      { label: "Library", href: "/library", icon: Library, children: libraryChildren },
      { label: "Transport", href: "/transport", icon: Bus },
      { label: "Boarding", href: "/boarding", icon: BedDouble, children: boardingChildren },
      { label: "Health", href: "/health", icon: HeartPulse, children: healthChildren },
      { label: "Inventory & Procurement", href: "/inventory", icon: Package, children: inventoryChildren },
      { label: "Performance", href: "/performance", icon: TrendingUp },
      { label: "PT Meetings", href: "/pt-meetings", icon: Users2 },
      { label: "Connect", href: "/connect", icon: Mail },
      { label: "Announcements", href: "/announcements", icon: Megaphone },
      { label: "Communication", href: "/communication", icon: MessageSquare },
      { label: "Educore AI", href: "/ai", icon: Sparkles },
      { label: "Reports", href: "/reports", icon: BarChart3 },
      { label: "Campuses", href: "/campuses", icon: Building2, children: campusesChildren },
      { label: "Integrations", href: "/integrations", icon: Landmark, children: integrationsChildren },
      { label: "Settings", href: "/settings", icon: Settings, children: settingsChildren },
    ],
  },
];

// Flat list retained for callers that only need a plain lookup (e.g. command palette).
export const navItems: (NavItem | NavChild)[] = navGroups.flatMap((g) =>
  g.items.flatMap((item) => [item, ...(item.children ?? [])]),
);
