import { describe, expect, it } from "vitest";
import { chunk, selectInChunks } from "./in-chunks";

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
