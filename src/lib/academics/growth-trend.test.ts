import { describe, it, expect } from "vitest";
import { classifyTrend, DEFAULT_STABLE_THRESHOLD } from "./growth-trend";

describe("classifyTrend", () => {
  it("returns insufficient_data for zero points", () => {
    expect(classifyTrend([])).toEqual({ direction: "insufficient_data", change: null, points: [] });
  });

  it("returns insufficient_data for exactly one point", () => {
    const points = [{ label: "Term 1", value: 62 }];
    expect(classifyTrend(points)).toEqual({ direction: "insufficient_data", change: null, points });
  });

  it("classifies improving when the change exceeds the threshold", () => {
    const points = [
      { label: "Term 1", value: 62 },
      { label: "Term 2", value: 70 },
      { label: "Term 3", value: 76 },
    ];
    const result = classifyTrend(points);
    expect(result.direction).toBe("improving");
    expect(result.change).toBe(14);
  });

  it("classifies declining when the change is below the negative threshold", () => {
    const points = [
      { label: "Term 1", value: 80 },
      { label: "Term 2", value: 60 },
    ];
    const result = classifyTrend(points);
    expect(result.direction).toBe("declining");
    expect(result.change).toBe(-20);
  });

  it("classifies stable when the change is within the threshold", () => {
    const points = [
      { label: "Term 1", value: 70 },
      { label: "Term 2", value: 72 },
    ];
    const result = classifyTrend(points);
    expect(result.direction).toBe("stable");
    expect(result.change).toBe(2);
  });

  it("treats an exact zero change as stable", () => {
    const points = [
      { label: "Term 1", value: 55 },
      { label: "Term 2", value: 55 },
    ];
    expect(classifyTrend(points).direction).toBe("stable");
  });

  it("is a boundary at exactly the threshold (stable, not improving/declining)", () => {
    const up = [
      { label: "Term 1", value: 50 },
      { label: "Term 2", value: 50 + DEFAULT_STABLE_THRESHOLD },
    ];
    expect(classifyTrend(up).direction).toBe("stable");

    const down = [
      { label: "Term 1", value: 50 },
      { label: "Term 2", value: 50 - DEFAULT_STABLE_THRESHOLD },
    ];
    expect(classifyTrend(down).direction).toBe("stable");
  });

  it("only compares the first and last point, ignoring dips/spikes in between", () => {
    const points = [
      { label: "Term 1", value: 60 },
      { label: "Term 2", value: 95 },
      { label: "Term 3", value: 63 },
    ];
    const result = classifyTrend(points);
    expect(result.direction).toBe("stable");
    expect(result.change).toBe(3);
  });

  it("respects a custom stable threshold", () => {
    const points = [
      { label: "Term 1", value: 60 },
      { label: "Term 2", value: 62 },
    ];
    expect(classifyTrend(points, 1).direction).toBe("improving");
    expect(classifyTrend(points, 5).direction).toBe("stable");
  });
});
