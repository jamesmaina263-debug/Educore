import { describe, expect, it } from "vitest";
import {
  parseAttlogBody,
  parseOperlogUserBody,
  statusToEventType,
  buildDeterministicEventId,
  parseDeviceTime,
} from "./zkteco";

describe("parseAttlogBody", () => {
  it("parses the tab-separated positional format (ZKTeco's own protocol doc)", () => {
    const body = "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0\r\n4\t2024-07-28 10:41:31\t1\t1\t\t0\t0\r\n";
    const { records, skipped } = parseAttlogBody(body);
    expect(skipped).toEqual([]);
    expect(records).toEqual([
      { pin: "1", time: "2024-07-28 01:25:24", status: "0", verify: "1", raw: "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0" },
      { pin: "4", time: "2024-07-28 10:41:31", status: "1", verify: "1", raw: "4\t2024-07-28 10:41:31\t1\t1\t\t0\t0" },
    ]);
  });

  it("parses the key=value format seen in some community integrations", () => {
    const body = "PIN=1001 DateTime=2025-09-02 14:32:11 Verified=1 Status=0\nPIN=1002 DateTime=2025-09-02 14:35:54 Verified=1 Status=1";
    const { records, skipped } = parseAttlogBody(body);
    expect(skipped).toEqual([]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ pin: "1001", time: "2025-09-02 14:32:11", status: "0", verify: "1" });
    expect(records[1]).toMatchObject({ pin: "1002", time: "2025-09-02 14:35:54", status: "1", verify: "1" });
  });

  it("skips a malformed line without losing the other valid records in the same push", () => {
    const body = "1\t2024-07-28 01:25:24\t0\t1\t\t0\t0\r\nTHIS IS GARBAGE\r\n4\t2024-07-28 10:41:31\t1\t1\t\t0\t0\r\n";
    const { records, skipped } = parseAttlogBody(body);
    expect(records).toHaveLength(2);
    expect(skipped).toEqual(["THIS IS GARBAGE"]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseAttlogBody("")).toEqual({ records: [], skipped: [] });
    expect(parseAttlogBody("\r\n\r\n")).toEqual({ records: [], skipped: [] });
  });
});

describe("parseOperlogUserBody", () => {
  it("extracts PIN and Name, nothing else, from a USER/OPERLOG push", () => {
    const body = "PIN=1001 Name=John Doe Privilege=0 Card=12345678\nPIN=1002 Name=Alice Smith Privilege=0";
    const { records, skipped } = parseOperlogUserBody(body);
    expect(skipped).toEqual([]);
    expect(records).toEqual([
      { pin: "1001", name: "John Doe", raw: "PIN=1001 Name=John Doe Privilege=0 Card=12345678" },
      { pin: "1002", name: "Alice Smith", raw: "PIN=1002 Name=Alice Smith Privilege=0" },
    ]);
  });

  it("still captures the PIN when Name is absent", () => {
    const { records } = parseOperlogUserBody("PIN=1003 Privilege=0");
    expect(records).toEqual([{ pin: "1003", name: null, raw: "PIN=1003 Privilege=0" }]);
  });

  it("never extracts anything beyond PIN/Name, even if the line contains other fields", () => {
    const { records } = parseOperlogUserBody("PIN=1004 Name=Test User Card=99999999 Pri=0 Grp=1 TZ=0");
    expect(records[0].name).toBe("Test User");
    expect(Object.keys(records[0])).toEqual(["pin", "name", "raw"]);
  });
});

describe("statusToEventType", () => {
  it("maps the common conventions", () => {
    expect(statusToEventType("0")).toEqual({ eventType: "check_in", ambiguous: false });
    expect(statusToEventType("4")).toEqual({ eventType: "check_in", ambiguous: false });
    expect(statusToEventType("1")).toEqual({ eventType: "check_out", ambiguous: false });
    expect(statusToEventType("5")).toEqual({ eventType: "check_out", ambiguous: false });
  });

  it("flags anything unrecognized as ambiguous rather than guessing confidently", () => {
    expect(statusToEventType("2")).toEqual({ eventType: "check_in", ambiguous: true });
    expect(statusToEventType(null)).toEqual({ eventType: "check_in", ambiguous: true });
    expect(statusToEventType("99")).toEqual({ eventType: "check_in", ambiguous: true });
  });
});

describe("buildDeterministicEventId", () => {
  it("is stable for the same (device, pin, time, status)", () => {
    const record = { pin: "1001", time: "2025-09-02 14:32:11", status: "0" };
    expect(buildDeterministicEventId("SN123", record)).toBe(buildDeterministicEventId("SN123", record));
  });

  it("differs across devices, pins, times, or statuses", () => {
    const base = { pin: "1001", time: "2025-09-02 14:32:11", status: "0" };
    const id = buildDeterministicEventId("SN123", base);
    expect(buildDeterministicEventId("SN456", base)).not.toBe(id);
    expect(buildDeterministicEventId("SN123", { ...base, pin: "1002" })).not.toBe(id);
    expect(buildDeterministicEventId("SN123", { ...base, time: "2025-09-02 14:32:12" })).not.toBe(id);
    expect(buildDeterministicEventId("SN123", { ...base, status: "1" })).not.toBe(id);
  });
});

describe("parseDeviceTime", () => {
  it("treats the device's wall-clock digits as UTC, matching biometric-verify's existing convention", () => {
    const d = parseDeviceTime("2025-09-02 14:32:11");
    expect(d.toISOString()).toBe("2025-09-02T14:32:11.000Z");
  });
});
