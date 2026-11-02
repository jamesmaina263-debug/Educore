import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  blank: null as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
  filters: {} as Record<string, unknown>,
  numberRpc: vi.fn(),
}));

class Redirect extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "auth-1" } } }) },
    rpc: h.numberRpc,
    from(table: string) {
      const f: Record<string, unknown> = {};
      let inserting: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (v: Record<string, unknown>) => ((inserting = v), b),
        eq: (k: string, v: unknown) => ((f[k] = v), b),
        is: (k: string, v: unknown) => ((f[`is:${k}`] = v), b),
        gte: (k: string, v: unknown) => ((f[`gte:${k}`] = v), b),
        order: () => b,
        limit: () => b,
        single: async () => {
          if (inserting) {
            h.inserted.push(inserting);
            return { data: { id: "new-app" }, error: null };
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          if (table === "school_users") return { data: { id: "su-1", school_id: "sc-1" }, error: null };
          h.filters = f;
          return { data: h.blank, error: null };
        },
      };
      return b;
    },
  }),
}));

const { createWalkInApplication } = await import("./walk-in-actions");

async function run(): Promise<string> {
  try {
    await createWalkInApplication();
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  h.blank = null;
  h.inserted = [];
  h.filters = {};
  h.numberRpc.mockReset();
  h.numberRpc.mockResolvedValue({ data: "APP/001", error: null });
});

describe("createWalkInApplication", () => {
  it("creates a draft when the officer has no blank one", async () => {
    expect(await run()).toBe("/admissions/new-app/wizard");
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ school_id: "sc-1", status: "draft", application_source: "walk_in", assigned_officer_id: "su-1", wizard_current_step: 0 });
  });

  it("opens the officer's own blank recent draft instead of piling up another empty one", async () => {
    h.blank = { id: "existing-blank" };
    expect(await run()).toBe("/admissions/existing-blank/wizard");
    expect(h.inserted).toHaveLength(0);
    expect(h.numberRpc).not.toHaveBeenCalled(); // no application number is burned either
  });

  it("only reuses THEIR OWN, un-named, un-advanced walk-in draft from the last 30 minutes in their school", async () => {
    h.blank = { id: "x" };
    await run().catch(() => {});
    expect(h.filters).toMatchObject({
      school_id: "sc-1",
      assigned_officer_id: "su-1",
      application_source: "walk_in",
      status: "draft",
      wizard_current_step: 0,
      "is:first_name": null,
      "is:last_name": null,
    });
    const since = new Date(String(h.filters["gte:created_at"])).getTime();
    expect(Date.now() - since).toBeGreaterThan(29 * 60_000);
    expect(Date.now() - since).toBeLessThan(31 * 60_000);
  });
});
