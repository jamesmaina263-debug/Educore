import { describe, expect, it } from "vitest";
import {
  formatDateRange,
  formatTimeRange,
  groupByMonth,
  monthLabel,
  portalUpcoming,
  splitUpcoming,
  validateEvent,
  validateHouse,
  type CalendarEvent,
  type EventInput,
} from "./school-calendar";

const base: EventInput = {
  id: null,
  title: "Sports Day",
  description: "",
  category: "sports",
  startsOn: "2026-11-20",
  endsOn: "2026-11-20",
  startTime: "08:00",
  endTime: "16:00",
  location: "Field",
  houseId: null,
  audience: "everyone",
};

function ev(id: string, startsOn: string, endsOn = startsOn): CalendarEvent {
  return {
    id, title: id, description: null, category: "other", startsOn, endsOn, startTime: null, endTime: null,
    location: null, houseId: null, audience: "everyone", status: "scheduled", cancelReason: null,
  };
}

describe("validateEvent", () => {
  it("accepts a normal event and trims the title", () => {
    const r = validateEvent({ ...base, title: "  Sports Day " });
    expect("value" in r && r.value.title).toBe("Sports Day");
  });
  it("rejects an empty title", () => {
    expect(validateEvent({ ...base, title: "   " })).toHaveProperty("error");
  });
  it("rejects a title over 150 characters", () => {
    expect(validateEvent({ ...base, title: "x".repeat(151) })).toHaveProperty("error");
  });
  it("rejects impossible dates such as 31 February", () => {
    expect(validateEvent({ ...base, startsOn: "2026-02-31", endsOn: "2026-02-31" })).toHaveProperty("error");
  });
  it("rejects an end date before the start date", () => {
    expect(validateEvent({ ...base, startsOn: "2026-11-21", endsOn: "2026-11-20" })).toHaveProperty("error");
  });
  it("rejects an end time without a start time", () => {
    expect(validateEvent({ ...base, startTime: "", endTime: "10:00" })).toHaveProperty("error");
  });
  it("rejects an end time that is not after the start time on a single day", () => {
    expect(validateEvent({ ...base, startTime: "10:00", endTime: "10:00" })).toHaveProperty("error");
  });
  it("allows an earlier end time on a multi-day event", () => {
    const r = validateEvent({ ...base, endsOn: "2026-11-22", startTime: "14:00", endTime: "09:00" });
    expect(r).toHaveProperty("value");
  });
  it("allows no times at all", () => {
    expect(validateEvent({ ...base, startTime: "", endTime: "" })).toHaveProperty("value");
  });
  it("rejects an unknown audience", () => {
    expect(validateEvent({ ...base, audience: "parents" as never })).toHaveProperty("error");
  });
});

describe("validateHouse", () => {
  it("accepts a name and hex colour", () => {
    expect(validateHouse({ id: null, name: " Red ", colour: "#ff0000", status: "active" })).toHaveProperty("value");
  });
  it("rejects a bad colour", () => {
    expect(validateHouse({ id: null, name: "Red", colour: "red", status: "active" })).toHaveProperty("error");
  });
  it("rejects an empty name", () => {
    expect(validateHouse({ id: null, name: "", colour: "#ff0000", status: "active" })).toHaveProperty("error");
  });
});

describe("formatting and grouping", () => {
  it("labels months", () => {
    expect(monthLabel("2026-11-20")).toBe("November 2026");
  });
  it("formats date ranges", () => {
    expect(formatDateRange("2026-11-20", "2026-11-20")).toBe("20 Nov 2026");
    expect(formatDateRange("2026-11-20", "2026-11-22")).toBe("20 to 22 Nov 2026");
    expect(formatDateRange("2026-11-30", "2026-12-02")).toBe("30 Nov to 2 Dec 2026");
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 to 2 Jan 2027");
  });
  it("formats time ranges", () => {
    expect(formatTimeRange(null, null)).toBeNull();
    expect(formatTimeRange("08:00:00", null)).toBe("08:00");
    expect(formatTimeRange("08:00:00", "16:30:00")).toBe("08:00 to 16:30");
  });
  it("splits upcoming from past, keeping a running multi-day event upcoming", () => {
    const { upcoming, past } = splitUpcoming(
      [ev("old", "2026-10-01"), ev("running", "2026-10-30", "2026-11-03"), ev("later", "2026-12-01"), ev("sooner", "2026-11-05")],
      "2026-11-02",
    );
    expect(upcoming.map((e) => e.id)).toEqual(["running", "sooner", "later"]);
    expect(past.map((e) => e.id)).toEqual(["old"]);
  });
  it("groups by month in order", () => {
    const g = groupByMonth([ev("a", "2026-11-05"), ev("b", "2026-11-20"), ev("c", "2026-12-01")]);
    expect(g.map((x) => [x.month, x.events.length])).toEqual([["November 2026", 2], ["December 2026", 1]]);
  });
});

describe("portalUpcoming", () => {
  const staff: CalendarEvent = { ...ev("staff", "2026-11-05"), audience: "staff_only" };
  const cancelled: CalendarEvent = { ...ev("called-off", "2026-11-06"), status: "cancelled" };

  it("drops staff-only and finished events, keeps cancelled ones, soonest first", () => {
    const r = portalUpcoming([ev("old", "2026-10-01"), staff, cancelled, ev("running", "2026-10-30", "2026-11-03"), ev("later", "2026-12-01")], "2026-11-02");
    expect(r.map((e) => e.id)).toEqual(["running", "called-off", "later"]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ev(`e${String(i).padStart(2, "0")}`, `2026-11-${String(i + 3).padStart(2, "0")}`));
    expect(portalUpcoming(many, "2026-11-02", 5)).toHaveLength(5);
  });
  it("returns nothing when there is nothing upcoming", () => {
    expect(portalUpcoming([ev("old", "2026-10-01")], "2026-11-02")).toEqual([]);
  });
});
