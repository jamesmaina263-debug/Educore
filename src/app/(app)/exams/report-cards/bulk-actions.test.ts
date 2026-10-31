import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every report_cards update so the test can see exactly which rows the action tried to approve.
type Update = { values: Record<string, unknown>; ids: string[]; sourceGuard: unknown };
const h = vi.hoisted(() => ({
  user: { id: "auth-1" } as { id: string } | null,
  roster: [] as { id: string }[],
  cards: [] as { id: string; student_id: string; comment: string | null; comment_source: string }[],
  /** ids the (RLS-simulating) update is allowed to touch; null = all */
  allowedIds: null as Set<string> | null,
  updates: [] as Update[],
  cardFilters: [] as Record<string, unknown>[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let update: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        update: (v: Record<string, unknown>) => ((update = v), b),
        eq: (k: string, v: unknown) => ((filters[k] = v), b),
        in: (k: string, v: unknown) => ((filters[k] = v), b),
        maybeSingle: () => Promise.resolve({ data: table === "school_users" ? { id: "su-1" } : null, error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "students") return Promise.resolve({ data: h.roster, error: null }).then(resolve);
          if (table === "report_cards" && update) {
            const ids = filters.id as string[];
            h.updates.push({ values: update, ids, sourceGuard: filters.comment_source });
            const touched = ids.filter((id) => (h.allowedIds ? h.allowedIds.has(id) : true)).map((id) => ({ id }));
            return Promise.resolve({ data: touched, error: null }).then(resolve);
          }
          if (table === "report_cards") {
            h.cardFilters.push({ ...filters });
            const wanted = new Set(filters.student_id as string[]);
            return Promise.resolve({ data: h.cards.filter((c) => wanted.has(c.student_id)), error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));

const { approveStreamComments } = await import("./bulk-actions");

const ids = {
  exam_id: "11111111-1111-4111-8111-111111111111",
  class_id: "22222222-2222-4222-8222-222222222222",
  stream_id: "33333333-3333-4333-8333-333333333333",
};

const card = (n: number, source: string, comment: string | null) => ({ id: `c${n}`, student_id: `s${n}`, comment, comment_source: source });

beforeEach(() => {
  h.user = { id: "auth-1" };
  h.allowedIds = null;
  h.updates = [];
  h.cardFilters = [];
  h.roster = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }];
  h.cards = [card(1, "ai", "Good work."), card(2, "none", "Kept after a fix."), card(3, "none", null), card(4, "ai", "   "), card(5, "teacher_approved", "Out already.")];
});

describe("approveStreamComments", () => {
  it("approves only unreleased cards that have comment text, as the signed-in approver", async () => {
    const res = await approveStreamComments(ids);
    expect(res).toEqual({ approved: 2, skipped: 0 });
    const approvedIds = h.updates.flatMap((u) => u.ids).sort();
    expect(approvedIds).toEqual(["c1", "c2"]);
    expect(h.updates[0].values).toMatchObject({ comment_source: "teacher_approved", approved_by: "su-1" });
    expect(h.updates[0].values.approved_at).toBeTruthy();
    // Race guard: a card that changed since it was read is not re-approved.
    expect(h.updates[0].sourceGuard).toEqual(["ai", "none"]);
  });

  it("reads cards for this exam and class only, limited to unreleased sources", async () => {
    await approveStreamComments(ids);
    expect(h.cardFilters[0]).toMatchObject({ exam_id: ids.exam_id, class_id: ids.class_id, comment_source: ["ai", "none"] });
  });

  it("reports rows it was not allowed to approve as skipped", async () => {
    h.allowedIds = new Set(["c1"]); // RLS: a class teacher who owns only some of these
    expect(await approveStreamComments(ids)).toEqual({ approved: 1, skipped: 1 });
  });

  it("errors, rather than claiming success, when nothing could be approved", async () => {
    h.allowedIds = new Set();
    expect(await approveStreamComments(ids)).toEqual({ error: "You don't have permission to approve these report cards." });
  });

  it("does nothing when there is nothing to approve", async () => {
    h.cards = [card(3, "none", null), card(5, "teacher_approved", "x")];
    expect(await approveStreamComments(ids)).toEqual({ approved: 0, skipped: 0 });
    expect(h.updates).toHaveLength(0);
  });

  it("does nothing for an empty stream", async () => {
    h.roster = [];
    expect(await approveStreamComments(ids)).toEqual({ approved: 0, skipped: 0 });
    expect(h.updates).toHaveLength(0);
  });

  it("updates in small batches", async () => {
    h.roster = Array.from({ length: 60 }, (_, i) => ({ id: `s${i + 1}` }));
    h.cards = Array.from({ length: 60 }, (_, i) => card(i + 1, "ai", "Fine."));
    expect(await approveStreamComments(ids)).toEqual({ approved: 60, skipped: 0 });
    expect(h.updates).toHaveLength(3); // 25 + 25 + 10
    expect(Math.max(...h.updates.map((u) => u.ids.length))).toBeLessThanOrEqual(25);
  });

  it("rejects bad ids and signed-out callers before touching anything", async () => {
    expect(await approveStreamComments({ ...ids, stream_id: "nope" })).toEqual({ error: "Invalid request." });
    h.user = null;
    expect(await approveStreamComments(ids)).toEqual({ error: "Your session has expired. Please sign in again." });
    expect(h.updates).toHaveLength(0);
  });
});
