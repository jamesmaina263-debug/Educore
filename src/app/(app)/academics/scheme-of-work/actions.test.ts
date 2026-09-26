import { describe, expect, it, vi, beforeEach } from "vitest";

// next/cache's revalidatePath needs a live Next.js request context; outside
// one (as here, under vitest) it throws. moveSchemeEntry calls it on every
// success path, so it's mocked the same way any other side effect would be.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// tagSentryRequestContext is exercised for real (it swallows its own errors
// -- see src/lib/observability/sentry-context.ts), so the fake client below
// only needs to give its two calls (auth.getUser, rpc) something to resolve.

type Result = { data?: unknown; error?: { code?: string; message: string } | null };

// Same minimal chainable supabase-js stand-in as
// src/lib/marketing/demo-partial-store.test.ts, extended with the two calls
// tagSentryRequestContext makes on every action (auth.getUser, rpc) so real,
// unmodified production code can run against it unmodified.
function fakeClient(results: Result[]) {
  const calls: { op: string; args: unknown[] }[] = [];
  const next = () => Promise.resolve({ data: null, error: null, ...(results.shift() ?? {}) });
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "insert", "update", "delete", "eq"]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return chain;
    };
  }
  chain.maybeSingle = () => next();
  chain.single = () => next();
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);

  return {
    from: vi.fn(() => chain),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    calls,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// actions.ts imports createAdminClient from @/lib/supabase/admin at module
// scope (used by generateSchemeWithAI/assistSchemeEntry, not by
// moveSchemeEntry) -- that module itself imports the "server-only" package,
// which throws when loaded outside an RSC/server-action compile boundary
// (i.e. under vitest). Not exercised by any test here, so a stub is enough.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

describe("moveSchemeEntry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWithClient(results: Result[]) {
    const client = fakeClient(results);
    const { createClient } = await import("@/lib/supabase/server");
    vi.mocked(createClient).mockResolvedValue(client as never);
    const { moveSchemeEntry } = await import("./actions");
    return { moveSchemeEntry, client };
  }

  it("rejects a missing entry id without touching the database", async () => {
    const { moveSchemeEntry, client } = await loadWithClient([]);
    const result = await moveSchemeEntry("", { week_number: 2, lesson_number: 1 });
    expect(result).toEqual({ error: "Missing entry." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    [{ week_number: 0, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 53, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 1.5, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 2, lesson_number: 0 }, "Invalid lesson number."],
    [{ week_number: 2, lesson_number: 21 }, "Invalid lesson number."],
  ])("rejects an out-of-range target %o", async (target, message) => {
    const { moveSchemeEntry, client } = await loadWithClient([]);
    const result = await moveSchemeEntry("entry-1", target);
    expect(result).toEqual({ error: message });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates only week_number/lesson_number on success, leaving every other column untouched", async () => {
    const { moveSchemeEntry, client } = await loadWithClient([{ data: { id: "entry-1" } }]);
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ success: true, entryId: "entry-1" });

    const update = client.calls.find((c) => c.op === "update");
    expect(update?.args[0]).toEqual({ week_number: 4, lesson_number: 2 });
    const eqTarget = client.calls.find((c) => c.op === "eq");
    expect(eqTarget?.args).toEqual(["id", "entry-1"]);
  });

  it("surfaces the existing-slot conflict as a friendly message", async () => {
    const { moveSchemeEntry } = await loadWithClient([{ error: { code: "23505", message: "duplicate key" } }]);
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "There's already a lesson at that week and lesson number." });
  });

  it("reports a generic failure for any other database error", async () => {
    const { moveSchemeEntry } = await loadWithClient([{ error: { code: "XX000", message: "boom" } }]);
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "Something went wrong while moving. Please try again." });
  });

  it("treats a no-op update (RLS-hidden or already-deleted row) as no permission / not found", async () => {
    const { moveSchemeEntry } = await loadWithClient([{ data: null, error: null }]);
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "You don't have permission to edit this entry, or it no longer exists." });
  });
});
