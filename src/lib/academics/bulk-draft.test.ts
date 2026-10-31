import { describe, expect, it } from "vitest";
import { classifyDraftError, runBulkDraft } from "./bulk-draft";

const items = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Student ${i}` }));

describe("classifyDraftError", () => {
  it("recognises errors that make every later call pointless", () => {
    expect(classifyDraftError("Too many AI drafting requests. Please wait a while and try again.")).toBe("rate_limit");
    expect(classifyDraftError("AI drafting isn't configured yet — GEMINI_API_KEY is missing from the server environment.")).toBe("unavailable");
    expect(classifyDraftError("You don't have permission to draft report card comments.")).toBe("unavailable");
    expect(classifyDraftError("You must be signed in.")).toBe("unavailable");
  });
  it("treats everything else as a per-student failure", () => {
    expect(classifyDraftError("AI drafting failed (503): overloaded")).toBe("item");
    expect(classifyDraftError("Could not save the draft -- this report card hasn't been generated yet.")).toBe("item");
  });
});

describe("runBulkDraft", () => {
  it("drafts everyone and reports the totals", async () => {
    const seen: string[] = [];
    const result = await runBulkDraft(items, async (i) => (seen.push(i.id), { success: true }));
    expect(result).toMatchObject({ total: 8, attempted: 8, succeeded: 8, failed: [], stopReason: null });
    expect(new Set(seen).size).toBe(8);
  });

  it("keeps going past a single learner's failure and lists who failed", async () => {
    const result = await runBulkDraft(items, async (i) => (i.id === "s3" ? { error: "AI drafting failed (503): overloaded" } : { success: true }));
    expect(result.succeeded).toBe(7);
    expect(result.failed.map((f) => f.id)).toEqual(["s3"]);
    expect(result.stopReason).toBeNull();
  });

  it("stops launching new drafts once the hourly limit is hit", async () => {
    let calls = 0;
    const result = await runBulkDraft(
      items,
      async () => {
        calls += 1;
        return calls > 2 ? { error: "Too many AI drafting requests. Please wait a while and try again." } : { success: true };
      },
      { concurrency: 1 },
    );
    expect(result.stopReason).toBe("rate_limit");
    expect(result.succeeded).toBe(2);
    expect(calls).toBe(3); // the third call hit the limit; nothing after it was attempted
    expect(result.attempted).toBe(3);
  });

  it("stops on a systemic error such as a missing API key", async () => {
    const result = await runBulkDraft(items, async () => ({ error: "AI drafting isn't configured yet — GEMINI_API_KEY is missing from the server environment." }), { concurrency: 1 });
    expect(result.stopReason).toBe("unavailable");
    expect(result.attempted).toBe(1);
  });

  it("honours cancellation between learners", async () => {
    let cancel = false;
    const result = await runBulkDraft(
      items,
      async (i) => {
        if (i.id === "s1") cancel = true;
        return { success: true };
      },
      { concurrency: 1, isCancelled: () => cancel },
    );
    expect(result.stopReason).toBe("cancelled");
    expect(result.succeeded).toBe(2);
  });

  it("never runs more than `concurrency` drafts at once", async () => {
    let active = 0;
    let peak = 0;
    await runBulkDraft(
      items,
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active -= 1;
        return { success: true };
      },
      { concurrency: 3 },
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("turns a thrown call into a per-learner failure, not a crash", async () => {
    const result = await runBulkDraft(items.slice(0, 2), async (i) => {
      if (i.id === "s0") throw new Error("network");
      return { success: true };
    });
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  it("handles an empty list", async () => {
    expect(await runBulkDraft([], async () => ({ success: true }))).toMatchObject({ total: 0, attempted: 0, stopReason: null });
  });
});
