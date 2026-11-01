import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALWAYS_KEPT,
  PROTECTED_BUCKETS,
  RESET_GROUPS,
  RESET_GROUP_KEYS,
  bucketsFor,
  removeWithDependents,
  sanitizeGroups,
  withDependencies,
} from "./trial-reset-groups";

describe("sanitizeGroups", () => {
  it("accepts valid keys, de-duplicates and puts them in canonical order", () => {
    expect(sanitizeGroups(["students", "fees", "fees"])).toEqual(["fees", "students"]);
  });
  it("rejects anything that is not a known group", () => {
    expect(sanitizeGroups(["fees", "everything"])).toBeNull();
    expect(sanitizeGroups("fees")).toBeNull();
    expect(sanitizeGroups(null)).toBeNull();
    expect(sanitizeGroups([1])).toBeNull();
  });
  it("allows an empty selection (the action rejects it separately)", () => {
    expect(sanitizeGroups([])).toEqual([]);
  });
});

describe("withDependencies", () => {
  it("leaves independent groups alone", () => {
    expect(withDependencies(["fees"])).toEqual({ groups: ["fees"], added: [] });
  });
  it("students pulls in fees, academics, applications and other", () => {
    const r = withDependencies(["students"]);
    expect(r.groups).toEqual(["fees", "academics", "applications", "other", "students"]);
    expect(r.added).toEqual(["fees", "academics", "applications", "other"]);
  });
  it("setup pulls in students and, transitively, everything else", () => {
    const r = withDependencies(["setup"]);
    expect(r.groups).toEqual([...RESET_GROUP_KEYS]);
    expect(r.added).toEqual(["fees", "academics", "applications", "other", "students"]);
  });
  it("does not report groups the caller already ticked as added", () => {
    expect(withDependencies(["fees", "students"]).added).toEqual(["academics", "applications", "other"]);
  });
});

describe("bucketsFor", () => {
  it("returns only the buckets of the selected groups", () => {
    expect(bucketsFor(["applications"])).toEqual(["application-documents"]);
    expect(bucketsFor(["fees"])).toEqual([]);
  });
  it("never includes a protected bucket, whatever the groups", () => {
    const all = bucketsFor([...RESET_GROUP_KEYS]);
    for (const b of PROTECTED_BUCKETS) expect(all).not.toContain(b);
  });
  it("no group claims a protected bucket", () => {
    for (const g of RESET_GROUPS) for (const b of g.buckets) expect(PROTECTED_BUCKETS).not.toContain(b);
  });
});

describe("always-kept list", () => {
  it("is shown to owners", () => {
    expect(ALWAYS_KEPT.length).toBeGreaterThan(0);
  });
});

// Drift guard: the database function is the authority. If someone changes the group names or dependency
// rules there (or here) without updating the other side, this fails.
describe("matches the database migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261031190000_trial_school_reset.sql"),
    "utf8",
  );

  it("has the same groups in the same order", () => {
    const m = sql.match(/c_group_order constant text\[\] := array\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const keys = [...(m as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(keys).toEqual([...RESET_GROUP_KEYS]);
  });

  it("enforces the same dependency rules", () => {
    const rule = (target: string) => {
      const re = new RegExp(`'${target}' = any \\(v_groups\\) and not \\(v_groups @> array\\[([^\\]]*)\\]`);
      const m = sql.match(re);
      expect(m, `no dependency rule for ${target}`).not.toBeNull();
      return [...(m as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    };
    // The SQL lists the full transitive set; compare with the closure computed here.
    expect(rule("students")).toEqual(
      withDependencies(["students"]).groups.filter((g) => g !== "students").sort(),
    );
    expect(rule("setup")).toEqual(withDependencies(["setup"]).groups.filter((g) => g !== "setup").sort());
  });
});

describe("removeWithDependents", () => {
  it("unticking fees also unticks students and setup, which need it", () => {
    expect(removeWithDependents([...RESET_GROUP_KEYS], "fees")).toEqual(["academics", "applications", "other"]);
  });
  it("unticking students unticks setup but keeps the independent groups", () => {
    expect(removeWithDependents([...RESET_GROUP_KEYS], "students")).toEqual(["fees", "academics", "applications", "other"]);
  });
  it("unticking setup changes nothing else", () => {
    expect(removeWithDependents([...RESET_GROUP_KEYS], "setup")).toEqual(["fees", "academics", "applications", "other", "students"]);
  });
});
