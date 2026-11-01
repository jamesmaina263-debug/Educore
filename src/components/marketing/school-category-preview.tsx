import { MiniFrame } from "@/components/marketing/mini-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CategoryPreview } from "@/lib/marketing/school-categories";

// Small illustrative product snapshots for the /schools/[category] pages, in
// the same MiniFrame style /finance-fees uses. They show real app concepts only
// (M-Pesa matched/pending, a class register, CBC competency levels, marks
// submitted/approved, a campuses list) with generic placeholder rows: no real
// learner, school or campus names, and no figures. Rendered with a caption by
// the page component: "Illustrative preview — not actual account data."

type Tone = "success" | "warning" | "neutral";

function StatusBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono text-[9px]",
        tone === "success" && "bg-success-subtle text-success",
        tone === "warning" && "bg-warning-subtle text-warning",
      )}
    >
      {children}
    </Badge>
  );
}

function Rows({ rows }: { rows: { label: string; badge: string; tone: Tone; mono?: boolean }[] }) {
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5"
        >
          <span className={cn("text-[10px] text-muted-foreground", row.mono && "font-mono")}>{row.label}</span>
          <StatusBadge tone={row.tone}>{row.badge}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

const PREVIEWS: Record<CategoryPreview, { path: string; title: string; rows: Parameters<typeof Rows>[0]["rows"] }> = {
  fees: {
    path: "app.educore.io/finance/reconciliation",
    title: "M-Pesa reconciliation",
    rows: [
      { label: "TGH4K9P2X1", badge: "Matched", tone: "success", mono: true },
      { label: "TGH4K9Q7Z3", badge: "Matched", tone: "success", mono: true },
      { label: "TGH4K9R0A8", badge: "Pending", tone: "warning", mono: true },
    ],
  },
  attendance: {
    path: "app.educore.io/attendance",
    title: "Class register",
    rows: [
      { label: "Learner 1", badge: "Present", tone: "success" },
      { label: "Learner 2", badge: "Present", tone: "success" },
      { label: "Learner 3", badge: "Absent", tone: "warning" },
    ],
  },
  assessment: {
    path: "app.educore.io/exams/competencies",
    title: "Competency ratings",
    rows: [
      { label: "Strand A · Sub-strand 1", badge: "ME", tone: "success" },
      { label: "Strand A · Sub-strand 2", badge: "EE", tone: "success" },
      { label: "Strand B · Sub-strand 1", badge: "AE", tone: "warning" },
    ],
  },
  marks: {
    path: "app.educore.io/exams/marks",
    title: "Marks entry",
    rows: [
      { label: "Subject A · Class 1", badge: "Approved", tone: "success" },
      { label: "Subject B · Class 1", badge: "Submitted", tone: "warning" },
      { label: "Subject C · Class 2", badge: "Approved", tone: "success" },
    ],
  },
  campuses: {
    path: "app.educore.io/campuses/overview",
    title: "Campuses overview",
    rows: [
      { label: "Campus A", badge: "Active", tone: "success" },
      { label: "Campus B", badge: "Active", tone: "success" },
      { label: "Campus C", badge: "Active", tone: "success" },
    ],
  },
};

export function SchoolCategoryPreview({ kind }: { kind: CategoryPreview }) {
  const p = PREVIEWS[kind];
  return (
    <MiniFrame path={p.path}>
      <p className="text-[11px] font-medium text-foreground">{p.title}</p>
      <Rows rows={p.rows} />
    </MiniFrame>
  );
}
