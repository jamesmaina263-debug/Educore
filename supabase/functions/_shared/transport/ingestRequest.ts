// Pure request handling for vehicle-position-ingest (WP 5.1 part 2). Kept free of Deno/Supabase APIs
// so it is unit-tested from src/lib/vehicle-ingest-request.test.ts. The database function
// ingest_vehicle_positions() does the authoritative validation; this layer only bounds the request
// (size, shape, token format) so abuse is rejected before it costs a database round trip.

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_POINTS = 100;
// Matches create_tracker_device(): 'vt_' + 64 hex chars.
export const TOKEN_PATTERN = /^vt_[0-9a-f]{64}$/;

// Per-device and per-IP request ceilings (a phone batches points, so these are generous for real
// devices and tight for abuse).
export const DEVICE_MAX_PER_MINUTE = 120;
export const IP_MAX_PER_MINUTE = 600;
export const RATE_WINDOW_SECONDS = 60;

export function deviceBucket(tokenHash: string): string {
  return `vehicle-ingest-device:${tokenHash.slice(0, 16)}`;
}
export function ipBucket(ip: string | null): string {
  return `vehicle-ingest-ip:${ip ?? "unknown"}`;
}

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) return null;
  return TOKEN_PATTERN.test(m[1]) ? m[1] : null;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ParsedBody =
  | { ok: true; points: Record<string, unknown>[] }
  | { ok: false; status: 400 | 413; error: string };

// Accepts {"points":[...]} or a single point object {"t":..., "lat":..., "lng":...}.
export function parseIngestBody(text: string): ParsedBody {
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const obj = json as Record<string, unknown>;
  const raw: unknown = "points" in obj ? obj.points : [obj];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_POINTS) {
    return { ok: false, status: 400, error: "points_must_be_1_to_100" };
  }
  const points: Record<string, unknown>[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, status: 400, error: "invalid_point" };
    }
    // Forward only the known fields; anything else the client sends is dropped here.
    const o = p as Record<string, unknown>;
    points.push({
      t: o.t,
      lat: o.lat,
      lng: o.lng,
      speed_kph: o.speed_kph,
      heading: o.heading,
      accuracy_m: o.accuracy_m,
    });
  }
  return { ok: true, points };
}

export type IngestRpcResult = {
  status?: string;
  accepted?: number;
  duplicates?: number;
  rejected?: number;
};

// Maps the database function's result to an HTTP response. 'invalid' deliberately yields the same
// 401 body as a malformed/missing token so the endpoint doesn't reveal which tokens exist.
export function mapIngestResult(r: IngestRpcResult | null): { status: number; body: Record<string, unknown> } {
  switch (r?.status) {
    case "ok":
      return {
        status: 200,
        body: { accepted: r.accepted ?? 0, duplicates: r.duplicates ?? 0, rejected: r.rejected ?? 0 },
      };
    case "invalid":
      return { status: 401, body: { error: "unauthorized" } };
    case "disabled":
      return { status: 403, body: { error: "tracking_disabled" } };
    case "bad_request":
      return { status: 400, body: { error: "points_must_be_1_to_100" } };
    default:
      return { status: 500, body: { error: "internal_error" } };
  }
}
