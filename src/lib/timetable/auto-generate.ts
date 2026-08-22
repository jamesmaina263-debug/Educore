// Pure scheduling logic for automatic timetable generation. Deliberately a
// greedy placer, not a full constraint solver: the only hard rules are (1)
// never double-book the stream at a day/period that's already taken, and
// (2) never double-book a teacher at a day/period they're already teaching
// somewhere else in the school -- both mirroring timetable_slots' actual DB
// unique constraints 1:1, so a bug here would be caught at insert time
// too, not silently accepted. No daily-load caps or same-subject-per-day
// spreading is enforced (matches the confirmed "bare minimum" scope) --
// requirements are spread across the week only as a quality-of-life
// heuristic (rotating each subject's starting point through the grid), not
// as a guarantee.
//
// Never touches a stream's already-existing slots -- it only fills day/period
// cells that are currently free for that stream, so re-running generation
// after a teacher hand-edits a few slots leaves those edits alone and just
// tops up whatever's still short of its periods_per_week target.

export interface TimetableGridCell {
  day: number;
  period: number;
}

export interface SubjectRequirement {
  subject_id: string;
  teacher_id: string | null;
  periods_per_week: number;
}

export interface OccupiedStreamCell {
  day: number;
  period: number;
}

export interface OccupiedTeacherCell {
  teacher_id: string;
  day: number;
  period: number;
}

export interface GeneratedSlot {
  subject_id: string;
  teacher_id: string | null;
  day: number;
  period: number;
}

export interface UnplacedRequirement {
  subject_id: string;
  teacher_id: string | null;
  requested: number;
  placed: number;
  reason: "grid_full" | "teacher_fully_booked";
}

export interface GenerateTimetableResult {
  placements: GeneratedSlot[];
  unplaced: UnplacedRequirement[];
}

function cellKey(day: number, period: number): string {
  return `${day}:${period}`;
}

function teacherCellKey(teacherId: string, day: number, period: number): string {
  return `${teacherId}:${day}:${period}`;
}

/**
 * Builds the full list of schedulable (day, period) cells, teaching periods
 * only, in day-major order (all periods for day 1, then day 2, ...).
 */
export function buildGrid(days: number[], teachingPeriodNumbers: number[]): TimetableGridCell[] {
  const grid: TimetableGridCell[] = [];
  for (const day of days) {
    for (const period of teachingPeriodNumbers) {
      grid.push({ day, period });
    }
  }
  return grid;
}

/**
 * Greedily places each subject requirement's periods_per_week into free
 * grid cells, skipping cells already taken by the stream or (when a teacher
 * is assigned) by that teacher elsewhere. Requirements are processed in
 * the given order; each one's search starts at a rotating offset into the
 * grid (offset = index * rotationStep) purely to spread subjects across the
 * week instead of clumping everything into the first free periods -- this
 * is a quality heuristic only, never a constraint that blocks placement.
 */
export function generateTimetableSlots(params: {
  grid: TimetableGridCell[];
  requirements: SubjectRequirement[];
  existingStreamCells: OccupiedStreamCell[];
  existingTeacherCells: OccupiedTeacherCell[];
}): GenerateTimetableResult {
  const { grid, requirements, existingStreamCells, existingTeacherCells } = params;

  const streamUsed = new Set(existingStreamCells.map((c) => cellKey(c.day, c.period)));
  const teacherUsed = new Set(existingTeacherCells.map((c) => teacherCellKey(c.teacher_id, c.day, c.period)));

  const placements: GeneratedSlot[] = [];
  const unplaced: UnplacedRequirement[] = [];

  const gridSize = grid.length;
  // Spread starting points roughly evenly across the grid for successive
  // requirements, so requirement 0 doesn't always claim every early slot
  // before requirement 1 gets a turn.
  const rotationStep = requirements.length > 0 ? Math.max(1, Math.floor(gridSize / requirements.length)) : 0;

  requirements.forEach((req, index) => {
    let placed = 0;
    const offset = gridSize > 0 ? (index * rotationStep) % gridSize : 0;

    for (let i = 0; i < gridSize && placed < req.periods_per_week; i++) {
      const cell = grid[(offset + i) % gridSize];
      const sKey = cellKey(cell.day, cell.period);
      if (streamUsed.has(sKey)) continue;

      if (req.teacher_id) {
        const tKey = teacherCellKey(req.teacher_id, cell.day, cell.period);
        if (teacherUsed.has(tKey)) continue;
      }

      placements.push({ subject_id: req.subject_id, teacher_id: req.teacher_id, day: cell.day, period: cell.period });
      streamUsed.add(sKey);
      if (req.teacher_id) teacherUsed.add(teacherCellKey(req.teacher_id, cell.day, cell.period));
      placed++;
    }

    if (placed < req.periods_per_week) {
      // Distinguish "the stream's grid is just full" from "this specific
      // teacher has no free slots left" so the report tells the school
      // something actionable (add periods vs. reassign/hire a teacher).
      const streamFreeCells = gridSize - streamUsed.size;
      const reason: UnplacedRequirement["reason"] = streamFreeCells > 0 ? "teacher_fully_booked" : "grid_full";
      unplaced.push({
        subject_id: req.subject_id,
        teacher_id: req.teacher_id,
        requested: req.periods_per_week,
        placed,
        reason,
      });
    }
  });

  return { placements, unplaced };
}
