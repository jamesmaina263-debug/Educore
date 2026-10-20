import type { EnrolmentRow } from "@/lib/academics/subject-enrolment";

// Pure rules for "copy from last year": carry a student's elective choices into the new year's class.
// No I/O; the server action (academics/subject-enrolment-actions.ts) supplies the rows and does the writing.
//
// Deliberately cautious, so a mistake can only ever show too many students, never hide one:
//  * only subjects that are universal for the class right now are touched. A subject staff have already set up
//    for this class is never overwritten, which also makes running it twice harmless;
//  * a student with an active row last year keeps the subject; an explicit inactive row means they dropped it;
//  * a student with NO row last year (new to the school, or last year's list never covered them) is unknown, so
//    they are included rather than silently left off;
//  * nothing is copied when there is no data for the subject, when everyone would take it anyway (it stays
//    universal), or when nobody would (a discontinued subject; staff should decide that by hand).

export interface CopySubjectInput {
  subjectId: string;
  /** True when this class already has enrolment rows for the subject. */
  selectiveNow: boolean;
}

export interface CopySubjectPlan {
  subjectId: string;
  status: "copy" | "nobody_continues";
  takingIds: string[];
  continuing: number;
  dropped: number;
  /** No row last year: included. */
  unknown: number;
}

export function planCopyFromLastYear(input: { studentIds: string[]; subjects: CopySubjectInput[]; previousRows: EnrolmentRow[] }): CopySubjectPlan[] {
  const studentIds = [...new Set(input.studentIds)];
  const inClass = new Set(studentIds);
  const out: CopySubjectPlan[] = [];

  for (const subject of input.subjects) {
    if (subject.selectiveNow) continue;

    const lastYear = new Map<string, boolean>();
    for (const r of input.previousRows) {
      if (r.subjectId === subject.subjectId && inClass.has(r.studentId)) lastYear.set(r.studentId, r.isActive);
    }
    if (lastYear.size === 0) continue; // nothing to copy from

    const takingIds: string[] = [];
    let continuing = 0;
    let dropped = 0;
    let unknown = 0;
    for (const id of studentIds) {
      const was = lastYear.get(id);
      if (was === undefined) {
        unknown += 1;
        takingIds.push(id);
      } else if (was) {
        continuing += 1;
        takingIds.push(id);
      } else {
        dropped += 1;
      }
    }

    if (takingIds.length === studentIds.length) continue; // everyone takes it: stays universal
    out.push({
      subjectId: subject.subjectId,
      status: takingIds.length === 0 ? "nobody_continues" : "copy",
      takingIds,
      continuing,
      dropped,
      unknown,
    });
  }
  return out;
}
