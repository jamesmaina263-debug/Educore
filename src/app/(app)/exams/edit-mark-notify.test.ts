import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), updated: [{ student_id: "s1" }] as { student_id: string }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {}, setSentryRequestContext: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: h.rpc,
    from() {
      const b: Record<string, unknown> = {
        update: () => b,
        eq: () => b,
        select: () => b,
        then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: h.updated, error: null }).then(resolve),
      };
      return b;
    },
  }),
}));

const { editMark } = await import("./actions");

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: 0, error: null });
  h.updated = [{ student_id: "s1" }];
});

describe("editMark: staff notification", () => {
  it("asks for a needs_reapproval notification when a score is corrected", async () => {
    expect(await editMark({ exam_id: "e1", student_id: "s1", subject_id: "sub", raw_score: 70, edit_reason: "Marking error" })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("notify_report_card_event", { p_event: "needs_reapproval", p_exam_id: "e1", p_class_id: null, p_stream_id: null, p_student_id: "s1" });
  });

  it("does not for a grade-band-only edit (the approval reset only fires on a changed raw score)", async () => {
    await editMark({ exam_id: "e1", student_id: "s1", subject_id: "sub", band_id: "b1", edit_reason: "Typo" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("does not when the edit itself was refused", async () => {
    h.updated = [];
    expect(await editMark({ exam_id: "e1", student_id: "s1", subject_id: "sub", raw_score: 70, edit_reason: "x" })).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a failing notification never fails the correction", async () => {
    h.rpc.mockRejectedValue(new Error("down"));
    expect(await editMark({ exam_id: "e1", student_id: "s1", subject_id: "sub", raw_score: 70, edit_reason: "x" })).toEqual({ success: true });
  });
});
