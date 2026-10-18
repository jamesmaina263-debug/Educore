import { describe, expect, it } from "vitest";
import {
  demoHistory,
  eatLocalToIso,
  isoToEatLocal,
  needsOutcome,
  openDemos,
  validateBookingInput,
  validateCloseInput,
  validateRescheduleInput,
  type DemoRow,
} from "./demos";

const NOW = new Date("2026-10-18T09:00:00Z"); // 12:00 EAT

function demo(id: string, over: Partial<DemoRow> = {}): DemoRow {
  return {
    id,
    lead_id: "lead-1",
    scheduled_for: "2026-10-20T07:00:00Z",
    mode: "in_person",
    location_note: null,
    host_id: null,
    status: "scheduled",
    outcome_note: null,
    status_changed_at: "2026-10-18T08:00:00Z",
    ...over,
  };
}

describe("eatLocalToIso / isoToEatLocal", () => {
  it("reads the input as East Africa Time (UTC+3)", () => {
    expect(eatLocalToIso("2026-10-25T14:30")).toBe("2026-10-25T11:30:00.000Z");
    // crossing midnight backwards: 01:00 EAT is the previous day in UTC
    expect(eatLocalToIso("2026-10-25T01:00")).toBe("2026-10-24T22:00:00.000Z");
  });
  it("rejects impossible or malformed values instead of rolling them over", () => {
    expect(eatLocalToIso("2026-02-31T10:00")).toBeNull();
    expect(eatLocalToIso("2026-13-01T10:00")).toBeNull();
    expect(eatLocalToIso("2026-10-25T25:00")).toBeNull();
    expect(eatLocalToIso("2026-10-25")).toBeNull();
    expect(eatLocalToIso("")).toBeNull();
    expect(eatLocalToIso("tomorrow")).toBeNull();
  });
  it("round-trips", () => {
    for (const v of ["2026-10-25T14:30", "2026-12-31T23:59", "2027-01-01T00:00"]) {
      expect(isoToEatLocal(eatLocalToIso(v) as string)).toBe(v);
    }
    expect(isoToEatLocal("nope")).toBe("");
  });
});

describe("validateBookingInput", () => {
  const ok = { scheduledLocal: "2026-10-25T14:30", mode: "video_call", locationNote: "  Meet link  " };
  it("accepts a future demo and trims the location", () => {
    expect(validateBookingInput(ok, NOW)).toEqual({
      ok: true,
      scheduledFor: "2026-10-25T11:30:00.000Z",
      mode: "video_call",
      locationNote: "Meet link",
    });
  });
  it("turns a blank location into null", () => {
    expect(validateBookingInput({ ...ok, locationNote: "  " }, NOW)).toMatchObject({ ok: true, locationNote: null });
  });
  it("rejects past or present times (compared in real time, not by clock reading)", () => {
    // 11:59 EAT today is before NOW (12:00 EAT); 12:00 EAT is NOW itself
    expect(validateBookingInput({ ...ok, scheduledLocal: "2026-10-18T11:59" }, NOW)).toMatchObject({ ok: false });
    expect(validateBookingInput({ ...ok, scheduledLocal: "2026-10-18T12:00" }, NOW)).toMatchObject({ ok: false });
    expect(validateBookingInput({ ...ok, scheduledLocal: "2026-10-18T12:01" }, NOW)).toMatchObject({ ok: true });
  });
  it("rejects a bad mode, bad date, or over-long location", () => {
    expect(validateBookingInput({ ...ok, mode: "carrier_pigeon" }, NOW)).toMatchObject({ ok: false });
    expect(validateBookingInput({ ...ok, scheduledLocal: "" }, NOW)).toMatchObject({ ok: false });
    expect(validateBookingInput({ ...ok, locationNote: "x".repeat(301) }, NOW)).toMatchObject({ ok: false });
    expect(validateBookingInput({ ...ok, locationNote: "x".repeat(300) }, NOW)).toMatchObject({ ok: true });
  });
});

describe("validateRescheduleInput / validateCloseInput", () => {
  it("applies the same future rule to a reschedule", () => {
    expect(validateRescheduleInput("2026-10-18T11:00", NOW)).toMatchObject({ ok: false });
    expect(validateRescheduleInput("2026-10-19T11:00", NOW)).toMatchObject({ ok: true, scheduledFor: "2026-10-19T08:00:00.000Z" });
  });
  it("allows only held / no_show / cancelled and limits the note", () => {
    expect(validateCloseInput("held", "  good  ")).toEqual({ ok: true, status: "held", note: "good" });
    expect(validateCloseInput("no_show", "")).toEqual({ ok: true, status: "no_show", note: null });
    expect(validateCloseInput("scheduled", "")).toMatchObject({ ok: false });
    expect(validateCloseInput("won", "")).toMatchObject({ ok: false });
    expect(validateCloseInput("held", "x".repeat(501))).toMatchObject({ ok: false });
  });
});

describe("needsOutcome / openDemos / demoHistory", () => {
  it("flags only scheduled demos whose start time has passed", () => {
    expect(needsOutcome(demo("a", { scheduled_for: "2026-10-18T08:59:00Z" }), NOW)).toBe(true);
    expect(needsOutcome(demo("a", { scheduled_for: "2026-10-18T09:00:00Z" }), NOW)).toBe(true);
    expect(needsOutcome(demo("a", { scheduled_for: "2026-10-18T09:01:00Z" }), NOW)).toBe(false);
    expect(needsOutcome(demo("a", { scheduled_for: "2026-10-01T09:00:00Z", status: "held" }), NOW)).toBe(false);
  });
  it("lists scheduled demos soonest first and leaves closed ones out", () => {
    const list = openDemos([
      demo("late", { scheduled_for: "2026-10-30T07:00:00Z" }),
      demo("done", { status: "held", scheduled_for: "2026-10-01T07:00:00Z" }),
      demo("soon", { scheduled_for: "2026-10-19T07:00:00Z" }),
    ]);
    expect(list.map((d) => d.id)).toEqual(["soon", "late"]);
  });
  it("shows history newest first", () => {
    const h = demoHistory([
      demo("old", { scheduled_for: "2026-09-01T07:00:00Z", status: "no_show" }),
      demo("new", { scheduled_for: "2026-10-01T07:00:00Z", status: "held" }),
    ]);
    expect(h.map((d) => d.id)).toEqual(["new", "old"]);
  });
});
