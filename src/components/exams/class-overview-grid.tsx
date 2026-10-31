"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { useSchoolHref } from "@/components/app-shell/school-slug-context";
import { addSummaries, classHealthOf, type ClassHealth } from "@/lib/academics/report-card-status";
import type { ClassOverviewRow } from "@/lib/academics/load-class-overview";

const HEALTH_BADGE: Record<ClassHealth, { tone: "success" | "warning" | "info" | "neutral" | "danger"; label: string }> = {
  empty: { tone: "neutral", label: "No active students" },
  not_started: { tone: "neutral", label: "Not generated" },
  needs_generation: { tone: "warning", label: "Some students missing" },
  in_review: { tone: "info", label: "In review" },
  complete: { tone: "success", label: "All approved" },
};

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warning" | "success" }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>{value}</dd>
    </div>
  );
}

export function ClassOverviewGrid({ examId, rows }: { examId: string; rows: ClassOverviewRow[] }) {
  const toHref = useSchoolHref();
  const reliable = rows.filter((r) => !r.loadFailed);
  const overall = addSummaries(reliable.map((r) => r.summary));
  const anyFailed = rows.some((r) => r.loadFailed);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "class" : "classes"} · {overall.total} students · {overall.generated} generated · {overall.pending} pending ·{" "}
        {overall.approved} approved
        {anyFailed && " (some classes unavailable)"}
      </p>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const s = r.summary;
          const badge = r.loadFailed ? { tone: "danger" as const, label: "Couldn't load" } : HEALTH_BADGE[classHealthOf(s)];
          const pct = (n: number) => (s.total > 0 ? Math.min(100, (n / s.total) * 100) : 0);
          const href = toHref(`/exams/report-cards?exam=${encodeURIComponent(examId)}&class=${encodeURIComponent(r.classId)}`);
          return (
            <li key={r.classId}>
              <Link href={href} className="panel group flex h-full flex-col gap-3 p-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{r.className}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.streamCount} {r.streamCount === 1 ? "stream" : "streams"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge tone={badge.tone} label={badge.label} />
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </div>
                </div>

                {r.loadFailed ? (
                  <p className="text-sm text-muted-foreground">Status for this class is unavailable right now. Open it to see its students.</p>
                ) : (
                  <>
                    <dl className="grid grid-cols-4 gap-2">
                      <Stat label="Students" value={s.total} />
                      <Stat label="Generated" value={s.generated} />
                      <Stat label="Pending" value={s.pending} tone={s.pending > 0 ? "warning" : undefined} />
                      <Stat label="Approved" value={s.approved} tone={s.approved > 0 && s.approved >= s.generated ? "success" : undefined} />
                    </dl>
                    <div
                      className="flex h-2 overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${s.approved} approved, ${s.generated - s.approved} generated and awaiting approval, ${s.pending} not generated, of ${s.total} students`}
                    >
                      <div className="bg-success" style={{ width: `${pct(s.approved)}%` }} />
                      <div className="bg-info/60" style={{ width: `${pct(Math.max(0, s.generated - s.approved))}%` }} />
                    </div>
                    {s.generated > 0 && s.generated > s.approved && (
                      <p className="text-xs text-muted-foreground">
                        {s.generated - s.approved} awaiting approval
                        {s.aiDraft > 0 && ` (${s.aiDraft} AI ${s.aiDraft === 1 ? "draft" : "drafts"})`}
                        {s.needsComment > 0 && s.aiDraft !== s.generated - s.approved && ` · ${s.needsComment} without a comment`}
                      </p>
                    )}
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
