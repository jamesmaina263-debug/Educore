"use server";

import { createClient } from "@/lib/supabase/server";
import { loadPerformanceMarks } from "@/lib/academics/load-performance-marks";
import {
  buildSubjectProgression,
  buildTermAverages,
  buildYearlySeries,
  attendancePercentage,
  normaliseMarks,
  summarizeHistory,
  type HistorySummary,
  type SubjectProgression,
  type TermAverage,
  type YearPoint,
} from "@/lib/academics/performance-analytics";

export interface AttendanceSummary {
  percentage: number;
  daysRecorded: number;
}

export interface StudentPerformanceHistory {
  /** Share of recorded school days attended (late counts as attended). Null when no attendance is on file. */
  attendance: AttendanceSummary | null;
  years: YearPoint[];
  summary: HistorySummary;
  subjects: SubjectProgression[];
  /** Term averages keyed by academic year id, for the Term 1 vs 2 vs 3 comparison. */
  termsByYear: Record<string, TermAverage[]>;
  /** Per-subject averages keyed by academic year id, to show highest/lowest subject in a year. */
  subjectsByYear: Record<string, { subjectName: string; average: number }[]>;
}

/**
 * Whole-of-enrolment academic history for one student. Read-only and computed live from marks, so a
 * newly closed exam shows up on the next page load. Marks stay linked by student_id, so class changes
 * and promotions never break the history. See performance-analytics.ts for every calculation rule.
 */
export async function getStudentPerformanceHistory(studentId: string): Promise<StudentPerformanceHistory | { error: string }> {
  try {
    const supabase = await createClient();
    const marks = normaliseMarks(await loadPerformanceMarks(supabase, { studentId }));
    const years = buildYearlySeries(marks);

    const termsByYear: StudentPerformanceHistory["termsByYear"] = {};
    const subjectsByYear: StudentPerformanceHistory["subjectsByYear"] = {};
    for (const y of years) {
      const inYear = marks.filter((m) => m.yearId === y.yearId);
      termsByYear[y.yearId] = buildTermAverages(inYear);
      subjectsByYear[y.yearId] = buildSubjectProgression(inYear)
        .map((s) => ({ subjectName: s.subjectName, average: s.points[0]?.average ?? 0 }))
        .sort((a, b) => b.average - a.average);
    }

    const count = async (status: "present" | "late" | "absent") => {
      const { count: n } = await supabase.from("student_attendance").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", status);
      return n ?? 0;
    };
    const [present, late, absent] = await Promise.all([count("present"), count("late"), count("absent")]);
    const pctAttended = attendancePercentage(present, late, absent);
    const attendance = pctAttended === null ? null : { percentage: pctAttended, daysRecorded: present + late + absent };

    return { attendance, years, summary: summarizeHistory(marks, years), subjects: buildSubjectProgression(marks), termsByYear, subjectsByYear };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load performance history." };
  }
}
