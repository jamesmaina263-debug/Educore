import { describe, expect, it } from "vitest";
import { decisionsFor, isDecision, kindLabel, parseBotRequestRows, statusLabel, statusTone } from "./bot-requests";

describe("parseBotRequestRows", () => {
  it("keeps well-formed rows and drops malformed ones", () => {
    const rows = parseBotRequestRows([
      { id: "a", kind: "absence_report", status: "pending", created_at: "2026-11-02T10:00:00Z", student_name: "Mary W", absence_date: "2026-11-03", phone_conflict: false },
      { id: "b", kind: "contact_update", status: "applied", new_phone: "+254712345678", phone_conflict: true },
      { id: "c", kind: "other", status: "pending" },
      { kind: "absence_report", status: "pending" },
      null,
      "x",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0].student_name).toBe("Mary W");
    expect(rows[1].phone_conflict).toBe(true);
  });
  it("returns an empty list for anything that is not an array", () => {
    expect(parseBotRequestRows(null)).toEqual([]);
    expect(parseBotRequestRows({})).toEqual([]);
  });
});

describe("labels and decisions", () => {
  it("offers acknowledge/reject for absence notes and apply/reject for phone changes", () => {
    expect(decisionsFor("absence_report")).toEqual(["acknowledge", "reject"]);
    expect(decisionsFor("contact_update")).toEqual(["apply", "reject"]);
  });
  it("validates decisions", () => {
    expect(isDecision("apply")).toBe(true);
    expect(isDecision("delete")).toBe(false);
  });
  it("labels", () => {
    expect(kindLabel("absence_report")).toBe("Absence note");
    expect(statusLabel("pending")).toBe("Waiting for the office");
    expect(statusTone("rejected")).toBe("danger");
  });
});
