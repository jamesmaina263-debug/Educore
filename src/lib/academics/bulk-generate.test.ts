import { describe, expect, it } from "vitest";
import { isSystemicGenerateError, planGenerateAll, runGenerateAll, summariseRuns, type GenerateTarget } from "./bulk-generate";
import type { ClassOverviewRow } from "./load-class-overview";
import { summariseClassStatus } from "./report-card-status";

const row = (id: string, total: number, generated: number, loadFailed = false): ClassOverviewRow => ({
  classId: id,
  className: `Class ${id}`,
  streamCount: 1,
  summary: summariseClassStatus(total, Array.from({ length: generated }, () => ({ comment_source: "none" }))),
  loadFailed,
});
const target = (id: string): GenerateTarget => ({ classId: id, className: `Class ${id}`, pending: 1 });

describe("planGenerateAll", () => {
  it("targets only classes with students missing a card", () => {
    const plan = planGenerateAll([row("a", 10, 0), row("b", 10, 10), row("c", 0, 0), row("d", 10, 7)]);
    expect(plan.targets.map((t) => t.classId)).toEqual(["a", "d"]);
    expect(plan.pendingStudents).toBe(13);
    expect(plan.upToDate).toBe(1);
    expect(plan.empty).toBe(1);
  });
  it("includes a class whose counts failed to load (generation is idempotent)", () => {
    expect(planGenerateAll([row("x", 0, 0, true)]).targets.map((t) => t.classId)).toEqual(["x"]);
  });
  it("is empty when everything is generated", () => {
    expect(planGenerateAll([row("a", 5, 5), row("b", 3, 3)]).targets).toEqual([]);
  });
});

describe("isSystemicGenerateError", () => {
  it("flags failures that would hit every class", () => {
    expect(isSystemicGenerateError("Not authorized to generate report cards.")).toBe(true);
    expect(isSystemicGenerateError("Report cards can only be generated from a closed exam.")).toBe(true);
    expect(isSystemicGenerateError("Exam not found.")).toBe(true);
  });
  it("does not flag a one-off failure", () => {
    expect(isSystemicGenerateError("canceling statement due to statement timeout")).toBe(false);
  });
});

describe("runGenerateAll", () => {
  it("generates every class and totals the new cards", async () => {
    const result = await runGenerateAll(["a", "b", "c"].map(target), async (t) => ({ success: true, created: t.classId === "b" ? 0 : 5 }));
    expect(result.stopReason).toBeNull();
    expect(result.runs.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(summariseRuns(result.runs)).toMatchObject({ total: 3, done: 3, failed: 0, created: 10 });
    expect(result.runs[1].created).toBe(0);
  });

  it("fails classes independently and keeps going", async () => {
    const result = await runGenerateAll(["a", "b", "c", "d"].map(target), async (t) => (t.classId === "b" ? { error: "statement timeout" } : { success: true, created: 1 }));
    expect(result.runs.map((r) => r.status)).toEqual(["done", "failed", "done", "done"]);
    expect(result.runs[1].error).toBe("statement timeout");
    expect(result.stopReason).toBeNull();
  });

  it("turns a thrown call into a failed class, not a crash", async () => {
    const result = await runGenerateAll(["a", "b"].map(target), async (t) => {
      if (t.classId === "a") throw new Error("network");
      return { success: true, created: 2 };
    });
    expect(result.runs[0].status).toBe("failed");
    expect(result.runs[1].status).toBe("done");
  });

  it("stops launching classes after a systemic error", async () => {
    let calls = 0;
    const result = await runGenerateAll(
      ["a", "b", "c", "d", "e"].map(target),
      async () => (calls++, { error: "Not authorized to generate report cards." }),
      { concurrency: 1 },
    );
    expect(result.stopReason).toBe("unavailable");
    expect(calls).toBe(1);
    expect(result.runs.map((r) => r.status)).toEqual(["failed", "queued", "queued", "queued", "queued"]);
  });

  it("honours cancellation between classes", async () => {
    let cancel = false;
    const result = await runGenerateAll(
      ["a", "b", "c"].map(target),
      async (t) => {
        if (t.classId === "a") cancel = true;
        return { success: true, created: 1 };
      },
      { concurrency: 1, isCancelled: () => cancel },
    );
    expect(result.stopReason).toBe("cancelled");
    expect(result.runs.map((r) => r.status)).toEqual(["done", "queued", "queued"]);
  });

  it("never has more than `concurrency` classes in flight", async () => {
    let active = 0;
    let peak = 0;
    await runGenerateAll(
      ["a", "b", "c", "d", "e", "f"].map(target),
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active -= 1;
        return { success: true, created: 1 };
      },
      { concurrency: 2 },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });

  it("a retry re-runs only the failed classes and keeps the earlier results", async () => {
    const first = await runGenerateAll(["a", "b", "c"].map(target), async (t) => (t.classId === "b" ? { error: "timeout" } : { success: true, created: 4 }));
    const calls: string[] = [];
    const second = await runGenerateAll([target("b")], async (t) => (calls.push(t.classId), { success: true, created: 2 }), { previous: first.runs });
    expect(calls).toEqual(["b"]);
    expect(second.runs.map((r) => [r.classId, r.status])).toEqual([["a", "done"], ["b", "done"], ["c", "done"]]);
    expect(summariseRuns(second.runs).created).toBe(10);
  });

  it("reports progress as it goes", async () => {
    const seen: string[] = [];
    await runGenerateAll(["a"].map(target), async () => ({ success: true, created: 1 }), { onUpdate: (s) => seen.push(s.runs[0].status) });
    expect(seen[0]).toBe("queued");
    expect(seen).toContain("running");
    expect(seen[seen.length - 1]).toBe("done");
  });

  it("handles an empty list", async () => {
    expect((await runGenerateAll([], async () => ({ success: true, created: 0 }))).runs).toEqual([]);
  });
});
