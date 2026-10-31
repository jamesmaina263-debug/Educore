// Run a `.in("col", ids)` query over many ids safely.
//
// Two limits bite a big class when every student id goes into ONE request:
//   - the id list lives in the request URL (hundreds of UUIDs get long), and
//   - the API returns at most ~1000 rows, silently cutting the rest. A printed report card would then
//     be missing subjects with no error anywhere (students x subjects passes 1000 around 80 learners).
// So the ids are split into chunks sized so one chunk can't hit the row cap, run a few at a time, and
// stitched back together in order. A failed chunk throws rather than quietly dropping rows, because the
// output is an official document.

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export async function selectInChunks<T>(
  ids: readonly string[],
  size: number,
  run: (chunkIds: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  concurrency = 4,
): Promise<T[]> {
  const groups = chunk(ids, size);
  const results: T[][] = new Array(groups.length);
  for (let start = 0; start < groups.length; start += concurrency) {
    const batch = groups.slice(start, start + concurrency);
    const settled = await Promise.all(batch.map((g) => run(g)));
    settled.forEach((res, i) => {
      if (res.error) throw new Error(`Query failed: ${res.error.message}`);
      results[start + i] = res.data ?? [];
    });
  }
  return results.flat();
}
