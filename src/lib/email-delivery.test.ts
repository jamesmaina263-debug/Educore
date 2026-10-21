import { describe, expect, it } from "vitest";
import { deliveryRates, parseEmailDeliverySummary } from "./email-delivery";

describe("parseEmailDeliverySummary", () => {
  it("maps totals, senders and problems", () => {
    const s = parseEmailDeliverySummary({
      totals: { delivered: "40", bounced: 2, complained: 1, delayed: 0, failed: 0 },
      senders: [{ from_address: "hello@educoreafrica.com", delivered: 40, bounced: 2, complained: 1 }],
      problems: [
        { kenya_time: "2026-10-21 09:00", event_type: "email.bounced", to_address: "a@b.ke", subject: "Hi", bounce_type: "Permanent / General", bounce_reason: "no mailbox" },
        { kenya_time: "2026-10-21 10:00", event_type: "email.complained", to_address: "c@d.ke" },
        { event_type: "email.delivered" },
      ],
      tracking_since: "2026-10-21T08:00:00Z",
      total_events: 43,
    })!;
    expect(s.totals).toEqual({ delivered: 40, bounced: 2, complained: 1, delayed: 0, failed: 0 });
    expect(s.senders[0].fromAddress).toBe("hello@educoreafrica.com");
    expect(s.problems.map((p) => p.type)).toEqual(["bounced", "complained"]);
    expect(s.problems[0]).toMatchObject({ to: "a@b.ke", bounceType: "Permanent / General", reason: "no mailbox" });
    expect(s.totalEvents).toBe(43);
  });
  it("turns bad or missing values into zeros and empty lists, and rejects non-objects", () => {
    const s = parseEmailDeliverySummary({ totals: { delivered: "x", bounced: -3 }, senders: "no", problems: null })!;
    expect(s.totals).toEqual({ delivered: 0, bounced: 0, complained: 0, delayed: 0, failed: 0 });
    expect(s.senders).toEqual([]);
    expect(s.problems).toEqual([]);
    expect(s.trackingSince).toBeNull();
    expect(parseEmailDeliverySummary(null)).toBeNull();
    expect(parseEmailDeliverySummary([])).toBeNull();
  });
});

describe("deliveryRates", () => {
  it("computes bounce and complaint rates", () => {
    expect(deliveryRates({ delivered: 96, bounced: 4, complained: 1, delayed: 0, failed: 0 })).toEqual({ bounceRate: "4.0%", complaintRate: "1.0%", outcomes: 100 });
  });
  it("never divides by zero", () => {
    expect(deliveryRates({ delivered: 0, bounced: 0, complained: 0, delayed: 2, failed: 1 })).toEqual({ bounceRate: null, complaintRate: null, outcomes: 0 });
    expect(deliveryRates({ delivered: 0, bounced: 3, complained: 0, delayed: 0, failed: 0 }).bounceRate).toBe("100.0%");
  });
});
