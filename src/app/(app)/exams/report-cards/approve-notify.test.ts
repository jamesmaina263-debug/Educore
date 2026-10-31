import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), updated: [{ student_id: "s1" }] as { student_id: string }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {}, setSentryRequestContext: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    auth: { getUser: async () => ({ data: { user: { id: "auth-1" } } }) },
    from() {
      const b: Record<string, unknown> = {
        select: () => b,
        update: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { id: "su-1" }, error: null }),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: h.updated, error: null }).then(resolve),
      };
      return b;
    },
  }),
}));

const { approveComment } = await import("./actions");

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 0, error: null });
  h.updated = [{ student_id: "s1" }];
});

describe("approveComment: staff notification", () => {
  it("tells the class teacher a comment on their stream was approved", async () => {
    expect(await approveComment({ exam_id: "e1", student_id: "s1" })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("notify_report_card_event", { p_event: "approved", p_exam_id: "e1", p_class_id: null, p_stream_id: null, p_student_id: "s1" });
  });

  it("sends nothing when the approval did not happen (no permission / not generated)", async () => {
    h.updated = [];
    expect(await approveComment({ exam_id: "e1", student_id: "s1" })).toMatchObject({ error: expect.stringContaining("permission") });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a failing notification never fails the approval", async () => {
    h.rpc.mockRejectedValue(new Error("down"));
    expect(await approveComment({ exam_id: "e1", student_id: "s1" })).toEqual({ success: true });
  });
});
