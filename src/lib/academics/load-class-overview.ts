import type { createClient } from "@/lib/supabase/server";
import { summariseClassStatus, type ClassStatusSummary } from "@/lib/academics/report-card-status";

// Loader for the Report Cards class overview: one row per class on the exam, with live status counts.
//
// No migration and no change to generation: the counts are read from the same tables
// generate_report_cards() writes, using the same definition of "who is in the class":
//   active students (status = 'active') whose current_class_id is one of the class's streams.
// Cards are counted only for those students AND only when report_cards.class_id is this class,
// which is exactly what the per-class page lists, so the overview and the class page always agree
// (a withdrawn student's old card, or a card left behind by a grade change, is not counted).
// Two light queries per class, run in parallel: a head-only count of students, and the card
// comment_source values (at most one row per student in the class).

type Client = Awaited<ReturnType<typeof createClient>>;

export interface ExamClass {
  id: string;
  name: string;
  levelOrder: number;
}

export interface ClassOverviewRow {
  classId: string;
  className: string;
  streamCount: number;
  summary: ClassStatusSummary;
  /** True when a count query failed: the card shows "unavailable" rather than a misleading 0. */
  loadFailed: boolean;
}

export function sortExamClasses<T extends { name: string; levelOrder: number }>(classes: T[]): T[] {
  return [...classes].sort((a, b) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const EMPTY = summariseClassStatus(0, []);

export async function loadClassOverview(supabase: Client, examId: string, classes: ExamClass[]): Promise<ClassOverviewRow[]> {
  if (classes.length === 0) return [];
  const classIds = classes.map((c) => c.id);

  const { data: streamRows, error: streamError } = await supabase.from("streams").select("id, class_id").in("class_id", classIds);
  const streamsByClass = new Map<string, string[]>();
  for (const s of streamRows ?? []) {
    const list = streamsByClass.get(s.class_id as string) ?? [];
    list.push(s.id as string);
    streamsByClass.set(s.class_id as string, list);
  }

  return Promise.all(
    sortExamClasses(classes).map(async (c): Promise<ClassOverviewRow> => {
      const streamIds = streamsByClass.get(c.id) ?? [];
      if (streamError) return { classId: c.id, className: c.name, streamCount: 0, summary: EMPTY, loadFailed: true };
      if (streamIds.length === 0) return { classId: c.id, className: c.name, streamCount: 0, summary: EMPTY, loadFailed: false };

      const [{ count, error: countError }, { data: cards, error: cardsError }] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active").in("current_class_id", streamIds),
        supabase
          .from("report_cards")
          .select("comment_source, students!inner(id)")
          .eq("exam_id", examId)
          .eq("class_id", c.id)
          .eq("students.status", "active")
          .in("students.current_class_id", streamIds),
      ]);

      if (countError || cardsError) {
        return { classId: c.id, className: c.name, streamCount: streamIds.length, summary: EMPTY, loadFailed: true };
      }
      return {
        classId: c.id,
        className: c.name,
        streamCount: streamIds.length,
        summary: summariseClassStatus(count ?? 0, (cards ?? []).map((r) => ({ comment_source: r.comment_source as string | null }))),
        loadFailed: false,
      };
    }),
  );
}
