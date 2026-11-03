import { describe, expect, it } from "vitest";
import {
  LIVE_FRESH_SECONDS,
  busStatusMessage,
  compassPoint,
  describeAge,
  isUuid,
  mapLink,
  parseGuardianBusStatus,
} from "@/lib/bus-live";

const NOW = new Date("2026-11-03T08:00:00Z");
const iso = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
const ID = "3f1c6a52-8d0e-4a8e-9a53-6d2f4b1c7e90";

describe("isUuid", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(ID.toUpperCase())).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(`${ID}; drop table x`)).toBe(false);
  });
});

describe("describeAge", () => {
  it("words the age", () => {
    expect(describeAge(null)).toBe("never");
    expect(describeAge(3)).toBe("just now");
    expect(describeAge(45)).toBe("45 s ago");
    expect(describeAge(60)).toBe("1 min ago");
    expect(describeAge(59 * 60)).toBe("59 min ago");
    expect(describeAge(3 * 3600)).toBe("3 h ago");
    expect(describeAge(24 * 3600)).toBe("1 day ago");
    expect(describeAge(3 * 24 * 3600)).toBe("3 days ago");
  });
});

describe("compassPoint", () => {
  it("maps headings to eight points and wraps 360 to north", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(360)).toBe("N");
  });
  it("returns null for missing or impossible headings", () => {
    expect(compassPoint(null)).toBeNull();
    expect(compassPoint(-1)).toBeNull();
    expect(compassPoint(361)).toBeNull();
    expect(compassPoint(Number.NaN)).toBeNull();
  });
});

describe("mapLink", () => {
  it("builds a plain OpenStreetMap link", () => {
    expect(mapLink(-1.28639, 36.81723)).toBe("https://www.openstreetmap.org/?mlat=-1.28639&mlon=36.81723#map=16/-1.28639/36.81723");
  });
  it("refuses missing or out of range coordinates", () => {
    expect(mapLink(null, 36)).toBeNull();
    expect(mapLink(-1, null)).toBeNull();
    expect(mapLink(91, 0)).toBeNull();
    expect(mapLink(0, 181)).toBeNull();
  });
});

describe("parseGuardianBusStatus", () => {
  const live = (over: Record<string, unknown> = {}) => ({
    status: "live",
    route: { name: "North" },
    stop: "Gate Stop",
    lat: -1.28639,
    lng: 36.81723,
    heading: 90,
    speed_kph: 30,
    accuracy_m: 8,
    recorded_at: iso(120),
    age_seconds: 120,
    ...over,
  });

  it("parses a live answer", () => {
    expect(parseGuardianBusStatus(live())).toEqual({
      status: "live",
      routeName: "North",
      stop: "Gate Stop",
      lat: -1.28639,
      lng: 36.81723,
      heading: 90,
      speedKph: 30,
      accuracyM: 8,
      ageSeconds: 120,
    });
  });

  it("refuses a 'live' answer that is too old, has bad coordinates or no age", () => {
    expect(parseGuardianBusStatus(live({ age_seconds: LIVE_FRESH_SECONDS + 1 }))).toEqual({ status: "unavailable" });
    expect(parseGuardianBusStatus(live({ lat: 200 }))).toEqual({ status: "unavailable" });
    expect(parseGuardianBusStatus(live({ lat: null }))).toEqual({ status: "unavailable" });
    expect(parseGuardianBusStatus(live({ age_seconds: null }))).toEqual({ status: "unavailable" });
    expect(parseGuardianBusStatus(live({ age_seconds: -5 }))).toEqual({ status: "unavailable" });
  });

  it("carries no coordinates for a not-live answer even if the payload had some", () => {
    const parsed = parseGuardianBusStatus({ status: "not_live", route: { name: "North" }, stop: null, lat: 1, lng: 2 });
    expect(parsed).toEqual({ status: "not_live", routeName: "North", stop: null });
    expect(JSON.stringify(parsed)).not.toContain("lat");
  });

  it("passes the plain statuses through", () => {
    expect(parseGuardianBusStatus({ status: "no_assignment" })).toEqual({ status: "no_assignment" });
    expect(parseGuardianBusStatus({ status: "disabled" })).toEqual({ status: "disabled" });
    expect(parseGuardianBusStatus({ status: "forbidden" })).toEqual({ status: "forbidden" });
    expect(parseGuardianBusStatus({ status: "no_vehicle", route: { name: "South" } })).toEqual({ status: "no_vehicle", routeName: "South" });
  });

  it("fails closed on anything unexpected", () => {
    for (const bad of [null, undefined, 7, "live", [], {}, { status: "weird" }, { status: 5 }]) {
      expect(parseGuardianBusStatus(bad)).toEqual({ status: "unavailable" });
    }
  });
});

describe("busStatusMessage", () => {
  it("has a calm sentence for every status and never leaks details", () => {
    const statuses = [
      { status: "live", routeName: null, stop: null, lat: 0, lng: 0, heading: null, speedKph: null, accuracyM: null, ageSeconds: 0 },
      { status: "not_live", routeName: null, stop: null },
      { status: "no_vehicle", routeName: null },
      { status: "no_assignment" },
      { status: "disabled" },
      { status: "forbidden" },
      { status: "unavailable" },
    ] as const;
    for (const s of statuses) {
      const msg = busStatusMessage(s);
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/\d{2}\.\d{3}/);
    }
  });
});

describe("freshness window", () => {
  it("matches the 10 minute rule in the database function", () => {
    expect(LIVE_FRESH_SECONDS).toBe(600);
  });
});
