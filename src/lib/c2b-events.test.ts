import { describe, expect, it } from "vitest";
import {
  LIVE_CONFIRMATION_WORD,
  canOfferLive,
  describeModeError,
  isLiveConfirmationValid,
  matchRuleLabel,
  outcomeMeta,
  parseWouldBe,
} from "./c2b-events";

describe("outcomeMeta", () => {
  it("labels every known outcome", () => {
    for (const o of ["received", "log_only", "allocated", "unallocated", "duplicate", "deferred_to_stk", "failed"]) {
      expect(outcomeMeta(o).label).not.toBe(o);
    }
  });
  it("marks failures as danger and allocations as success", () => {
    expect(outcomeMeta("failed").tone).toBe("danger");
    expect(outcomeMeta("allocated").tone).toBe("success");
    expect(outcomeMeta("unallocated").tone).toBe("warning");
  });
  it("falls back to the raw value for an unknown outcome", () => {
    expect(outcomeMeta("something_new")).toEqual({ label: "something_new", tone: "neutral" });
  });
});

describe("matchRuleLabel", () => {
  it("handles null, known and unknown rules", () => {
    expect(matchRuleLabel(null)).toBe("");
    expect(matchRuleLabel("exact")).toBe("Exact admission number");
    expect(matchRuleLabel("typo_repair")).toContain("typo");
    expect(matchRuleLabel("weird")).toBe("weird");
  });
});

describe("parseWouldBe", () => {
  it("extracts the plan", () => {
    expect(parseWouldBe("would_be=allocate_exact")).toBe("allocate_exact");
    expect(parseWouldBe("note; would_be=unallocated; more")).toBe("unallocated");
  });
  it("returns null when absent or empty", () => {
    expect(parseWouldBe(null)).toBeNull();
    expect(parseWouldBe(undefined)).toBeNull();
    expect(parseWouldBe("nothing here")).toBeNull();
    expect(parseWouldBe("would_be=   ")).toBeNull();
  });
  it("caps a very long value", () => {
    expect(parseWouldBe("would_be=" + "x".repeat(500))!.length).toBe(120);
  });
});

describe("isLiveConfirmationValid", () => {
  it("accepts exactly LIVE, ignoring surrounding spaces", () => {
    expect(LIVE_CONFIRMATION_WORD).toBe("LIVE");
    expect(isLiveConfirmationValid("LIVE")).toBe(true);
    expect(isLiveConfirmationValid("  LIVE ")).toBe(true);
  });
  it("rejects everything else", () => {
    for (const bad of ["live", "Live", "LIV", "LIVE!", "YES", "", " ", null, undefined]) {
      expect(isLiveConfirmationValid(bad as string | null | undefined)).toBe(false);
    }
  });
});

describe("canOfferLive", () => {
  const ok = { exists: true, mode: "log_only" as const, registered: true, isOwner: true };
  it("offers live only for an owner, existing config, registered URL, currently log-only", () => {
    expect(canOfferLive(ok)).toBe(true);
    expect(canOfferLive({ ...ok, isOwner: false })).toBe(false);
    expect(canOfferLive({ ...ok, exists: false })).toBe(false);
    expect(canOfferLive({ ...ok, registered: false })).toBe(false);
    expect(canOfferLive({ ...ok, mode: "live" })).toBe(false);
    expect(canOfferLive({ ...ok, mode: null })).toBe(false);
  });
});

describe("describeModeError", () => {
  it("maps known codes to plain language", () => {
    expect(describeModeError("55000")).toContain("registered");
    expect(describeModeError("42501")).toContain("school owner");
    expect(describeModeError("P0002")).toContain("not been set up");
  });
  it("never echoes raw text for unknown codes", () => {
    const msg = describeModeError("XX000");
    expect(msg).toBe("Could not change the mode. Please refresh and try again.");
    expect(describeModeError(null)).toBe(msg);
  });
});
