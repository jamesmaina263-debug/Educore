import {
  Bell,
  BookOpen,
  Building2,
  Calendar,
  ChevronDown,
  CircleAlert,
  FileText,
  House,
  Menu,
  Search,
  ShieldCheck,
  Tag,
  UserRound,
  Users,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The marketing site's signature element (see Phase 2 design plan).
// Deliberately two-toned: the outer "stage" (browser chrome, gold rim-light,
// navy backdrop) is marketing art -- it exists to frame and present. The
// inner content strictly reuses the app's real design tokens (--primary blue,
// --success, --border, --muted, ...) so what's shown is the actual EduCore
// visual language, not an invented mockup. This is how the design plan keeps
// the brief's "never invent products or capabilities" rule honest at the
// pixel level, not just the copy level.
//
// Content: the Finance Dashboard (Bursar view) in its empty/zero state. The
// school name stays "Northgate Academy" -- the illustrative tenant used
// across the marketing site.

const NAV_MAIN = [
  { label: "Dashboard", icon: House },
  { label: "Admissions", icon: UserRound },
  { label: "Academics", icon: BookOpen },
  { label: "Students", icon: Users },
  { label: "Staff", icon: Users },
];

const NAV_FINANCE = [
  "Dashboard",
  "Student Accounts",
  "Fee Structures",
  "Invoicing",
  "Payments",
  "Receivables",
  "Discounts & Waivers",
  "Finance Reports",
  "Configuration",
];

const KPIS = [
  {
    label: "Invoiced this term",
    caption: "Total invoiced",
    icon: FileText,
    iconClass: "bg-info-subtle text-info",
    valueClass: "text-foreground",
  },
  {
    label: "Collected",
    caption: "Total collected",
    icon: Download,
    iconClass: "bg-success-subtle text-success",
    valueClass: "text-foreground",
  },
  {
    label: "Discounted",
    caption: "Total discounted",
    icon: Tag,
    iconClass: "bg-warning-subtle text-warning",
    valueClass: "text-foreground",
  },
  {
    label: "Outstanding",
    caption: "Total outstanding",
    icon: CircleAlert,
    iconClass: "bg-destructive-subtle text-destructive",
    valueClass: "text-destructive",
  },
];

const SUMMARY = [
  { label: "Collected", dot: "bg-success" },
  { label: "Outstanding", dot: "bg-destructive" },
  { label: "Discounted", dot: "bg-warning" },
  { label: "Waived", dot: "bg-info" },
];

const AGEING = [
  { label: "0 - 30 Days", tone: "text-success" },
  { label: "31 - 60 Days", tone: "text-warning" },
  { label: "61 - 90 Days", tone: "text-warning" },
  { label: "90+ Days", tone: "text-destructive" },
];

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-[11px] font-semibold text-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function PanelButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[9px] text-foreground">
      {children}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof FileText;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-3 py-5 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-2 text-[11px] font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

export function DashboardFrame({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl bg-marketing-navy-900 p-2 shadow-2xl",
        "ring-1 ring-marketing-gold-500/30",
        className,
      )}
    >
      {/* Rim-light: a thin gold gradient hairline, not a filled border --
          "restrained", per the brief. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--brand-gold-500) 35%, transparent), transparent 40%)",
          mixBlendMode: "screen",
        }}
      />

      <div className="overflow-hidden rounded-xl bg-white">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 border-b border-border bg-secondary px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/25" />
          <span className="ml-3 font-mono text-[11px] text-muted-foreground">
            app.educore.io/finance/dashboard
          </span>
        </div>

        {/* Reconstructed Finance Dashboard -- real tokens, decorative only. */}
        <div className="flex bg-background" aria-hidden="true">
          {/* Sidebar */}
          <aside className="hidden w-[132px] shrink-0 flex-col bg-marketing-navy-900 py-3 text-white sm:flex">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 pb-3">
              <ShieldCheck className="h-6 w-6 shrink-0 text-white" />
              <div className="min-w-0">
                <p className="truncate text-[11px] font-semibold leading-tight">
                  Northgate Academy
                </p>
                <p className="truncate text-[7px] leading-tight text-white/60">
                  School Management System
                </p>
              </div>
            </div>

            <p className="px-3 pt-3 text-[7px] font-semibold tracking-wider text-white/50">
              MAIN
            </p>
            <ul className="mt-1 space-y-0.5 px-1.5">
              {NAV_MAIN.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px] text-white/85"
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  {label}
                </li>
              ))}
            </ul>

            <p className="px-3 pt-3 text-[7px] font-semibold tracking-wider text-white/50">
              FINANCE
            </p>
            <ul className="mt-1 space-y-0.5 px-1.5">
              {NAV_FINANCE.map((label, i) => (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px]",
                    i === 0
                      ? "bg-primary font-medium text-primary-foreground"
                      : "text-white/80",
                  )}
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-70" />
                  <span className="truncate">{label}</span>
                </li>
              ))}
            </ul>
          </aside>

          {/* Main */}
          <div className="min-w-0 flex-1 p-3">
            {/* Top bar */}
            <div className="flex items-center gap-2">
              <Menu className="h-3.5 w-3.5 shrink-0 text-foreground" />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1">
                <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-[9px] text-muted-foreground">
                  Search students, staff, invoices...
                </span>
              </div>
              <span className="hidden items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[9px] text-foreground md:inline-flex">
                <Calendar className="h-3 w-3" /> Term 3, 2025
              </span>
              <span className="hidden items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[9px] text-foreground md:inline-flex">
                <Building2 className="h-3 w-3" /> Bursar Office
              </span>
              <span className="relative hidden sm:block">
                <Bell className="h-3.5 w-3.5 text-foreground" />
                <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-destructive" />
              </span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[7px] font-semibold text-primary-foreground">
                TO
              </span>
            </div>

            {/* Page header */}
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-foreground">Finance Dashboard</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  Home &rsaquo; Finance &rsaquo; Dashboard
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-[9px] font-medium text-primary-foreground">
                Generate Report <ChevronDown className="h-3 w-3" />
              </span>
            </div>

            {/* KPI cards */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KPIS.map(({ label, caption, icon: Icon, iconClass, valueClass }) => (
                <div
                  key={label}
                  className="rounded-lg border border-border bg-card p-2"
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-[8px] font-medium uppercase leading-tight text-foreground">
                      {label}
                    </p>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                        iconClass,
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                  </div>
                  <p className={cn("mt-1 font-mono text-sm font-semibold", valueClass)}>
                    KES 0
                  </p>
                  <p className="mt-0.5 text-[8px] text-muted-foreground">{caption}</p>
                </div>
              ))}
            </div>

            {/* Activity + collection summary */}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Panel title="Recent Financial Activities" action={<PanelButton>View all</PanelButton>}>
                <EmptyState
                  icon={FileText}
                  title="No recent activities"
                  hint="Financial transactions and activities will appear here."
                />
              </Panel>

              <Panel
                title="Fee Collection Summary"
                action={
                  <PanelButton>
                    This Term <ChevronDown className="h-2.5 w-2.5" />
                  </PanelButton>
                }
              >
                <div className="flex items-center gap-3 p-3">
                  <div className="relative h-16 w-16 shrink-0">
                    <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="26"
                        fill="none"
                        strokeWidth="10"
                        className="stroke-secondary"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <p className="font-mono text-[9px] font-semibold text-foreground">
                        KES 0
                      </p>
                      <p className="text-[7px] text-muted-foreground">Total</p>
                    </div>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1">
                    {SUMMARY.map(({ label, dot }) => (
                      <li key={label} className="flex items-center gap-1.5 text-[8px]">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
                        <span className="flex-1 truncate text-foreground">{label}</span>
                        <span className="font-mono text-muted-foreground">KES 0 (0%)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            </div>

            {/* Ageing + top outstanding */}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Panel title="Outstanding by Age" action={<PanelButton>View Details</PanelButton>}>
                <ul className="divide-y divide-border px-3 text-[9px]">
                  {AGEING.map(({ label, tone }) => (
                    <li key={label} className="flex items-center justify-between py-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={cn("font-mono font-semibold", tone)}>KES 0</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between py-1.5 font-semibold">
                    <span className="text-foreground">Total Outstanding</span>
                    <span className="font-mono text-destructive">KES 0</span>
                  </li>
                </ul>
              </Panel>

              <Panel title="Top Outstanding Students" action={<PanelButton>View All</PanelButton>}>
                <EmptyState
                  icon={Users}
                  title="No outstanding accounts"
                  hint="Student outstanding accounts will appear here."
                />
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
