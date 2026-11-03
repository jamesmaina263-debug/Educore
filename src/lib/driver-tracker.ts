// Pure helpers for the driver phone app (WP 5.2): token shape, request parsing, and the batching queue.
// Nothing here touches the network, the clock (callers pass times) or the database.

export const DRIVER_TOKEN_RE = /^vt_[0-9a-f]{64}$/;
export const MAX_POINTS_PER_BATCH = 100;
export const MAX_QUEUED_POINTS = 500;
export const MAX_BODY_BYTES = 64 * 1024;

export interface TrackPoint {
  t: string; // ISO-8601
  lat: number;
  lng: number;
  speed_kph?: number;
  heading?: number;
  accuracy_m?: number;
}

export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export function isValidToken(token: string | null): token is string {
  return token !== null && DRIVER_TOKEN_RE.test(token);
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Cleans one raw point; returns null when it cannot be a real position. Optional fields are dropped if out of range. */
export function cleanPoint(raw: unknown): TrackPoint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.t !== "string" || Number.isNaN(Date.parse(r.t))) return null;
  if (!finite(r.lat) || !finite(r.lng) || r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) return null;
  const p: TrackPoint = { t: new Date(r.t).toISOString(), lat: r.lat, lng: r.lng };
  if (finite(r.speed_kph) && r.speed_kph >= 0 && r.speed_kph <= 300) p.speed_kph = r.speed_kph;
  if (finite(r.heading) && r.heading >= 0 && r.heading <= 360) p.heading = r.heading;
  if (finite(r.accuracy_m) && r.accuracy_m >= 0) p.accuracy_m = r.accuracy_m;
  return p;
}

/** Validates a request body of the form { points: [...] }. Bad points are dropped; an empty or oversized batch is rejected. */
export function parsePositionsBody(body: unknown): { points: TrackPoint[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const pts = (body as { points?: unknown }).points;
  if (!Array.isArray(pts) || pts.length === 0 || pts.length > MAX_POINTS_PER_BATCH) return null;
  const clean = pts.map(cleanPoint).filter((p): p is TrackPoint => p !== null);
  return clean.length > 0 ? { points: clean } : null;
}

export interface GeoLike {
  timestamp: number;
  coords: { latitude: number; longitude: number; speed: number | null; heading: number | null; accuracy: number };
}

/** Browser geolocation reading -> wire point. Speed arrives in m/s and is sent as km/h. */
export function pointFromGeolocation(g: GeoLike): TrackPoint | null {
  return cleanPoint({
    t: new Date(g.timestamp).toISOString(),
    lat: g.coords.latitude,
    lng: g.coords.longitude,
    speed_kph: g.coords.speed === null || !Number.isFinite(g.coords.speed) ? undefined : g.coords.speed * 3.6,
    heading: g.coords.heading === null || !Number.isFinite(g.coords.heading) ? undefined : g.coords.heading,
    accuracy_m: g.coords.accuracy,
  });
}

/** Keeps the newest points when the offline queue outgrows its cap. */
export function trimQueue(queue: TrackPoint[], max = MAX_QUEUED_POINTS): TrackPoint[] {
  return queue.length <= max ? queue : queue.slice(queue.length - max);
}

export function nextBatch(queue: TrackPoint[], size = MAX_POINTS_PER_BATCH): { batch: TrackPoint[]; rest: TrackPoint[] } {
  return { batch: queue.slice(0, size), rest: queue.slice(size) };
}

/** Whether a new reading is far enough after the last kept one (throttle, in ms). */
export function shouldKeep(lastKeptMs: number | null, readingMs: number, minGapMs = 10_000): boolean {
  return lastKeptMs === null || readingMs - lastKeptMs >= minGapMs;
}

/** Maps the database ingest status to an HTTP status for the driver app. */
export function httpStatusForIngest(status: unknown): number {
  switch (status) {
    case "ok": return 200;
    case "bad_request": return 400;
    case "invalid": return 401;
    case "disabled": return 403;
    default: return 502;
  }
}
