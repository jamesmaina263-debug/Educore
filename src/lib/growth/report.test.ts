import { describe, expect, it } from "vitest";
import { aiActionLabel, isSmallSample, NOT_TRACKED_YET, parseGrowthReport, ratePct } from "./report";

const FULL = {
  from: "2026-10-01",
  to: "2026-10-17",
  demo_requests: {
    total: 12,
    in_pipeline: 9,
    by_campaign: [{ campaign: "kenya-schools", requests: 7, in_pipeline: 6, reached_demo: 2, paid: 1 }],
  },
  leads_created: { total: 5, by_source: [{ source: "inbound_web", n: 3 }, { source: "outbound", n: 2 }] },
  pipeline_now: { by_stage: { new: 4, paid: 1 }, open: 4, overdue_followups: 1, due_today: 2, no_followup: 1 },
  lead_cohort: { created: 5, at_or_past_demo_booked: 3, at_or_past_demo_done: 2, pilot_or_paid: 1, paid: 1, lost: 1 },
  lost: { in_period: 1, reasons: [{ reason: "went with competitor", n: 1 }] },
  trials: {
    started: 6,
    by_status: { trialing: 5, active: 1 },
    paid_invoice: 1,
    by_campaign: [{ campaign: "(none)", trials: 6, paid_invoice: 1 }],
  },
  ai_usage: [{ action: "score_outbound_prospects", calls: 3, total_tokens: 12345 }],
};

describe("parseGrowthReport", () => {
  it("maps a full response", () => {
    const r = parseGrowthReport(FULL)!;
    expect(r.demoRequests).toEqual({
      total: 12,
      inPipeline: 9,
      byCampaign: [{ campaign: "kenya-schools", requests: 7, inPipeline: 6, reachedDemo: 2, paid: 1 }],
    });
    expect(r.leadsCreated.bySource).toEqual([
      { label: "inbound_web", n: 3 },
      { label: "outbound", n: 2 },
    ]);
    expect(r.pipelineNow).toMatchObject({ open: 4, overdueFollowups: 1, dueToday: 2, noFollowup: 1, byStage: { new: 4, paid: 1 } });
    expect(r.leadCohort.atOrPastDemoDone).toBe(2);
    expect(r.lost.reasons).toEqual([{ label: "went with competitor", n: 1 }]);
    expect(r.trials).toMatchObject({ started: 6, paidInvoice: 1, byStatus: { trialing: 5, active: 1 } });
    expect(r.aiUsage).toEqual([{ action: "score_outbound_prospects", calls: 3, totalTokens: 12345 }]);
  });

  it.each([null, undefined, "x", 5, [], [1]])("returns null for a non-object (%j)", (v) => {
    expect(parseGrowthReport(v)).toBeNull();
  });

  it("turns missing sections into zeros and empty lists, never NaN or a throw", () => {
    const r = parseGrowthReport({})!;
    expect(r.demoRequests).toEqual({ total: 0, inPipeline: 0, byCampaign: [] });
    expect(r.pipelineNow).toEqual({ byStage: {}, open: 0, overdueFollowups: 0, dueToday: 0, noFollowup: 0 });
    expect(r.trials).toEqual({ started: 0, byStatus: {}, paidInvoice: 0, byCampaign: [] });
    expect(r.aiUsage).toEqual([]);
  });

  it("rejects bad numbers and bad rows instead of propagating them", () => {
    const r = parseGrowthReport({
      demo_requests: { total: "12", in_pipeline: -3, by_campaign: [null, 5, "x", { campaign: "", requests: "abc" }] },
      leads_created: { total: Infinity, by_source: "nope" },
      pipeline_now: { by_stage: { new: "7", odd: {} } },
    })!;
    expect(r.demoRequests.total).toBe(12);
    expect(r.demoRequests.inPipeline).toBe(0);
    expect(r.demoRequests.byCampaign).toEqual([{ campaign: "(none)", requests: 0, inPipeline: 0, reachedDemo: 0, paid: 0 }]);
    expect(r.leadsCreated).toEqual({ total: 0, bySource: [] });
    expect(r.pipelineNow.byStage).toEqual({ new: 7, odd: 0 });
  });
});

describe("ratePct", () => {
  it("formats a rate and returns null for an empty denominator", () => {
    expect(ratePct(3, 8)).toBe("37.5%");
    expect(ratePct(0, 5)).toBe("0.0%");
    expect(ratePct(0, 0)).toBeNull();
    expect(ratePct(2, 0)).toBeNull();
  });
});

describe("small samples and labels", () => {
  it("flags counts between 1 and 9 only", () => {
    expect(isSmallSample(0)).toBe(false);
    expect(isSmallSample(1)).toBe(true);
    expect(isSmallSample(9)).toBe(true);
    expect(isSmallSample(10)).toBe(false);
  });
  it("labels AI actions and passes unknown ones through", () => {
    expect(aiActionLabel("score_outbound_prospects")).toBe("Outreach scoring and drafts");
    expect(aiActionLabel("something_else")).toBe("something_else");
  });
  it("lists what is not tracked, each with a reason", () => {
    expect(NOT_TRACKED_YET.length).toBeGreaterThan(0);
    for (const n of NOT_TRACKED_YET) expect(n.why.length).toBeGreaterThan(10);
  });
});
