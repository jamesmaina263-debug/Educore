import { describe, expect, it } from "vitest";
import { summariseDirectorAlerts, type DirectorAlertRow } from "./director-alerts";

const row = (over: Partial<DirectorAlertRow>): DirectorAlertRow => ({
  log_id: "l", school_id: "s1", school_user_id: "u1", phone: "+254700000111", alert_type: "large_payment", payload: { amount: 1 }, ...over,
});

describe("summariseDirectorAlerts", () => {
  it("counts by type, schools and directors", () => {
    const s = summariseDirectorAlerts([
      row({ log_id: "1" }),
      row({ log_id: "2", alert_type: "low_attendance" }),
      row({ log_id: "3", alert_type: "collection_drop", school_id: "s2", school_user_id: "u2" }),
      row({ log_id: "4", school_id: "s2", school_user_id: "u2" }),
    ]);
    expect(s).toEqual({ total: 4, schools: 2, directors: 2, by_type: { large_payment: 2, collection_drop: 1, low_attendance: 1 } });
  });
  it("handles empty, null and unknown types", () => {
    expect(summariseDirectorAlerts([]).total).toBe(0);
    expect(summariseDirectorAlerts(null).total).toBe(0);
    expect(summariseDirectorAlerts([row({ alert_type: "mystery" })]).by_type).toEqual({ large_payment: 0, collection_drop: 0, low_attendance: 0 });
  });
  it("never exposes phones or figures", () => {
    expect(JSON.stringify(summariseDirectorAlerts([row({})]))).not.toMatch(/254700000111|amount/);
  });
});
