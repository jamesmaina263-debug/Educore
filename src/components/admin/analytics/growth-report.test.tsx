import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));

const { GrowthReport } = await import("./growth-report");

async function render() {
  return renderToStaticMarkup(await GrowthReport({ startIso: "2026-10-01", endIso: "2026-10-17" }));
}

const EMPTY = {
  from: "2026-10-01",
  to: "2026-10-17",
  demo_requests: { total: 0, in_pipeline: 0, by_campaign: [] },
  leads_created: { total: 0, by_source: [] },
  pipeline_now: { by_stage: {}, open: 0, overdue_followups: 0, due_today: 0, no_followup: 0 },
  lead_cohort: { created: 0, at_or_past_demo_booked: 0, at_or_past_demo_done: 0, pilot_or_paid: 0, paid: 0, lost: 0 },
  lost: { in_period: 0, reasons: [] },
  trials: { started: 0, by_status: {}, paid_invoice: 0, by_campaign: [] },
  ai_usage: [],
};

beforeEach(() => h.rpc.mockReset());

describe("GrowthReport", () => {
  it("asks the database for exactly the page's range", async () => {
    h.rpc.mockResolvedValue({ data: EMPTY, error: null });
    await render();
    expect(h.rpc).toHaveBeenCalledWith("admin_growth_report", { p_from: "2026-10-01", p_to: "2026-10-17" });
  });

  it("shows real figures, a lead's source label, and the rates", async () => {
    h.rpc.mockResolvedValue({
      data: {
        ...EMPTY,
        demo_requests: {
          total: 8,
          in_pipeline: 6,
          by_campaign: [{ campaign: "kenya-schools", requests: 8, in_pipeline: 6, reached_demo: 2, paid: 1 }],
        },
        leads_created: { total: 14, by_source: [{ source: "inbound_web", n: 14 }] },
        lead_cohort: { created: 14, at_or_past_demo_booked: 7, at_or_past_demo_done: 4, pilot_or_paid: 2, paid: 1, lost: 3 },
        trials: { started: 12, by_status: { trialing: 9, active: 3 }, paid_invoice: 3, by_campaign: [] },
        ai_usage: [{ action: "score_outbound_prospects", calls: 4, total_tokens: 25000 }],
      },
      error: null,
    });
    const html = await render();
    expect(html).toContain("Inbound (website)");
    expect(html).toContain("kenya-schools");
    expect(html).toContain("75.0%"); // 6 of 8 demo requests reached the pipeline
    expect(html).toContain("50.0%"); // 7 of 14 leads at or past demo booked
    expect(html).toContain("25.0%"); // 3 of 12 trials have paid an invoice
    expect(html).toContain("25,000"); // tokens
    expect(html).toContain("Outreach scoring and drafts");
    expect(html).toContain("Not in the pipeline yet"); // 8 - 6 = 2 are still waiting
  });

  it("never shows a percentage when there is nothing to divide by, and says so for empty periods", async () => {
    h.rpc.mockResolvedValue({ data: EMPTY, error: null });
    const html = await render();
    expect(html).not.toContain("%");
    expect(html).not.toContain("NaN");
    expect(html).toContain("No leads were created in this period.");
    expect(html).toContain("No demo requests in this period.");
  });

  it("flags small samples so a percentage is not read as a trend", async () => {
    h.rpc.mockResolvedValue({
      data: { ...EMPTY, lead_cohort: { ...EMPTY.lead_cohort, created: 4, paid: 1 } },
      error: null,
    });
    expect(await render()).toContain("read the percentages as anecdotes");
  });

  it("lists what is not tracked instead of showing it as zero", async () => {
    h.rpc.mockResolvedValue({ data: EMPTY, error: null });
    const html = await render();
    expect(html).toContain("Not tracked yet");
    expect(html).toContain("Trial activation and onboarding milestones");
    expect(html).toContain("no cost is estimated");
  });

  it("fails soft: a database error shows a plain message and no numbers, and does not throw", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "function admin_growth_report does not exist" } });
    const html = await render();
    expect(html).toContain("could not be loaded");
    expect(html).toContain("does not exist");
    expect(html).toContain("nothing is shown");
    expect(html).not.toContain("Demo requests");
  });

  it("treats a malformed response the same way", async () => {
    h.rpc.mockResolvedValue({ data: "garbage", error: null });
    expect(await render()).toContain("could not be loaded");
  });
});
