/** Pure helpers for the staff live bus view (WP 5.3 part 2). No I/O. */

export interface FleetRow {
  vehicle_id: string;
  registration_number: string;
  route_name: string | null;
  lat: number | null;
  lng: number | null;
  speed_kph: number | null;
  heading: number | null;
  accuracy_m: number | null;
  recorded_at: string | null;
}

/** A position older than this is shown as "not live" (same 10-minute rule the parent function uses). */
export const LIVE_WINDOW_SECONDS = 600;

export type LiveState = "live" | "stale" | "none";

export function ageSeconds(recordedAt: string | null, now: number): number | null {
  if (!recordedAt) return null;
  const t = Date.parse(recordedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

export function liveState(row: Pick<FleetRow, "recorded_at" | "lat" | "lng">, now: number): LiveState {
  if (row.lat === null || row.lng === null) return "none";
  const age = ageSeconds(row.recorded_at, now);
  if (age === null) return "none";
  return age <= LIVE_WINDOW_SECONDS ? "live" : "stale";
}

export function ageText(age: number | null): string {
  if (age === null) return "never";
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)} min ago`;
  if (age < 86400) return `${Math.floor(age / 3600)} h ago`;
  return `${Math.floor(age / 86400)} d ago`;
}

/** Google Maps link for a position; null when coordinates are missing or out of range. */
export function mapsUrl(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function speedText(kph: number | null): string {
  return kph === null || !Number.isFinite(kph) ? "-" : `${Math.round(kph)} km/h`;
}
