import { describe, expect, it } from "vitest";
import { engagementLines, hasClicked, parseEngagementRows } from "./engagement";

const row = {
  prospect_id: "p1",
  clicks: 2,
  bot_clicks: 1,
  last_click_at: "2026-10-22T11:50:27.974611+00:00",
  last_click_destination: "contact",
  destinations: ["contact", "signup"],
  opens: 1,
  last_open_at: "2026-10-22T11:20:27+00:00",
  provider_clicks: 0,
  last_provider_click_at: null,
};

describe("parseEngagementRows", () => {
  it("keys rows by prospect id and keeps only valid destinations", () => {
    const m = parseEngagementRows([{ ...row, destinations: ["signup", "evil", 3, "contact"] }]);
    expect(m.p1.clicks).toBe(2);
    expect(m.p1.destinations).toEqual(["signup", "contact"]);
    expect(m.p1.opens).toBe(1);
    expect(m.p1.lastProviderClickAt).toBeNull();
  });
  it("never throws on junk and skips unusable rows", () => {
    expect(parseEngagementRows(null)).toEqual({});
    expect(parseEngagementRows("x")).toEqual({});
    expect(parseEngagementRows([null, 5, {}, { prospect_id: "" }, { prospect_id: "ok", clicks: "7", last_click_at: "nope" }])).toEqual({
      ok: { clicks: 0, lastClickAt: null, destinations: [], opens: 0, lastOpenAt: null, providerClicks: 0, lastProviderClickAt: null },
    });
  });
});

describe("engagementLines / hasClicked", () => {
  it("shows what was clicked as the strong line and the open as a weak line", () => {
    const e = parseEngagementRows([row]).p1;
    expect(engagementLines(e)).toEqual([
      { tone: "strong", text: "Clicked: contact page, signup page", at: row.last_click_at },
      { tone: "weak", text: "Opened (may be automatic)", at: row.last_open_at },
    ]);
    expect(hasClicked(e)).toBe(true);
  });
  it("an open alone is not a click", () => {
    const e = parseEngagementRows([{ ...row, clicks: 0, destinations: [], last_click_at: null }]).p1;
    expect(hasClicked(e)).toBe(false);
    expect(engagementLines(e)).toEqual([{ tone: "weak", text: "Opened (may be automatic)", at: row.last_open_at }]);
  });
  it("a Resend-reported click counts when we have no click of our own", () => {
    const e = parseEngagementRows([{ prospect_id: "p2", provider_clicks: 1, last_provider_click_at: "2026-10-22T10:00:00Z" }]).p2;
    expect(hasClicked(e)).toBe(true);
    expect(engagementLines(e)).toEqual([{ tone: "strong", text: "Clicked a link", at: "2026-10-22T10:00:00Z" }]);
  });
  it("shows nothing for a school with no signal, or none on record", () => {
    expect(engagementLines(undefined)).toEqual([]);
    expect(hasClicked(undefined)).toBe(false);
    expect(engagementLines(parseEngagementRows([{ prospect_id: "p3" }]).p3)).toEqual([]);
  });
});
