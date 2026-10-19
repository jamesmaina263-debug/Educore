import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_REPORT_SETTINGS, REPORT_SETTING_KEYS, loadReportSettings, resolveReportSettings, toStoredReportSettings } from "./report-settings";

describe("resolveReportSettings", () => {
  it("NULL, empty and garbage all resolve to the defaults, which are all on (today's behaviour)", () => {
    for (const raw of [null, undefined, {}, [], "x", 5, { unknown: false }]) expect(resolveReportSettings(raw)).toEqual(DEFAULT_REPORT_SETTINGS);
    expect(Object.values(DEFAULT_REPORT_SETTINGS).every((v) => v === true)).toBe(true);
  });
  it("applies stored booleans and ignores non-boolean values", () => {
    expect(resolveReportSettings({ ranking_enabled: false, show_signatures: "no", show_class_statistics: 0 })).toEqual({ ...DEFAULT_REPORT_SETTINGS, rankingEnabled: false });
  });
  it("round-trips through the stored shape", () => {
    const s = { rankingEnabled: false, showCompetencyRatings: true, showSignatures: false, showClassStatistics: true };
    expect(resolveReportSettings(toStoredReportSettings(s))).toEqual(s);
  });
});

describe("loadReportSettings", () => {
  const client = (row: unknown) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }) as unknown as Parameters<typeof loadReportSettings>[0];
  it("reads the school's stored settings, and defaults when the row or column is empty", async () => {
    expect((await loadReportSettings(client({ report_settings: { ranking_enabled: false } }), "s")).rankingEnabled).toBe(false);
    expect(await loadReportSettings(client({ report_settings: null }), "s")).toEqual(DEFAULT_REPORT_SETTINGS);
    expect(await loadReportSettings(client(null), "s")).toEqual(DEFAULT_REPORT_SETTINGS);
  });
});

describe("code and database agree on the setting keys", () => {
  it("every key the code writes is in the migration's whitelist and vice versa", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20261019093000_school_report_settings.sql"), "utf8");
    const whitelist = [...(sql.match(/v_known_keys text\[\] := array\[([^\]]+)\]/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(whitelist.length).toBeGreaterThan(0);
    expect(Object.values(REPORT_SETTING_KEYS).sort()).toEqual(whitelist);
  });
});
