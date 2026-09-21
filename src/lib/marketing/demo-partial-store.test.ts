import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { markIncompleteLeadCompleted, saveIncompleteLead } from "./demo-partial-store";
import { parseAttributionFormData } from "./attribution-fields";

const contact = {
  name: "Jane",
  schoolName: "Sunrise Academy",
  email: "jane@sunrise.ac.ke",
  phone: null,
};
const attribution = parseAttributionFormData(new FormData());

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

// Minimal chainable stand-in for the supabase-js query builder. Every builder method returns
// the same chain; awaiting it (or maybeSingle) resolves to the next queued result.
function fakeAdmin(results: Result[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const next = () => Promise.resolve({ data: null, error: null, ...(results.shift() ?? {}) });
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "insert", "update", "eq"]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return chain;
    };
  }
  chain.maybeSingle = () => next();
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    next().then(resolve, reject);
  const admin = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("saveIncompleteLead", () => {
  it("inserts a new row when there is no open lead for the email", async () => {
    const { admin, calls } = fakeAdmin([{ data: null }, { error: null }]);
    await expect(saveIncompleteLead(admin, contact, attribution, "/contact")).resolves.toBe(true);
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.args[0]).toMatchObject({
      email: "jane@sunrise.ac.ke",
      school_name: "Sunrise Academy",
      source_page: "/contact",
    });
  });

  it("refreshes the existing open row instead of inserting a duplicate", async () => {
    const { admin, calls } = fakeAdmin([{ data: { id: "abc" } }, { error: null }]);
    await expect(saveIncompleteLead(admin, contact, attribution, null)).resolves.toBe(true);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.some((c) => c.op === "update")).toBe(true);
  });

  it("falls back to an update when a concurrent request wins the insert (unique violation)", async () => {
    const { admin, calls } = fakeAdmin([
      { data: null },
      { error: { code: "23505", message: "duplicate key" } },
      { error: null },
    ]);
    await expect(saveIncompleteLead(admin, contact, attribution, null)).resolves.toBe(true);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("returns false (never throws) when the table is missing or the insert fails", async () => {
    const missing = fakeAdmin([{ data: null, error: { code: "42P01", message: "no such table" } }]);
    await expect(saveIncompleteLead(missing.admin, contact, attribution, null)).resolves.toBe(false);

    const failed = fakeAdmin([{ data: null }, { error: { code: "XX000", message: "boom" } }]);
    await expect(saveIncompleteLead(failed.admin, contact, attribution, null)).resolves.toBe(false);
  });

  it("returns false when the client itself throws", async () => {
    const admin = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient;
    await expect(saveIncompleteLead(admin, contact, attribution, null)).resolves.toBe(false);
  });
});

describe("markIncompleteLeadCompleted", () => {
  it("marks only the open lead for that email as completed", async () => {
    const { admin, calls } = fakeAdmin([{ error: null }]);
    await markIncompleteLeadCompleted(admin, "jane@sunrise.ac.ke");
    expect(calls.find((c) => c.op === "update")?.args[0]).toMatchObject({ status: "completed" });
    const eqs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["email", "jane@sunrise.ac.ke"]);
    expect(eqs).toContainEqual(["status", "incomplete"]);
  });

  it("swallows errors", async () => {
    const admin = {
      from: () => {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(markIncompleteLeadCompleted(admin, "a@b.co")).resolves.toBeUndefined();
  });
});
