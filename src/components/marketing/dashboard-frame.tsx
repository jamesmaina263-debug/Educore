import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarCheck,
  ChevronDown,
  CircleDollarSign,
  Database,
  Plus,
  Search,
  Users,
  Wallet,
} from "lucide-react";
import { navGroups } from "@/components/app-shell/nav-items";
import { ScaledStage } from "@/components/marketing/scaled-stage";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

// The marketing site's signature element (see Phase 2 design plan).
// Deliberately two-toned: the outer "stage" (browser chrome, gold rim-light,
// navy backdrop) is marketing art -- it exists to frame and present. The
// inner content is a faithful picture of the real EduCore app: the same
// sidebar (rendered from the app's own `navGroups`, so every module that
// exists is shown and the preview can't drift), the same top bar, and the
// same Dashboard page layout, built from the app's real design tokens and
// StatusBadge.
//
// It is a picture of the DESKTOP app, so it is laid out at a fixed desktop
// width and scaled down to fit (see ScaledStage) rather than reflowed.
//
// Figures are illustrative for the demo tenant "Northgate Academy" and are
// internally consistent:
//   invoiced 4,900,000 = weekly invoiced bars below; collected 4,100,000 =
//   weekly collected bars (83.7%); attendance 781 / 812 = 96.2%.

const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 840; // 3:2 -- a laptop-screen screenshot

// Phones: scaling the whole 1280px window down to ~330px makes every label
// ~4px and unreadable. Below COMPACT.below px the stage instead shows a
// narrower, taller crop (no sidebar, 2x2 KPI cards, fee chart only) that is
// scaled far less, so the headline figures stay legible.
const COMPACT = { below: 640, width: 520, height: 760 };
// Tablets (640-1023px): keep the full dashboard (KPIs, operations, charts)
// but drop the 256px sidebar and lay out at 900px instead of 1280px, so the
// scale is ~0.65-1.0 instead of ~0.45-0.75.
const TABLET = { below: 1024, width: 900, height: 750 };

const SCHOOL = "Northgate Academy";
const TERM = "Term 3, 2026";

const METRICS = [
  {
    label: "Enrolled students",
    value: "812",
    delta: "+46",
    up: true,
    note: `admitted ${TERM}`,
    icon: Users,
    iconClass: "bg-info-subtle text-info",
  },
  {
    label: "Fees collected (term)",
    value: "KES 4,100,000",
    delta: "83.7%",
    up: true,
    note: "of KES 4,900,000 invoiced",
    icon: CircleDollarSign,
    iconClass: "bg-success-subtle text-success",
  },
  {
    label: "Attendance today",
    value: "96.2%",
    delta: "On target",
    up: true,
    note: "781 of 812 present",
    icon: CalendarCheck,
    iconClass: "bg-violet-500/10 text-violet-600",
  },
  {
    label: "Outstanding balance",
    value: "KES 620,000",
    delta: "64 students",
    up: false,
    note: "with a balance owing",
    icon: Database,
    iconClass: "bg-destructive-subtle text-destructive",
  },
];

const OPERATIONS = [
  { label: "Boarding beds available", value: "46 / 240", note: "1 dormitory at capacity" },
  { label: "Sick bay right now", value: "2", note: "students checked in" },
  { label: "Inventory alerts", value: "3", note: "items at/below reorder level" },
  { label: "Transport fleet", value: "9", note: "1 route full" },
  { label: "Staff attendance today", value: "94%", note: "47 of 50 marked present" },
  { label: "Open discipline cases", value: "4", note: "open/investigating/pending action" },
];

// KES thousands. Sums: invoiced 4,900 ; collected 4,100.
const COLLECTION = [
  { week: "Wk 1", collected: 1850, invoiced: 2900 },
  { week: "Wk 2", collected: 720, invoiced: 640 },
  { week: "Wk 3", collected: 560, invoiced: 480 },
  { week: "Wk 4", collected: 410, invoiced: 380 },
  { week: "Wk 5", collected: 280, invoiced: 260 },
  { week: "Wk 6", collected: 150, invoiced: 140 },
  { week: "Wk 7", collected: 80, invoiced: 60 },
  { week: "Wk 8", collected: 50, invoiced: 40 },
];

// Mean = 96.2%.
const ATTENDANCE = [
  { classroom: "Grade 7A", rate: 98 },
  { classroom: "Grade 7B", rate: 97 },
  { classroom: "Grade 8A", rate: 95 },
  { classroom: "Grade 8B", rate: 96 },
  { classroom: "Form 1", rate: 97 },
  { classroom: "Form 2", rate: 94 },
];

const ENROLLMENT = [
  { term: "T2 '25", students: 731 },
  { term: "T3 '25", students: 748 },
  { term: "T1 '26", students: 779 },
  { term: "T2 '26", students: 797 },
  { term: "T3 '26", students: 812 },
];

const TASKS = [
  {
    label: "3 of 24 classes haven't submitted attendance",
    owner: "Class teachers",
    tone: "danger" as const,
    badge: "Overdue",
  },
  {
    label: "KES 130,000 overdue beyond 60 days",
    owner: "Bursar office",
    tone: "danger" as const,
    badge: "Overdue",
  },
  {
    label: "1 transport route is full",
    owner: "Transport office",
    tone: "info" as const,
    badge: "Full",
  },
  {
    label: "4 open disciplinary cases",
    owner: "Discipline & Welfare office",
    tone: "warning" as const,
    badge: "Open",
  },
];

const INVOICES = [
  { student: "Mercy Wanjiru", amount: "KES 38,500", status: "paid", tone: "success" as const },
  { student: "Kevin Mutua", amount: "KES 42,000", status: "partially paid", tone: "warning" as const },
  { student: "Faith Achieng", amount: "KES 36,000", status: "paid", tone: "success" as const },
  { student: "Brian Otieno", amount: "KES 48,500", status: "issued", tone: "info" as const },
  { student: "Amina Hassan", amount: "KES 41,200", status: "paid", tone: "success" as const },
];

function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel flex flex-col", className)}>
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-[0.8125rem] font-semibold">{title}</h2>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </header>
      <div className="flex-1 p-4">{children}</div>
    </section>
  );
}

// Same darker green as the other mock-up text (see the note above NavRow); StatusBadge itself is the
// shared app component and is deliberately not changed.
function mockupBadgeClass(tone: string): string | undefined {
  return tone === "success" ? "text-[#007633]" : undefined;
}

// NOTE: the green/amber/sidebar-label colours in this illustrative mock-up are hard-coded a notch
// darker than the app theme so the marketing page passes WCAG AA text contrast (4.5:1) on its white
// and tinted panels. The real app (and shared theme tokens) is unchanged.
function NavRow({
  label,
  icon: Icon,
  hasChildren,
  active,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hasChildren: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-[2.5px] text-sm font-medium leading-5",
        active ? "bg-sidebar-primary/10 text-[#006f30]" : "text-sidebar-foreground/80",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 whitespace-nowrap text-left">{label}</span>
      {hasChildren ? <ChevronDown className="size-3.5 shrink-0" /> : null}
    </div>
  );
}

/** Bar chart drawn with plain markup -- same look as the app's recharts charts. */
function BarChart({
  data,
  height = 170,
  max,
  ticks,
  format = (v: number) => String(v),
}: {
  data: { label: string; values: { v: number; color: string }[] }[];
  height?: number;
  max: number;
  ticks: number[];
  format?: (v: number) => string;
}) {
  return (
    <div className="flex gap-2" style={{ height: height + 22 }}>
      <div className="relative w-8 shrink-0" style={{ height }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute right-0 translate-y-1/2 text-xs text-muted-foreground"
            style={{ bottom: `${(t / max) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative flex items-end justify-around" style={{ height }}>
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 border-t border-border"
              style={{ bottom: `${(t / max) * 100}%` }}
            />
          ))}
          {data.map((group) => (
            <div key={group.label} className="relative z-10 flex items-end gap-0.5">
              {group.values.map((bar, i) => (
                <div key={i} className="flex flex-col items-center justify-end" style={{ height }}>
                  <span className="mb-0.5 text-xs text-foreground group-data-[compact=true]:hidden">{format(bar.v)}</span>
                  <div
                    className="w-3.5 rounded-t-sm"
                    style={{
                      height: `${(bar.v / max) * (height - 18)}px`,
                      background: bar.color,
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex justify-around pt-1.5">
          {data.map((group) => (
            <span key={group.label} className="text-xs text-muted-foreground">
              {group.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnrollmentChart() {
  const w = 300;
  const h = 150;
  const min = 700;
  const max = 840;
  const pts = ENROLLMENT.map((d, i) => {
    const x = 12 + (i * (w - 24)) / (ENROLLMENT.length - 1);
    const y = h - ((d.students - min) / (max - min)) * (h - 12) - 4;
    return { x, y, ...d };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h + 18}`} className="w-full">
      {[700, 740, 780, 820].map((t) => {
        const y = h - ((t - min) / (max - min)) * (h - 12) - 4;
        return (
          <g key={t}>
            <line x1="0" x2={w} y1={y} y2={y} stroke="var(--border)" />
            <text x="0" y={y - 3} fontSize="9" fill="var(--muted-foreground)">
              {t}
            </text>
          </g>
        );
      })}
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {pts.map((p) => (
        <text
          key={p.term}
          x={p.x}
          y={h + 14}
          fontSize="10"
          textAnchor="middle"
          fill="var(--muted-foreground)"
        >
          {p.term}
        </text>
      ))}
    </svg>
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
          <span className="ml-3 truncate font-mono text-xs text-muted-foreground">
            app.educore.io/dashboard
          </span>
        </div>

        {/* The real app shell + Dashboard page, at desktop width, scaled to fit. */}
        <ScaledStage
          designWidth={DESIGN_WIDTH}
          designHeight={DESIGN_HEIGHT}
          compact={COMPACT}
          tablet={TABLET}
        >
          <div className="flex h-full bg-background text-foreground" aria-hidden="true">
            {/* Sidebar -- every module, rendered from the real navGroups. */}
            <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar group-data-[compact=true]:hidden group-data-[tablet=true]:hidden">
              <div className="flex h-14 items-center border-b border-sidebar-border px-4 text-sm font-semibold text-sidebar-foreground">
                {SCHOOL}
              </div>
              <nav className="flex flex-col gap-2 p-2">
                {navGroups.map((group) => (
                  <div key={group.label} className="flex flex-col">
                    <p className="px-2.5 pb-0.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/70">
                      {group.label}
                    </p>
                    {group.items.map((item) => (
                      <NavRow
                        key={item.href}
                        label={item.label}
                        icon={item.icon}
                        hasChildren={Boolean(item.children?.length)}
                        active={item.href === "/dashboard"}
                      />
                    ))}
                  </div>
                ))}
              </nav>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* Top bar */}
              <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
                <div className="flex h-8 max-w-sm flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground">
                  <Search className="size-3.5" />
                  <span className="flex-1 text-left">Search…</span>
                  <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px]">
                    ⌘K
                  </kbd>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <span className="relative p-2">
                    <Bell className="size-4 text-foreground" />
                    <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
                  </span>
                  <span className="ml-1 flex items-center gap-2 p-1 pr-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      TO
                    </span>
                    <span className="text-sm font-medium">Thomas O.</span>
                  </span>
                </div>
              </header>

              {/* Dashboard page */}
              <main className="p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-lg font-semibold">Dashboard</h1>
                      <p className="text-sm text-muted-foreground">
                        {SCHOOL} · {TERM}
                      </p>
                    </div>
                    <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                      <Plus className="size-4" /> Record payment
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-3 group-data-[compact=true]:grid-cols-2">
                    {METRICS.map((m) => (
                      <div key={m.label} className="panel px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="label-eyebrow">{m.label}</p>
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-full",
                              m.iconClass,
                            )}
                          >
                            <m.icon className="size-4" />
                          </span>
                        </div>
                        <p
                          className="mt-1.5 whitespace-nowrap text-2xl font-semibold tracking-tight group-data-[compact=true]:text-xl group-data-[tablet=true]:text-xl"
                          data-numeric
                        >
                          {m.value}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                          <span
                            className={
                              m.up
                                ? "inline-flex items-center gap-0.5 font-medium text-[#007633]"
                                : "inline-flex items-center gap-0.5 font-medium text-[#a75e00]"
                            }
                          >
                            {m.up ? (
                              <ArrowUpRight className="size-3.5" />
                            ) : (
                              <ArrowDownRight className="size-3.5" />
                            )}
                            {m.delta}
                          </span>
                          {m.note}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="panel px-4 py-3 group-data-[compact=true]:hidden">
                    <p className="label-eyebrow mb-2">Operations</p>
                    <div className="grid grid-cols-6 gap-x-4 gap-y-3">
                      {OPERATIONS.map((op) => (
                        <div key={op.label}>
                          <p className="text-xs text-muted-foreground">{op.label}</p>
                          <p className="text-base font-semibold tracking-tight" data-numeric>
                            {op.value}
                          </p>
                          <p className="text-xs text-muted-foreground">{op.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 group-data-[compact=true]:grid-cols-1 group-data-[tablet=true]:grid-cols-1">
                    <div className="col-span-2 group-data-[compact=true]:col-span-1 group-data-[tablet=true]:col-span-1">
                      <Panel title="Fee collection vs. invoiced" meta="KES thousands · this term">
                        <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ background: "var(--chart-1)" }} />
                            Collected
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ background: "var(--chart-5)" }} />
                            Invoiced
                          </span>
                        </div>
                        <BarChart
                          max={3000}
                          ticks={[0, 1000, 2000, 3000]}
                          data={COLLECTION.map((d) => ({
                            label: d.week,
                            values: [
                              { v: d.collected, color: "var(--chart-1)" },
                              { v: d.invoiced, color: "var(--chart-5)" },
                            ],
                          }))}
                        />
                      </Panel>
                    </div>
                    <Panel title="Attendance rate by class" meta="Today" className="group-data-[compact=true]:hidden group-data-[tablet=true]:hidden">
                      <BarChart
                        max={100}
                        ticks={[0, 25, 50, 75, 100]}
                        format={(v) => `${v}%`}
                        data={ATTENDANCE.map((d) => ({
                          label: d.classroom.replace("Grade ", "Gr "),
                          values: [{ v: d.rate, color: "var(--chart-1)" }],
                        }))}
                      />
                    </Panel>
                  </div>

                  <div className="grid grid-cols-3 gap-3 group-data-[compact=true]:hidden">
                    <Panel title="Enrollment trend" meta="Last 5 terms">
                      <EnrollmentChart />
                    </Panel>

                    <Panel title="Requires your attention" meta={`${TASKS.length} items`}>
                      <ul className="-my-1 divide-y divide-border">
                        {TASKS.map((t) => (
                          <li key={t.label} className="flex items-start justify-between gap-3 py-2.5">
                            <div className="min-w-0">
                              <p className="truncate text-[0.8125rem] font-medium">{t.label}</p>
                              <p className="text-xs text-muted-foreground">{t.owner}</p>
                            </div>
                            <StatusBadge tone={t.tone} label={t.badge} className={mockupBadgeClass(t.tone)} />
                          </li>
                        ))}
                      </ul>
                    </Panel>

                    <Panel title="Latest invoices" meta={TERM}>
                      <div className="-mx-4 -my-4 overflow-hidden">
                        <table className="table-dense w-full">
                          <thead className="bg-muted/60">
                            <tr>
                              <th>Student</th>
                              <th className="text-right">Amount</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {INVOICES.map((inv) => (
                              <tr key={inv.student}>
                                <td className="max-w-[10rem] truncate">{inv.student}</td>
                                <td className="text-right" data-numeric>
                                  {inv.amount}
                                </td>
                                <td>
                                  <StatusBadge tone={inv.tone} label={inv.status} className={mockupBadgeClass(inv.tone)} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Panel>
                  </div>

                  <div className="grid grid-cols-2 gap-3 group-data-[compact=true]:hidden">
                    <div className="panel-interactive flex items-center gap-3 px-4 py-3">
                      <span className="grid size-8 place-items-center rounded-md bg-primary-subtle text-primary">
                        <CalendarCheck className="size-4" />
                      </span>
                      <div>
                        <p className="text-[0.8125rem] font-medium">Mark today&apos;s attendance</p>
                        <p className="text-xs text-muted-foreground">
                          3 of 24 classes still pending
                        </p>
                      </div>
                    </div>
                    <div className="panel-interactive flex items-center gap-3 px-4 py-3">
                      <span className="grid size-8 place-items-center rounded-md bg-primary-subtle text-primary">
                        <Wallet className="size-4" />
                      </span>
                      <div>
                        <p className="text-[0.8125rem] font-medium">Review outstanding balances</p>
                        <p className="text-xs text-muted-foreground">
                          64 students with a balance owing
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        </ScaledStage>
      </div>
    </div>
  );
}
