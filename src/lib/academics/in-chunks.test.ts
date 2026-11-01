import { describe, expect, it } from "vitest";
import { chunk, selectAllPages, selectInChunks } from "./in-chunks";

describe("chunk", () => {
  it("splits into groups of at most `size`, keeping order", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
  it("never loops forever on a bad size", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
});

describe("selectInChunks", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `id${i}`);

  it("runs one query per chunk and returns rows in id order", async () => {
    const seen: string[][] = [];
    const rows = await selectInChunks<string>(ids, 4, async (c) => {
      seen.push(c);
      return { data: c.map((x) => `row-${x}`), error: null };
    });
    expect(seen).toEqual([ids.slice(0, 4), ids.slice(4, 8), ids.slice(8)]);
    expect(rows).toEqual(ids.map((x) => `row-${x}`));
  });

  it("keeps order even when later chunks finish first", async () => {
    const rows = await selectInChunks<string>(
      ids,
      2,
      (c) => new Promise((resolve) => setTimeout(() => resolve({ data: c, error: null }), c[0] === "id0" ? 20 : 0)),
      5,
    );
    expect(rows).toEqual(ids);
  });

  it("limits how many chunks run at once", async () => {
    let active = 0;
    let peak = 0;
    await selectInChunks<string>(
      ids,
      1,
      async (c) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active -= 1;
        return { data: c, error: null };
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("throws on a failed chunk instead of silently dropping rows", async () => {
    await expect(
      selectInChunks<string>(ids, 5, async (c) => (c[0] === "id5" ? { data: null, error: { message: "boom" } } : { data: c, error: null })),
    ).rejects.toThrow(/boom/);
  });

  it("returns nothing for no ids and treats null data as empty", async () => {
    expect(await selectInChunks<string>([], 5, async () => ({ data: ["x"], error: null }))).toEqual([]);
    expect(await selectInChunks<string>(["a"], 5, async () => ({ data: null, error: null }))).toEqual([]);
  });
});

describe("selectAllPages", () => {
  const table = Array.from({ length: 2500 }, (_, i) => i);
  const page = (from: number, to: number) => Promise.resolve({ data: table.slice(from, to + 1), error: null });

  it("reads every row past the per-request cap, in order, with no gaps or repeats", async () => {
    const rows = await selectAllPages<number>(page, 1000);
    expect(rows).toHaveLength(2500);
    expect(rows).toEqual(table);
  });

  it("stops at the first short page (one request when everything fits)", async () => {
    let calls = 0;
    const rows = await selectAllPages<number>((from, to) => (calls++, Promise.resolve({ data: table.slice(from, Math.min(to + 1, 10)), error: null })), 1000);
    expect(rows).toHaveLength(10);
    expect(calls).toBe(1);
  });

  it("when the server caps below the page size it returns what one query would have, never looping", async () => {
    let calls = 0;
    const rows = await selectAllPages<number>((from) => (calls++, Promise.resolve({ data: table.slice(from, from + 500), error: null })), 1000);
    expect(rows).toHaveLength(500);
    expect(calls).toBe(1);
  });

  it("an exact multiple of the page size costs one extra empty request, then stops", async () => {
    const exact = table.slice(0, 2000);
    let calls = 0;
    const rows = await selectAllPages<number>((from, to) => (calls++, Promise.resolve({ data: exact.slice(from, to + 1), error: null })), 1000);
    expect(rows).toHaveLength(2000);
    expect(calls).toBe(3);
  });

  it("throws on a failed page instead of returning a partial list", async () => {
    await expect(
      selectAllPages<number>((from) => Promise.resolve(from >= 1000 ? { data: null, error: { message: "timeout" } } : { data: table.slice(from, from + 1000), error: null }), 1000),
    ).rejects.toThrow(/timeout/);
  });

  it("is bounded by maxPages", async () => {
    let calls = 0;
    await selectAllPages<number>(() => (calls++, Promise.resolve({ data: table.slice(0, 1000), error: null })), 1000, 3);
    expect(calls).toBe(3);
  });
});
