import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));

const { generateReportCards } = await import("./actions");

beforeEach(() => {
  h.rpc.mockReset();
  h.revalidate.mockReset();
});

describe("generateReportCards", () => {
  it("calls the existing RPC and reports how many NEW cards it created", async () => {
    h.rpc.mockResolvedValue({ data: 12, error: null });
    expect(await generateReportCards("e1", "c1")).toEqual({ success: true, created: 12 });
    expect(h.rpc).toHaveBeenCalledWith("generate_report_cards", { p_exam_id: "e1", p_class_id: "c1" });
    expect(h.revalidate).toHaveBeenCalledWith("/exams/report-cards");
  });
  it("reports 0 when the class was already complete", async () => {
    h.rpc.mockResolvedValue({ data: 0, error: null });
    expect(await generateReportCards("e1", "c1")).toEqual({ success: true, created: 0 });
  });
  it("skips the page re-render when asked (bulk runs refresh once at the end)", async () => {
    h.rpc.mockResolvedValue({ data: 3, error: null });
    await generateReportCards("e1", "c1", { skipRevalidate: true });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
  it("passes the database's refusal straight through (permission, exam not closed)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Report cards can only be generated from a closed exam." } });
    expect(await generateReportCards("e1", "c1")).toEqual({ error: "Report cards can only be generated from a closed exam." });
    expect(h.revalidate).not.toHaveBeenCalled();
  });
});

describe("generateReportCards: staff notification", () => {
  const notifyCalls = () => h.rpc.mock.calls.filter((c) => c[0] === "notify_report_card_event");

  it("tells the class teachers the cards are ready when new cards were created", async () => {
    h.rpc.mockResolvedValue({ data: 5, error: null });
    await generateReportCards("e1", "c1");
    expect(notifyCalls()).toHaveLength(1);
    expect(notifyCalls()[0][1]).toEqual({ p_event: "ready_for_comments", p_exam_id: "e1", p_class_id: "c1", p_stream_id: null, p_student_id: null });
  });

  it("stays quiet when nothing new was created (already complete)", async () => {
    h.rpc.mockResolvedValue({ data: 0, error: null });
    await generateReportCards("e1", "c1");
    expect(notifyCalls()).toHaveLength(0);
  });

  it("stays quiet when generation failed", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not authorized to generate report cards." } });
    await generateReportCards("e1", "c1");
    expect(notifyCalls()).toHaveLength(0);
  });

  it("a failing notification does not fail generation", async () => {
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "notify_report_card_event") throw new Error("down");
      return { data: 4, error: null };
    });
    expect(await generateReportCards("e1", "c1")).toEqual({ success: true, created: 4 });
  });
});
