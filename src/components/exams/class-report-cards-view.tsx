"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { generateReportCards } from "@/app/(app)/exams/report-cards/actions";
import { StudentReportCardDetail } from "@/components/exams/student-report-card-detail";
import {
  filterStreamGroups,
  summariseStream,
  type CardStatus,
  type ClassStatusSummary,
  type StreamGroup,
} from "@/lib/academics/report-card-status";

const STATUS_BADGE: Record<CardStatus, { tone: "success" | "warning" | "info" | "neutral"; label: string }> = {
  not_generated: { tone: "neutral", label: "Not generated" },
  needs_comment: { tone: "warning", label: "No comment" },
  needs_reapproval: { tone: "warning", label: "Needs re-approval" },
  ai_draft: { tone: "info", label: "AI draft — needs approval" },
  approved: { tone: "success", label: "Approved" },
};

// One class on one exam: streams as accordions (collapsed by default), a compact row per student, and
// the full review panel only for rows the user opens. All rows' summaries are already on the client,
// so search is instant; the heavy per-student data is fetched on expand (StudentReportCardDetail).
export function ClassReportCardsView({
  examId,
  classId,
  streams,
  summary,
  canGenerate,
  rankingEnabled,
  headCommentEnabled,
  canCommentHead,
}: {
  examId: string;
  classId: string;
  streams: StreamGroup[];
  summary: ClassStatusSummary;
  canGenerate: boolean;
  rankingEnabled: boolean;
  headCommentEnabled: boolean;
  canCommentHead: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;
  const [openStreams, setOpenStreams] = useState<Set<string>>(new Set());
  const [openStudents, setOpenStudents] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleStreams = useMemo(() => filterStreamGroups(streams, deferredQuery), [streams, deferredQuery]);
  // Some streams are the user's to approve and some aren't (a class teacher): say so, instead of
  // letting them hit a permission error after clicking.
  const mixedApproval = streams.some((g) => g.canApprove) && streams.some((g) => !g.canApprove);
  const matchCount = useMemo(() => visibleStreams.reduce((n, g) => n + g.students.length, 0), [visibleStreams]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateReportCards(examId, classId);
      if ("error" in result) return setError(result.error);
      router.refresh();
    } catch {
      // A thrown server action (timeout, network, server error) must not leave the button stuck on "Generating...".
      setError("Couldn't generate report cards. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (summary.generated === 0) {
    return (
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {canGenerate ? (
          <div className="panel border-dashed p-6 text-center">
            <p className="mb-3 text-sm text-muted-foreground">No report cards generated yet for this class.</p>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "Generating…" : "Generate for whole class"}
            </Button>
          </div>
        ) : (
          <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">No report cards generated yet.</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
        <span>
          <strong className="tabular-nums">{summary.total}</strong> students
        </span>
        <span>
          <strong className="tabular-nums">{summary.generated}</strong> generated
        </span>
        <span className={summary.pending > 0 ? "text-warning" : ""}>
          <strong className="tabular-nums">{summary.pending}</strong> pending
        </span>
        <span>
          <strong className="tabular-nums">{summary.approved}</strong> approved
        </span>
        {summary.pending > 0 && canGenerate && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating…" : `Generate for ${summary.pending} remaining ${summary.pending === 1 ? "student" : "students"}`}
          </Button>
        )}
      </div>

      {mixedApproval && (
        <p className="text-sm text-muted-foreground">You can approve and write comments for your own streams. Other streams are view-only for you.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or admission number"
            aria-label="Search students in this class by name or admission number"
            className="pl-8"
          />
        </div>
        {searching ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {matchCount} {matchCount === 1 ? "student matches" : "students match"}
          </p>
        ) : (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpenStreams(new Set(streams.map((s) => s.id)))}>
              Expand all streams
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpenStreams(new Set())}>
              Collapse all
            </Button>
          </div>
        )}
      </div>

      {visibleStreams.length === 0 ? (
        <div className="panel border-dashed p-6 text-center text-sm text-muted-foreground">No students match “{deferredQuery.trim()}”.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleStreams.map((g) => {
            const stats = summariseStream(g.students);
            const open = searching || openStreams.has(g.id);
            const panelId = `stream-${g.id}`;
            return (
              <section key={g.id} className="panel overflow-hidden">
                <div className="flex items-center">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => !searching && setOpenStreams((prev) => toggle(prev, g.id))}
                  >
                    {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                    <span className="font-medium">{g.name}</span>
                    {mixedApproval && (
                      <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{g.canApprove ? "Your stream" : "View only"}</span>
                    )}
                    <span className="text-sm text-muted-foreground">
                      {stats.total} {stats.total === 1 ? "student" : "students"}
                    </span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
                      <span className="text-success">{stats.approved} approved</span>
                      {stats.needsAttention > 0 && <span className="text-warning">{stats.needsAttention} to review</span>}
                      {stats.notGenerated > 0 && <span className="text-muted-foreground">{stats.notGenerated} not generated</span>}
                    </span>
                  </button>
                  {stats.total - stats.notGenerated > 0 && (
                    <a
                      href={`/exams/report-cards/print?exam=${examId}&stream=${g.id}&class=${classId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Opens every generated report card in this stream, one A4 page each. Cards not yet approved print without a teacher comment."
                      className="shrink-0 px-4 py-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Print stream ({stats.total - stats.notGenerated})
                    </a>
                  )}
                </div>

                {open && (
                  <ul id={panelId} className="divide-y divide-border border-t border-border">
                    {g.students.map((s) => {
                      const expanded = openStudents.has(s.student_id);
                      const badge = STATUS_BADGE[s.status];
                      const detailId = `student-${s.student_id}`;
                      return (
                        <li key={s.student_id}>
                          <div className="flex items-center gap-2 px-4 py-2">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-expanded={expanded}
                              aria-controls={detailId}
                              onClick={() => setOpenStudents((prev) => toggle(prev, s.student_id))}
                            >
                              {expanded ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{s.full_name}</span>
                                {s.admission_number && <span className="block text-xs text-muted-foreground">Adm {s.admission_number}</span>}
                              </span>
                              <span className="ml-auto hidden shrink-0 text-sm text-muted-foreground sm:block">
                                {s.average_score !== null ? `Avg ${s.average_score}` : "Avg —"}
                                {rankingEnabled && s.rank_in_stream ? ` · Rank ${s.rank_in_stream}` : ""}
                              </span>
                              <StatusBadge tone={badge.tone} label={badge.label} className="shrink-0" />
                            </button>
                            {s.status !== "not_generated" && (
                              <a
                                href={`/exams/report-cards/print?exam=${examId}&student=${s.student_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                              >
                                Print
                              </a>
                            )}
                          </div>
                          {expanded && (
                            <div id={detailId} className="border-t border-border bg-muted/20">
                              <StudentReportCardDetail
                                examId={examId}
                                classId={classId}
                                studentId={s.student_id}
                                studentName={s.full_name}
                                canApprove={g.canApprove}
                                headCommentEnabled={headCommentEnabled}
                                canCommentHead={canCommentHead}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
