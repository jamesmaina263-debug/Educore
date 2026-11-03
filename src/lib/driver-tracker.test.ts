import { describe, expect, it } from "vitest";
import {
  cleanPoint, extractBearer, httpStatusForIngest, isValidToken, nextBatch, parsePositionsBody,
  pointFromGeolocation, shouldKeep, trimQueue, type TrackPoint,
} from "./driver-tracker";

const tok = "vt_" + "a1".repeat(32);
const pt = (n: number): TrackPoint => ({ t: new Date(1_700_000_000_000 + n * 1000).toISOString(), lat: -1.28, lng: 36.82 });

describe("token and bearer", () => {
  it("accepts only the real token shape", () => {
    expect(isValidToken(tok)).toBe(true);
    expect(isValidToken("vt_short")).toBe(false);
    expect(isValidToken("xx_" + "a1".repeat(32))).toBe(false);
    expect(isValidToken("vt_" + "A1".repeat(32))).toBe(false);
    expect(isValidToken(null)).toBe(false);
  });
  it("extracts a bearer token", () => {
    expect(extractBearer(`Bearer ${tok}`)).toBe(tok);
    expect(extractBearer(`bearer ${tok}`)).toBe(tok);
    expect(extractBearer(tok)).toBeNull();
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer("Bearer a b")).toBeNull();
  });
});

describe("cleanPoint / parsePositionsBody", () => {
  it("rejects impossible positions", () => {
    expect(cleanPoint({ t: "nope", lat: 0, lng: 0 })).toBeNull();
    expect(cleanPoint({ t: "2026-11-03T00:00:00Z", lat: 91, lng: 0 })).toBeNull();
    expect(cleanPoint({ t: "2026-11-03T00:00:00Z", lat: 0, lng: 181 })).toBeNull();
    expect(cleanPoint({ t: "2026-11-03T00:00:00Z", lat: "1", lng: 0 })).toBeNull();
    expect(cleanPoint(null)).toBeNull();
  });
  it("drops out-of-range optional fields but keeps the point", () => {
    const p = cleanPoint({ t: "2026-11-03T00:00:00Z", lat: 1, lng: 2, speed_kph: 999, heading: 400, accuracy_m: -1 });
    expect(p).toEqual({ t: "2026-11-03T00:00:00.000Z", lat: 1, lng: 2 });
  });
  it("bounds the batch and drops bad points", () => {
    expect(parsePositionsBody({ points: [] })).toBeNull();
    expect(parsePositionsBody({ points: Array.from({ length: 101 }, (_, i) => pt(i)) })).toBeNull();
    expect(parsePositionsBody({ nope: 1 })).toBeNull();
    expect(parsePositionsBody({ points: [{ lat: 1 }] })).toBeNull();
    expect(parsePositionsBody({ points: [pt(1), { lat: 1 }] })?.points).toHaveLength(1);
  });
});

describe("geolocation mapping and queue", () => {
  it("converts m/s to km/h and handles nulls", () => {
    const p = pointFromGeolocation({ timestamp: 1_700_000_000_000, coords: { latitude: -1, longitude: 36, speed: 10, heading: 90, accuracy: 5 } });
    expect(p?.speed_kph).toBeCloseTo(36);
    const q = pointFromGeolocation({ timestamp: 1_700_000_000_000, coords: { latitude: -1, longitude: 36, speed: null, heading: null, accuracy: 5 } });
    expect(q?.speed_kph).toBeUndefined();
    expect(q?.heading).toBeUndefined();
  });
  it("keeps the newest points, batches in order, throttles", () => {
    const q = Array.from({ length: 6 }, (_, i) => pt(i));
    expect(trimQueue(q, 4).map((p) => p.t)).toEqual(q.slice(2).map((p) => p.t));
    const { batch, rest } = nextBatch(q, 4);
    expect(batch).toHaveLength(4);
    expect(rest).toHaveLength(2);
    expect(shouldKeep(null, 1000)).toBe(true);
    expect(shouldKeep(1000, 5000)).toBe(false);
    expect(shouldKeep(1000, 11000)).toBe(true);
  });
  it("maps ingest statuses", () => {
    expect(httpStatusForIngest("ok")).toBe(200);
    expect(httpStatusForIngest("invalid")).toBe(401);
    expect(httpStatusForIngest("disabled")).toBe(403);
    expect(httpStatusForIngest("bad_request")).toBe(400);
    expect(httpStatusForIngest(undefined)).toBe(502);
  });
});
