import { describe, expect, it } from "vitest";
import {
  CHECKIN_CHANNELS,
  CHECKIN_OUTCOMES,
  RECENT_CHECKIN_DAYS,
  isRecentlyCheckedIn,
  summariseCheckins,
  validateCheckinInput,
} from "./trial-checkins";

const NOW = new Date("2026-10-18T09:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("validateCheckinInput", () => {
  it("accepts every listed channel and outcome and trims the note", () => {
    for (const c of CHECKIN_CHANNELS) for (const o of CHECKIN_OUTCOMES) {
      expect(validateCheckinInput(c, o, "  hi  ")).toEqual({ ok: true, channel: c, outcome: o, note: "hi" });
    }
  });
  it("turns a blank or missing note into null", () => {
    expect(validateCheckinInput("call", "no_answer", "   ")).toMatchObject({ ok: true, note: null });
    expect(validateCheckinInput("call", "no_answer", undefined)).toMatchObject({ ok: true, note: null });
  });
  it("rejects unknown values and over-long notes", () => {
    expect(validateCheckinInput("telegram", "no_answer", "")).toEqual({ ok: false, error: "Unknown channel." });
    expect(validateCheckinInput("call", "won", "")).toEqual({ ok: false, error: "Unknown outcome." });
    expect(validateCheckinInput("call", "no_answer", "x".repeat(501))).toMatchObject({ ok: false });
    expect(validateCheckinInput("call", "no_answer", "x".repeat(500))).toMatchObject({ ok: true });
  });
});

describe("summariseCheckins", () => {
  const team = new Map([["t1", "Ben"]]);
  it("keeps the latest check-in per school regardless of row order, and counts them", () => {
    const m = summariseCheckins(
      [
        { school_id: "a", created_at: ago(5), channel: "call", outcome: "no_answer", performed_by: null },
        { school_id: "a", created_at: ago(1), channel: "whatsapp", outcome: "reached_interested", performed_by: "t1" },
        { school_id: "a", created_at: ago(9), channel: "email", outcome: "message_left", performed_by: "gone" },
        { school_id: "b", created_at: ago(2), channel: "visit", outcome: "reached_needs_time", performed_by: null },
      ],
      team,
    );
    expect(m.get("a")?.count).toBe(3);
    expect(m.get("a")?.last).toMatchObject({ channel: "whatsapp", outcome: "reached_interested", byName: "Ben" });
    expect(m.get("b")?.last.byName).toBeNull();
    expect(m.has("c")).toBe(false);
  });
  it("treats asked_to_stop anywhere in the history as a standing request", () => {
    const m = summariseCheckins(
      [
        { school_id: "a", created_at: ago(8), channel: "call", outcome: "asked_to_stop", performed_by: null },
        { school_id: "a", created_at: ago(1), channel: "call", outcome: "no_answer", performed_by: null },
      ],
      team,
    );
    expect(m.get("a")?.askedToStop).toBe(true);
    expect(m.get("a")?.last.outcome).toBe("no_answer");
  });
  it("skips rows with an unreadable timestamp", () => {
    const m = summariseCheckins([{ school_id: "a", created_at: "nope", channel: "call", outcome: "no_answer", performed_by: null }], team);
    expect(m.size).toBe(0);
  });
});

describe("isRecentlyCheckedIn", () => {
  it("is true inside the window and false at and after its edge", () => {
    expect(isRecentlyCheckedIn(ago(0.1), NOW)).toBe(true);
    expect(isRecentlyCheckedIn(ago(RECENT_CHECKIN_DAYS - 0.01), NOW)).toBe(true);
    expect(isRecentlyCheckedIn(ago(RECENT_CHECKIN_DAYS), NOW)).toBe(false);
    expect(isRecentlyCheckedIn(ago(10), NOW)).toBe(false);
  });
  it("ignores future or unreadable timestamps", () => {
    expect(isRecentlyCheckedIn(ago(-1), NOW)).toBe(false);
    expect(isRecentlyCheckedIn("nope", NOW)).toBe(false);
  });
});
