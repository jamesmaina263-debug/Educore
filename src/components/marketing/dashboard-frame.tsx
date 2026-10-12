import {
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Download,
  FileText,
  Menu,
  Search,
  ShieldCheck,
  Tag,
  Users,
} from "lucide-react";
import { navGroups } from "@/components/app-shell/nav-items";
import { ScaledStage } from "@/components/marketing/scaled-stage";
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
// Content: the Finance Dashboard (Bursar view) for the illustrative tenant
// "Northgate Academy". The sidebar is rendered from the app's own `navGroups`
// (the same source the real app shell uses), so every module that exists in
// EduCore is shown here and the preview can't drift out of date. The figures
// are illustrative and internally consistent:
//   invoiced 4.9M = collected 4.1M + outstanding 620K + discounted 150K + waived 30K

// Width the dashboard is laid out at (a typical desktop app window). It is
// scaled down to fit the hero, never reflowed -- see ScaledStage.
const DESIGN_WIDTH = 900;

const CURRENT_TERM = "Term 3, 2026";

const mainGroup = navGroups.find((g) => g.label === "Main");
const financeGroup = navGroups.find((g) => g.label === "Finance");
const otherGroup = navGroups.find((g) => g.label === "Other");
const financeChildren = financeGroup?.items[0]?.children ?? [];

const STATS = [
  { label: "Students", value: "812", tone: "text-foreground" },
  { label: "Attendance today", value: "96.2%", tone: "text-success" },
  { label: "Open admissions", value: "23", tone: "text-warning" },
];

const KPIS = [
  {
    label: "Invoiced this term",
    value: "KES 4.9M",
    caption: "Total invoiced",
    icon: FileText,
    iconClass: "bg-info-subtle text-info",
    valueClass: "text-foreground",
  },
  {
    label: "Collected",
    value: "KES 4.1M",
    caption: "Total collected",
    icon: Download,
    iconClass: "bg-success-subtle text-success",
    valueClass: "text-info",
  },
  {
    label: "Discounted",
    value: "KES 150K",
    caption: "Total discounted",
    icon: Tag,
    iconClass: "bg-warning-subtle text-warning",
    valueClass: "text-foreground",
  },
  {
    label: "Outstanding",
    value: "KES 620K",
    caption: "Total outstanding",
    icon: CircleAlert,
    iconClass: "bg-destructive-subtle text-destructive",
    valueClass: "text-destructive",
  },
];

// pct values are shares of the KES 4.9M invoiced total and sum to 100.
const SUMMARY = [
  { label: "Collected", amount: "KES 4.1M", pct: 83.7, dot: "bg-success", stroke: "stroke-success" },
  { label: "Outstanding", amount: "KES 620K", pct: 12.6, dot: "bg-destructive", stroke: "stroke-destructive" },
  { label: "Discounted", amount: "KES 150K", pct: 3.1, dot: "bg-warning", stroke: "stroke-warning" },
  { label: "Waived", amount: "KES 30K", pct: 0.6, dot: "bg-info", stroke: "stroke-info" },
];

const AGEING = [
  { label: "0 - 30 Days", amount: "KES 310K", tone: "text-success" },
  { label: "31 - 60 Days", amount: "KES 180K", tone: "text-warning" },
  { label: "61 - 90 Days", amount: "KES 90K", tone: "text-warning" },
  { label: "90+ Days", amount: "KES 40K", tone: "text-destructive" },
];

const ACTIVITIES = [
  { text: "M-Pesa payment received", meta: "Grade 7 · 2 min ago", amount: "KES 45,000", dot: "bg-success" },
  { text: "Payment reconciled", meta: "Grade 5 · 18 min ago", amount: "KES 22,000", dot: "bg-info" },
  { text: "Invoice generated", meta: "Form 2 · 1 hr ago", amount: "KES 38,500", dot: "bg-primary" },
  { text: "Waiver approved", meta: "Grade 8 · 3 hrs ago", amount: "KES 10,000", dot: "bg-warning" },
];

const TOP_OUTSTANDING = [
  { name: "Brian Otieno", cls: "Grade 8", amount: "KES 48,500" },
  { name: "Mercy Wanjiru", cls: "Grade 6", amount: "KES 41,200" },
  { name: "Kevin Mutua", cls: "Form 2", amount: "KES 36,000" },
];

const TERM_BARS = [38, 52, 47, 61, 58, 74];

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function PanelButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground">
      {children}
    </span>
  );
}

function NavRow({
  label,
  icon: Icon,
  hasChildren,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hasChildren: boolean;
}) {
  return (
    <li className="flex items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-[11px] text-white/85">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {hasChildren ? <ChevronRight className="h-3 w-3 shrink-0 text-white/50" /> : null}
    </li>
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
          <span className="ml-3 truncate font-mono text-[11px] text-muted-foreground">
            app.educore.io/finance/dashboard
          </span>
        </div>

        {/* Finance Dashboard at a fixed desktop width, scaled to fit. */}
        <ScaledStage designWidth={DESIGN_WIDTH}>
          <div className="flex bg-background" aria-hidden="true">
            {/* Sidebar -- rendered from the app's real navGroups. */}
            <aside className="flex w-[190px] shrink-0 flex-col bg-marketing-navy-900 py-4 text-white">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 pb-4">
                <ShieldCheck className="h-8 w-8 shrink-0 text-white" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-tight">
                    Northgate Academy
                  </p>
                  <p className="truncate text-[9px] leading-tight text-white/60">
                    School Management System
                  </p>
                </div>
              </div>

              <p className="px-4 pt-3 text-[9px] font-semibold tracking-wider text-white/50">
                MAIN
              </p>
              <ul className="mt-1 px-2">
                {mainGroup?.items.map((item) => (
                  <NavRow
                    key={item.label}
                    label={item.label}
                    icon={item.icon}
                    hasChildren={Boolean(item.children)}
                  />
                ))}
              </ul>

              <p className="px-4 pt-3 text-[9px] font-semibold tracking-wider text-white/50">
                FINANCE
              </p>
              <ul className="mt-1 px-2">
                {financeChildren.map(({ label }, i) => (
                  <li
                    key={label}
                    className={cn(
                      "flex items-center gap-2 whitespace-nowrap rounded px-2 py-1 text-[11px]",
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

              <p className="px-4 pt-3 text-[9px] font-semibold tracking-wider text-white/50">
                OTHER
              </p>
              <ul className="mt-1 px-2">
                {otherGroup?.items.map((item) => (
                  <NavRow
                    key={item.label}
                    label={item.label}
                    icon={item.icon}
                    hasChildren={Boolean(item.children)}
                  />
                ))}
              </ul>
            </aside>

            {/* Main */}
            <div className="min-w-0 flex-1 p-4">
              {/* Top bar */}
              <div className="flex items-center gap-3">
                <Menu className="h-4 w-4 shrink-0 text-foreground" />
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs text-muted-foreground">
                    Search students, staff, invoices...
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground">
                  <Calendar className="h-3.5 w-3.5" /> {CURRENT_TERM}
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground">
                  <Building2 className="h-3.5 w-3.5" /> Bursar Office
                </span>
                <span className="relative">
                  <Bell className="h-4 w-4 text-foreground" />
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
                </span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  TO
                </span>
              </div>

              {/* Page header */}
              <div className="mt-5 flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold text-foreground">Finance Dashboard</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Home &rsaquo; Finance &rsaquo; Dashboard
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground">
                  Generate Report <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </div>

              {/* Snapshot stats */}
              <div className="mt-4 grid grid-cols-3 gap-3">
                {STATS.map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className={cn("mt-1 font-mono text-xl font-semibold", stat.tone)}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* KPI cards */}
              <div className="mt-3 grid grid-cols-4 gap-3">
                {KPIS.map(({ label, value, caption, icon: Icon, iconClass, valueClass }) => (
                  <div key={label} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[10px] font-medium uppercase leading-tight text-foreground">
                        {label}
                      </p>
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                          iconClass,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className={cn("mt-2 font-mono text-xl font-semibold", valueClass)}>
                      {value}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{caption}</p>
                  </div>
                ))}
              </div>

              {/* Activity + collection summary */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Panel
                  title="Recent Financial Activities"
                  action={<PanelButton>View all</PanelButton>}
                >
                  <ul className="divide-y divide-border px-4">
                    {ACTIVITIES.map(({ text, meta, amount, dot }) => (
                      <li key={text} className="flex items-center gap-3 py-2.5">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{text}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{meta}</p>
                        </div>
                        <span className="whitespace-nowrap font-mono text-[11px] text-foreground">
                          {amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>

                <Panel
                  title="Fee Collection Summary"
                  action={
                    <PanelButton>
                      This Term <ChevronDown className="h-3 w-3" />
                    </PanelButton>
                  }
                >
                  <div className="flex items-center gap-4 p-4">
                    <div className="relative h-24 w-24 shrink-0">
                      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
                        <circle
                          cx="32"
                          cy="32"
                          r="26"
                          fill="none"
                          strokeWidth="10"
                          className="stroke-secondary"
                        />
                        {SUMMARY.map((seg, i) => {
                          const offset = SUMMARY.slice(0, i).reduce((n, x) => n + x.pct, 0);
                          return (
                            <circle
                              key={seg.label}
                              cx="32"
                              cy="32"
                              r="26"
                              fill="none"
                              strokeWidth="10"
                              pathLength={100}
                              strokeDasharray={`${seg.pct} ${100 - seg.pct}`}
                              strokeDashoffset={-offset}
                              className={seg.stroke}
                            />
                          );
                        })}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <p className="font-mono text-xs font-semibold text-foreground">KES 4.9M</p>
                        <p className="text-[10px] text-muted-foreground">Total</p>
                      </div>
                    </div>
                    <ul className="min-w-0 flex-1 space-y-2">
                      {SUMMARY.map(({ label, amount, pct, dot }) => (
                        <li key={label} className="flex items-center gap-2 text-[11px]">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
                          <span className="flex-1 truncate text-foreground">{label}</span>
                          <span className="whitespace-nowrap font-mono text-muted-foreground">
                            {amount} ({pct}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Panel>
              </div>

              {/* Ageing + top outstanding */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Panel title="Outstanding by Age" action={<PanelButton>View Details</PanelButton>}>
                  <ul className="divide-y divide-border px-4 text-xs">
                    {AGEING.map(({ label, amount, tone }) => (
                      <li key={label} className="flex items-center justify-between py-2.5">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={cn("font-mono font-semibold", tone)}>{amount}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between py-2.5 font-semibold">
                      <span className="text-foreground">Total Outstanding</span>
                      <span className="font-mono text-destructive">KES 620K</span>
                    </li>
                  </ul>
                </Panel>

                <Panel
                  title="Top Outstanding Students"
                  action={<PanelButton>View All</PanelButton>}
                >
                  <ul className="divide-y divide-border px-4">
                    {TOP_OUTSTANDING.map(({ name, cls, amount }) => (
                      <li key={name} className="flex items-center gap-3 py-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                          <Users className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{name}</p>
                          <p className="text-[10px] text-muted-foreground">{cls}</p>
                        </div>
                        <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-destructive">
                          {amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>

              {/* Collection trend */}
              <div className="mt-3 rounded-lg border border-border bg-card p-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Fee collection — last 6 terms
                </p>
                <div className="flex h-20 items-end gap-2">
                  {TERM_BARS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-primary/70"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </ScaledStage>
      </div>
    </div>
  );
}
