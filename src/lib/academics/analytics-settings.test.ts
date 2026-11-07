import { describe, expect, it } from "vitest";
import { NO_SETTINGS, parseAnalyticsSettings, resolveThreshold, validateThreshold } from "./analytics-settings";

describe("parseAnalyticsSettings", () => {
  it("reads valid numbers", () => {
    expect(parseAnalyticsSettings({ intervention_threshold_percent: 60, intervention_threshold_level: 2 })).toEqual({ percentThreshold: 60, levelThreshold: 2 });
  });
  it("treats null, missing, arrays and junk as no settings", () => {
    expect(parseAnalyticsSettings(null)).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings(undefined)).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings([1])).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings("x")).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings({})).toEqual(NO_SETTINGS);
  });
  it("ignores out-of-range or non-numeric values instead of trusting them", () => {
    expect(parseAnalyticsSettings({ intervention_threshold_percent: 150, intervention_threshold_level: 1 })).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings({ intervention_threshold_percent: "60", intervention_threshold_level: 0.5 })).toEqual(NO_SETTINGS);
    expect(parseAnalyticsSettings({ intervention_threshold_percent: 0 })).toEqual(NO_SETTINGS);
  });
});

describe("resolveThreshold", () => {
  const saved = { percentThreshold: 60, levelThreshold: 2 };
  it("prefers the URL, then the saved default, then the built-in default", () => {
    expect(resolveThreshold("percent", 45, saved)).toEqual({ value: 45, source: "url" });
    expect(resolveThreshold("percent", undefined, saved)).toEqual({ value: 60, source: "saved" });
    expect(resolveThreshold("level", undefined, saved)).toEqual({ value: 2, source: "saved" });
    expect(resolveThreshold("percent", undefined, NO_SETTINGS)).toEqual({ value: undefined, source: "default" });
  });
  it("treats a URL value equal to the saved default as the saved default", () => {
    expect(resolveThreshold("percent", 60, saved)).toEqual({ value: 60, source: "saved" });
  });
  it("ignores an out-of-range URL value and falls back", () => {
    const valid = (v: number) => v > 0 && v <= 100;
    expect(resolveThreshold("percent", 150, saved, valid)).toEqual({ value: 60, source: "saved" });
    expect(resolveThreshold("percent", 150, NO_SETTINGS, valid)).toEqual({ value: undefined, source: "default" });
  });
});

describe("validateThreshold", () => {
  it("matches the database's ranges", () => {
    expect(validateThreshold("percent", 50)).toBeNull();
    expect(validateThreshold("percent", 100)).toBeNull();
    expect(validateThreshold("percent", 0)).not.toBeNull();
    expect(validateThreshold("percent", 101)).not.toBeNull();
    expect(validateThreshold("level", 2.5)).toBeNull();
    expect(validateThreshold("level", 1)).not.toBeNull();
    expect(validateThreshold("level", 11)).not.toBeNull();
    expect(validateThreshold("level", Number.NaN)).not.toBeNull();
  });
});
