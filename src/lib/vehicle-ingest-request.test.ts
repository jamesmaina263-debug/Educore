import { describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES,
  MAX_POINTS,
  deviceBucket,
  hashToken,
  ipBucket,
  mapIngestResult,
  parseBearerToken,
  parseIngestBody,
} from "../../supabase/functions/_shared/transport/ingestRequest";

const TOKEN = "vt_" + "ab12".repeat(16);

describe("parseBearerToken", () => {
  it("accepts a well-formed token", () => {
    expect(parseBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(parseBearerToken(`bearer   ${TOKEN}  `)).toBe(TOKEN);
  });
  it("rejects missing, wrong scheme, wrong prefix, wrong length or uppercase hex", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(TOKEN)).toBeNull();
    expect(parseBearerToken(`Basic ${TOKEN}`)).toBeNull();
    expect(parseBearerToken(`Bearer xx_${"ab12".repeat(16)}`)).toBeNull();
    expect(parseBearerToken(`Bearer ${TOKEN}0`)).toBeNull();
    expect(parseBearerToken(`Bearer ${TOKEN.slice(0, -1)}`)).toBeNull();
    expect(parseBearerToken(`Bearer vt_${"AB12".repeat(16)}`)).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});

describe("hashToken", () => {
  it("is the lowercase hex SHA-256 the database stores (sha256 of the UTF-8 token)", async () => {
    // sha256("abc")
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseIngestBody", () => {
  it("accepts a points array and strips unknown fields", () => {
    const r = parseIngestBody(
      JSON.stringify({ points: [{ t: "2026-11-02T10:00:00Z", lat: -1.29, lng: 36.82, speed_kph: 30, evil: "x" }] }),
    );
    expect(r).toEqual({
      ok: true,
      points: [{ t: "2026-11-02T10:00:00Z", lat: -1.29, lng: 36.82, speed_kph: 30, heading: undefined, accuracy_m: undefined }],
    });
    expect(r.ok && "evil" in r.points[0]).toBe(false);
  });
  it("accepts a single point object", () => {
    const r = parseIngestBody(JSON.stringify({ t: "2026-11-02T10:00:00Z", lat: 1, lng: 2 }));
    expect(r.ok && r.points.length).toBe(1);
  });
  it("enforces 1..MAX_POINTS", () => {
    const pt = { t: "2026-11-02T10:00:00Z", lat: 1, lng: 2 };
    expect(parseIngestBody(JSON.stringify({ points: [] }))).toMatchObject({ ok: false, status: 400 });
    expect(parseIngestBody(JSON.stringify({ points: Array(MAX_POINTS).fill(pt) })).ok).toBe(true);
    expect(parseIngestBody(JSON.stringify({ points: Array(MAX_POINTS + 1).fill(pt) }))).toMatchObject({ ok: false, status: 400 });
  });
  it("rejects bad JSON, non-objects, non-array points and non-object points", () => {
    expect(parseIngestBody("{nope")).toEqual({ ok: false, status: 400, error: "invalid_json" });
    expect(parseIngestBody("[]")).toEqual({ ok: false, status: 400, error: "invalid_body" });
    expect(parseIngestBody("null")).toEqual({ ok: false, status: 400, error: "invalid_body" });
    expect(parseIngestBody(JSON.stringify({ points: "x" }))).toMatchObject({ ok: false, status: 400 });
    expect(parseIngestBody(JSON.stringify({ points: [1] }))).toEqual({ ok: false, status: 400, error: "invalid_point" });
    expect(parseIngestBody(JSON.stringify({ points: [[1, 2]] }))).toEqual({ ok: false, status: 400, error: "invalid_point" });
  });
  it("rejects oversized bodies with 413", () => {
    const big = JSON.stringify({ points: [{ t: "x".repeat(MAX_BODY_BYTES) }] });
    expect(parseIngestBody(big)).toEqual({ ok: false, status: 413, error: "payload_too_large" });
  });
});

describe("mapIngestResult", () => {
  it("maps database statuses to HTTP", () => {
    expect(mapIngestResult({ status: "ok", accepted: 2, duplicates: 1, rejected: 0 })).toEqual({
      status: 200,
      body: { accepted: 2, duplicates: 1, rejected: 0 },
    });
    expect(mapIngestResult({ status: "invalid" })).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(mapIngestResult({ status: "disabled" })).toEqual({ status: 403, body: { error: "tracking_disabled" } });
    expect(mapIngestResult({ status: "bad_request" }).status).toBe(400);
    expect(mapIngestResult(null).status).toBe(500);
    expect(mapIngestResult({ status: "weird" }).status).toBe(500);
  });
  it("gives an unknown token the same body as a malformed one", () => {
    expect(mapIngestResult({ status: "invalid" }).body).toEqual({ error: "unauthorized" });
  });
});

describe("rate-limit buckets", () => {
  it("never put the full token hash in a bucket name", () => {
    const h = "f".repeat(64);
    expect(deviceBucket(h)).toBe("vehicle-ingest-device:" + "f".repeat(16));
    expect(deviceBucket(h)).not.toContain(h);
    expect(ipBucket(null)).toBe("vehicle-ingest-ip:unknown");
    expect(ipBucket("1.2.3.4")).toBe("vehicle-ingest-ip:1.2.3.4");
  });
});
