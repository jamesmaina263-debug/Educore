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
