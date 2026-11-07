"use server";

import { createClient } from "@/lib/supabase/server";
import { loadStudentPerformanceMarks } from "@/lib/academics/load-performance-marks";
import { loadReportSettings } from "@/lib/academics/report-settings";
import type { GradeBand, PerfMark } from "@/lib/academics/performance-analytics";

export interface AttendanceSummary {
  /** Share of recorded school days attended (late counts as attended). */
  percentage: number;
  daysRecorded: number;
}

export interface ClassPosition {
  examName: string;
  rankInClass: number | null;
  rankInStream: number | null;
  /** Learners ranked in the same class for that exam; null if it could not be counted. */
  classSize: number | null;
}

export interface StudentPerformanceData {
  /** Every closed-exam mark for the student, both models. The tab scores, filters and charts them with performance-analytics.ts. */
  marks: PerfMark[];
  /** Marks read but not usable for this viewer (e.g. the year/term is not readable by their account). */
  skipped: number;
  attendance: AttendanceSummary | null;
  /** Latest class position, only when the school has ranking switched on. */
  position: ClassPosition | null;
  /** Short-lived signed link to the student's photo, or null (no photo on file, or not readable by this viewer). */
  photoUrl: string | null;
  /** The school's default numeric grading bands for the overall-grade label. Empty when unavailable to this viewer. */
  gradeBands: GradeBand[];
}

/**
 * Raw material for the student's Performance tab. Read-only, through the caller's own session, so a
 * newly closed exam shows on the next load and RLS decides what this viewer may see. Marks stay linked
 * by student_id, so class changes and promotions never break the history. No analytics are computed
 * here; see performance-analytics.ts.
 */
export async function getStudentPerformanceData(studentId: string): Promise<StudentPerformanceData | { error: string }> {
  try {
    const supabase = await createClient();
    const { data: me } = await supabase.from("students").select("school_id, photo_storage_path").eq("id", studentId).maybeSingle();
    if (!me) return { error: "Student not found." };
    const schoolId = me.school_id as string;
    let photoUrl: string | null = null;
    if (me.photo_storage_path) {
      const { data: signed } = await supabase.storage.from("student-documents").createSignedUrl(me.photo_storage_path as string, 300);
      photoUrl = signed?.signedUrl ?? null;
    }
    const loaded = await loadStudentPerformanceMarks(supabase, studentId);

    const countStatus = async (status: "present" | "late" | "absent") => {
      const { count } = await supabase.from("student_attendance").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", status);
      return count ?? 0;
    };
    const [present, late, absent] = await Promise.all([countStatus("present"), countStatus("late"), countStatus("absent")]);
    const days = present + late + absent;

    const settings = await loadReportSettings(supabase, schoolId);
    let position: ClassPosition | null = null;
    if (settings.rankingEnabled) {
      const { data: ranks } = await supabase
        .from("class_rankings")
        .select("exam_id, class_id, rank_in_class, rank_in_stream, computed_at, exams!inner(name, status)")
        .eq("student_id", studentId)
        .eq("exams.status", "closed")
        .order("computed_at", { ascending: false })
        .limit(1);
      const r = (ranks ?? [])[0] as unknown as
        | { exam_id: string; class_id: string; rank_in_class: number | null; rank_in_stream: number | null; exams: { name: string } | { name: string }[] | null }
        | undefined;
      if (r) {
        const { count } = await supabase.from("class_rankings").select("id", { count: "exact", head: true }).eq("exam_id", r.exam_id).eq("class_id", r.class_id);
        const exam = Array.isArray(r.exams) ? r.exams[0] : r.exams;
        position = { examName: exam?.name ?? "Latest exam", rankInClass: r.rank_in_class, rankInStream: r.rank_in_stream, classSize: count ?? null };
      }
    }

    let gradeBands: GradeBand[] = [];
    const { data: scale } = await supabase.from("grading_scales").select("id").eq("is_default", true).eq("model_type", "numeric").maybeSingle();
    if (scale) {
      const { data: rows } = await supabase
        .from("grading_scale_bands")
        .select("label, min_score, max_score, level_order")
        .eq("grading_scale_id", scale.id)
        .not("min_score", "is", null)
        .not("max_score", "is", null)
        .order("level_order", { ascending: true });
      gradeBands = (rows ?? []).map((b) => ({ label: b.label as string, min: Number(b.min_score), max: Number(b.max_score), order: b.level_order as number }));
    }

    return {
      marks: loaded.marks,
      skipped: loaded.skipped,
      attendance: days === 0 ? null : { percentage: ((present + late) / days) * 100, daysRecorded: days },
      position,
      photoUrl,
      gradeBands,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load performance history." };
  }
}
