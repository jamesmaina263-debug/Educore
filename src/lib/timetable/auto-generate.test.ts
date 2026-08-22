import { describe, expect, it } from "vitest";
import { buildGrid, generateTimetableSlots } from "./auto-generate";

const DAYS = [1, 2, 3, 4, 5]; // Mon-Fri
const PERIODS = [1, 2, 4, 5, 6, 8, 9, 10]; // teaching periods only (3 and 7 are breaks)

describe("buildGrid", () => {
  it("produces one cell per (day, period) pair, day-major", () => {
    const grid = buildGrid([1, 2], [1, 2]);
    expect(grid).toEqual([
      { day: 1, period: 1 },
      { day: 1, period: 2 },
      { day: 2, period: 1 },
      { day: 2, period: 2 },
    ]);
  });

  it("excludes any period number not in teachingPeriodNumbers", () => {
    const grid = buildGrid([1], PERIODS);
    expect(grid.some((c) => c.period === 3 || c.period === 7)).toBe(false);
    expect(grid).toHaveLength(PERIODS.length);
  });
});

describe("generateTimetableSlots", () => {
  it("places exactly periods_per_week slots for a single unconstrained subject", () => {
    const grid = buildGrid(DAYS, PERIODS);
    const result = generateTimetableSlots({
      grid,
      requirements: [{ subject_id: "math", teacher_id: "t1", periods_per_week: 5 }],
      existingStreamCells: [],
      existingTeacherCells: [],
    });
    expect(result.placements).toHaveLength(5);
    expect(result.unplaced).toHaveLength(0);
    // Every placement is unique -- never the same cell twice.
    const keys = new Set(result.placements.map((p) => `${p.day}:${p.period}`));
    expect(keys.size).toBe(5);
  });

  it("never places into a stream cell that is already occupied", () => {
    const grid = buildGrid([1], [1, 2]); // only 2 free cells total
    const result = generateTimetableSlots({
      grid,
      requirements: [{ subject_id: "math", teacher_id: "t1", periods_per_week: 2 }],
      existingStreamCells: [{ day: 1, period: 1 }],
      existingTeacherCells: [],
    });
    expect(result.placements).toEqual([{ subject_id: "math", teacher_id: "t1", day: 1, period: 2 }]);
    expect(result.unplaced).toEqual([
      { subject_id: "math", teacher_id: "t1", requested: 2, placed: 1, reason: "grid_full" },
    ]);
  });

  it("never double-books a teacher who is already teaching another stream at that cell", () => {
    const grid = buildGrid([1], [1, 2, 4]);
    const result = generateTimetableSlots({
      grid,
      requirements: [{ subject_id: "math", teacher_id: "shared-teacher", periods_per_week: 3 }],
      existingStreamCells: [],
      existingTeacherCells: [
        { teacher_id: "shared-teacher", day: 1, period: 1 },
        { teacher_id: "shared-teacher", day: 1, period: 2 },
      ],
    });
    // Only period 4 was free for this teacher.
    expect(result.placements).toEqual([{ subject_id: "math", teacher_id: "shared-teacher", day: 1, period: 4 }]);
    expect(result.unplaced[0]).toMatchObject({ requested: 3, placed: 1, reason: "teacher_fully_booked" });
  });

  it("does not apply the teacher constraint to a requirement with no teacher assigned yet", () => {
    const grid = buildGrid([1], [1, 2]);
    const result = generateTimetableSlots({
      grid,
      requirements: [{ subject_id: "math", teacher_id: null, periods_per_week: 2 }],
      existingStreamCells: [],
      existingTeacherCells: [{ teacher_id: "irrelevant", day: 1, period: 1 }],
    });
    expect(result.placements).toHaveLength(2);
    expect(result.unplaced).toHaveLength(0);
  });

  it("does not let two different subjects in the same generation run double-book each other's stream cells", () => {
    const grid = buildGrid([1], [1, 2]); // exactly 2 cells
    const result = generateTimetableSlots({
      grid,
      requirements: [
        { subject_id: "math", teacher_id: "t1", periods_per_week: 2 },
        { subject_id: "english", teacher_id: "t2", periods_per_week: 2 },
      ],
      existingStreamCells: [],
      existingTeacherCells: [],
    });
    // Only 2 stream cells exist total; math takes both, english gets none.
    expect(result.placements).toHaveLength(2);
    expect(result.placements.every((p) => p.subject_id === "math")).toBe(true);
    expect(result.unplaced).toEqual([
      { subject_id: "english", teacher_id: "t2", requested: 2, placed: 0, reason: "grid_full" },
    ]);
  });

  it("reports a teacher conflict distinctly from a full grid when the stream still has room", () => {
    const grid = buildGrid([1], [1, 2, 4, 5]); // 4 stream cells
    const result = generateTimetableSlots({
      grid,
      requirements: [
        { subject_id: "math", teacher_id: "shared", periods_per_week: 1 },
        { subject_id: "physics", teacher_id: "shared", periods_per_week: 2 },
      ],
      existingStreamCells: [],
      // "shared" is already teaching a different stream at periods 1 and 2.
      existingTeacherCells: [
        { teacher_id: "shared", day: 1, period: 1 },
        { teacher_id: "shared", day: 1, period: 2 },
      ],
    });
    expect(result.placements).toHaveLength(2); // math got its 1, physics got 1 of its 2
    // The two placements must not be the same cell, and neither may be one
    // of the teacher's pre-existing periods (1 or 2).
    const cellKeys = result.placements.map((p) => `${p.day}:${p.period}`);
    expect(new Set(cellKeys).size).toBe(2);
    expect(cellKeys.every((k) => k !== "1:1" && k !== "1:2")).toBe(true);
    expect(result.unplaced).toEqual([
      { subject_id: "physics", teacher_id: "shared", requested: 2, placed: 1, reason: "teacher_fully_booked" },
    ]);
  });

  it("returns no placements and no unplaced entries for an empty requirement list", () => {
    const grid = buildGrid(DAYS, PERIODS);
    const result = generateTimetableSlots({ grid, requirements: [], existingStreamCells: [], existingTeacherCells: [] });
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it("handles a requirement asking for more periods than exist in the whole grid", () => {
    const grid = buildGrid([1], [1, 2]);
    const result = generateTimetableSlots({
      grid,
      requirements: [{ subject_id: "math", teacher_id: "t1", periods_per_week: 10 }],
      existingStreamCells: [],
      existingTeacherCells: [],
    });
    expect(result.placements).toHaveLength(2);
    expect(result.unplaced).toEqual([
      { subject_id: "math", teacher_id: "t1", requested: 10, placed: 2, reason: "grid_full" },
    ]);
  });
});
