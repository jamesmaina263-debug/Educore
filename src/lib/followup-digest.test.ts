import { describe, expect, it } from "vitest";
import { MAX_ROWS_PER_SECTION, buildFollowupDigest, daysBetween, nairobiToday, type DigestLead } from "../../supabase/functions/_shared/followupDigest";

const TODAY = "2026-10-21";
const lead = (o: Partial<DigestLead> & { id: string }): DigestLead => ({
  school_name: `School ${o.id}`,
  contact_name: null,
  phone: null,
  stage: "new",
  next_follow_up_on: null,
  town_county: null,
  ...o,
});

describe("nairobiToday / daysBetween", () => {
  it("uses the Kenya calendar, not UTC", () => {
    expect(nairobiToday(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21"); // 01:30 in Nairobi
    expect(nairobiToday(new Date("2026-10-21T20:59:00Z"))).toBe("2026-10-21");
    expect(nairobiToday(new Date("2026-10-21T21:00:00Z"))).toBe("2026-10-22");
  });
  it("counts days", () => {
    expect(daysBetween("2026-10-14", "2026-10-21")).toBe(7);
    expect(daysBetween("2026-10-21", "2026-10-21")).toBe(0);
  });
});

describe("buildFollowupDigest", () => {
  it("returns null when nothing is overdue or due today", () => {
    expect(buildFollowupDigest([], TODAY, "https://x")).toBeNull();
    expect(buildFollowupDigest([lead({ id: "a", next_follow_up_on: "2026-10-30" }), lead({ id: "b" })], TODAY, "https://x")).toBeNull();
  });

  it("counts overdue, due today and no-follow-up with the dashboard's definitions", () => {
    const d = buildFollowupDigest(
      [
        lead({ id: "1", next_follow_up_on: "2026-10-14", stage: "visited" }),
        lead({ id: "2", next_follow_up_on: "2026-10-20" }),
        lead({ id: "3", next_follow_up_on: TODAY }),
        lead({ id: "4", next_follow_up_on: "2026-10-25" }),
        lead({ id: "5" }),
        lead({ id: "6", next_follow_up_on: "2026-10-01", stage: "paid" }), // closed: ignored
        lead({ id: "7", next_follow_up_on: "2026-10-01", stage: "lost" }),
        lead({ id: "8", stage: "lost" }),
      ],
      TODAY,
      "https://www.educoreafrica.com/",
    )!;
    expect(d).toMatchObject({ overdue: 2, dueToday: 1, noFollowUp: 1 });
    expect(d.subject).toBe("Sales follow-ups: 2 overdue, 1 due today");
    expect(d.text).toContain("7d overdue");
    expect(d.text).toContain("https://www.educoreafrica.com/admin/sales-pipeline");
    expect(d.text.indexOf("School 1")).toBeLessThan(d.text.indexOf("School 2")); // oldest first
    expect(d.text).not.toContain("School 6");
  });

  it("escapes lead-supplied text in the HTML", () => {
    const d = buildFollowupDigest([lead({ id: "x", school_name: "<img src=x onerror=alert(1)>", next_follow_up_on: "2026-10-01" })], TODAY, "https://x")!;
    expect(d.html).not.toContain("<img");
    expect(d.html).toContain("&lt;img");
  });

  it("caps each section and says how many more there are", () => {
    const many = Array.from({ length: MAX_ROWS_PER_SECTION + 5 }, (_, i) => lead({ id: String(i), next_follow_up_on: "2026-10-01" }));
    const d = buildFollowupDigest(many, TODAY, "https://x")!;
    expect(d.overdue).toBe(MAX_ROWS_PER_SECTION + 5);
    expect(d.text).toContain("...and 5 more");
  });

  it("uses singular wording for a single lead without a date", () => {
    const d = buildFollowupDigest([lead({ id: "1", next_follow_up_on: TODAY }), lead({ id: "2" })], TODAY, "https://x")!;
    expect(d.text).toContain("1 open lead has no follow-up date set.");
  });
});
