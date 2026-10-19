import { describe, expect, it } from "vitest";
import {
  LIMITS,
  SERVICE_STARTERS,
  approvalExpiresAt,
  approvalLapsed,
  contentProblem,
  proposalLapsed,
  sentInLast24h,
  splitQueue,
  validateProposal,
} from "./trial-nudges";

const NOW = new Date("2026-10-18T09:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("contentProblem (mirrors the database rules)", () => {
  it("accepts a plain service message with placeholders and an educoreafrica.com link", () => {
    const body = "Hello {{name}},\n\nYour 30-day free trial is running. No card required. See https://www.educoreafrica.com/help or write to hello@educoreafrica.com.";
    expect(contentProblem("service", "Welcome, {{ school }}", body)).toBeNull();
  });

  it("ships starters that pass their own rules", () => {
    for (const t of SERVICE_STARTERS) expect(contentProblem("service", t.subject, t.body), t.key).toBeNull();
  });

  it("refuses claims the product does not make, in the subject or the body, in any letter case", () => {
    expect(contentProblem("service", "Hi", "We offer no obligation to continue.")).toMatch(/no obligation/);
    expect(contentProblem("service", "Hi", "EduCore is KICD approved.")).toMatch(/kicd approved/);
    expect(contentProblem("service", "Ministry-Approved software", "Hello")).toMatch(/ministry-approved/);
    expect(contentProblem("promotional", "Hi", "Results are Guaranteed.")).toMatch(/guaranteed/);
  });

  it("allows only {{name}} and {{school}} as placeholders", () => {
    expect(contentProblem("service", "Hi", "Hello {{foo}}")).toBe("Only {{name}} and {{school}} can be used as placeholders.");
    expect(contentProblem("service", "Hi", "Hello {{name}} }}")).toBe("Only {{name}} and {{school}} can be used as placeholders.");
    expect(contentProblem("service", "Hi", "Hello {{ name }} from {{school}}")).toBeNull();
  });

  it("refuses links and addresses outside educoreafrica.com", () => {
    expect(contentProblem("service", "Hi", "Pay at https://bit.ly/x1")).toMatch(/bit\.ly/);
    expect(contentProblem("service", "Hi", "Visit evil-school.co.ke now")).toMatch(/evil-school\.co\.ke/);
    expect(contentProblem("service", "Hi", "Mail me at someone@gmail.com")).toMatch(/gmail\.com/);
    expect(contentProblem("service", "Hi", "See educoreafrica.com.evil.org")).toMatch(/evil\.org|educoreafrica\.com\.evil\.org/);
    expect(contentProblem("service", "Hi", "See https://app.educoreafrica.com/x")).toBeNull();
  });

  it("does not let an offer pass as a service message, but allows it as promotional", () => {
    for (const text of ["Get a discount today", "20% off for you", "A special offer", "limited-time deal", "your first free month", "use this coupon", "we will waive the fee"]) {
      expect(contentProblem("service", "Hi", text), text).toBe("This reads like an offer. Send it as a promotional message instead.");
      expect(contentProblem("promotional", "Hi", text), text).toBeNull();
    }
    // ordinary words that merely contain an offer-like fragment are fine
    expect(contentProblem("service", "Hi", "We promote careful record keeping and offer help on request.")).toBeNull();
  });

  it("checks required fields, lengths and the kind", () => {
    expect(contentProblem("banner", "Hi", "Body")).toBe("Choose service or promotional.");
    expect(contentProblem("service", "  ", "Body")).toBe("Subject is required.");
    expect(contentProblem("service", "x".repeat(201), "Body")).toMatch(/Subject is too long/);
    expect(contentProblem("service", "x".repeat(200), "Body")).toBeNull();
    expect(contentProblem("service", "Hi", "  ")).toBe("Message is required.");
    expect(contentProblem("service", "Hi", "x".repeat(4001))).toMatch(/Message is too long/);
    expect(contentProblem("service", "Hi", "x".repeat(4000))).toBeNull();
    expect(contentProblem("service", undefined, undefined)).toBe("Subject is required.");
  });
});

describe("validateProposal", () => {
  it("trims and returns the checked values, or the first problem", () => {
    expect(validateProposal({ kind: "service", subject: "  Hi  ", body: "  Hello  " })).toEqual({ ok: true, kind: "service", subject: "Hi", body: "Hello" });
    expect(validateProposal({ kind: "service", subject: "Hi", body: "no obligation" })).toMatchObject({ ok: false });
  });
});

describe("approval and proposal lifetimes", () => {
  it("an approval lasts 24 hours and lapses exactly at the edge", () => {
    expect(approvalExpiresAt(null)).toBeNull();
    expect(approvalExpiresAt("nope")).toBeNull();
    expect(approvalExpiresAt(ago(1))?.toISOString()).toBe(new Date(NOW.getTime() + 23 * 3_600_000).toISOString());
    expect(approvalLapsed(ago(23.9), NOW)).toBe(false);
    expect(approvalLapsed(ago(LIMITS.approvalValidHours), NOW)).toBe(true);
    expect(approvalLapsed(ago(30), NOW)).toBe(true);
    expect(approvalLapsed(null, NOW)).toBe(false);
  });
  it("a proposal lasts 7 days", () => {
    expect(proposalLapsed(ago(24 * 6.9), NOW)).toBe(false);
    expect(proposalLapsed(ago(24 * 7), NOW)).toBe(true);
    expect(proposalLapsed("nope", NOW)).toBe(false);
  });
});

describe("splitQueue / sentInLast24h", () => {
  const rows = [
    { id: "a", status: "sent", created_at: ago(5), sent_at: ago(4), queued_at: ago(4) },
    { id: "b", status: "proposed", created_at: ago(1), sent_at: null, queued_at: null },
    { id: "c", status: "approved", created_at: ago(3), sent_at: null, queued_at: null },
    { id: "d", status: "queued", created_at: ago(2), sent_at: null, queued_at: ago(0.5) },
    { id: "e", status: "rejected", created_at: ago(9), sent_at: null, queued_at: null },
    { id: "f", status: "sent", created_at: ago(60), sent_at: ago(50), queued_at: ago(50) },
    { id: "g", status: "failed", created_at: ago(2), sent_at: null, queued_at: ago(1.5) }, // was queued, then failed: not counted
  ];
  it("puts open work first, newest first, and history after", () => {
    const { open, history } = splitQueue(rows);
    expect(open.map((r) => r.id)).toEqual(["b", "d", "c"]);
    expect(history.map((r) => r.id)).toEqual(["g", "a", "e", "f"]);
  });
  it("counts only queued or sent messages from the last 24 hours", () => {
    expect(sentInLast24h(rows, NOW)).toBe(2); // a (sent 4h ago) and d (queued 30 min ago); f is 50h old; b/c/e never sent; g failed
  });
});
