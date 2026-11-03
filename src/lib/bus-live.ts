// WP 5.3: live bus view. Pure helpers only (no I/O), shared by the staff fleet page, the parent portal page and
// their server actions. Everything here fails closed: input that does not look exactly right is treated as
// "no position" rather than guessed at, because the data is the location of a vehicle carrying children.

export const LIVE_TRACKING_FLAG = "feature.transport.live_tracking";
export const PARENT_BUS_VIEW_FLAG = "feature.transport.parent_bus_view";

/** A position older than this is "stale". Must match the 10-minute rule inside guardian_bus_status(). */
export const LIVE_FRESH_SECONDS = 10 * 60;
/** How often the open pages ask for a new position. */
export const POLL_INTERVAL_MS = 30_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function validCoordinates(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ---------------------------------------------------------------------------------------------- staff fleet

export type Liveness = "live" | "stale" | "never";

export interface FleetVehicle {
  vehicleId: string;
  registration: string;
  routeName: string | null;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  heading: number | null;
  accuracyM: number | null;
  recordedAt: string | null;
}

/** Turn the rows of fleet_live_status() into typed vehicles. Rows without a usable id/registration are dropped. */
export function parseFleetRows(raw: unknown): FleetVehicle[] {
  if (!Array.isArray(raw)) return [];
  const out: FleetVehicle[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isUuid(r.vehicle_id) || typeof r.registration_number !== "string" || r.registration_number === "") continue;
    const lat = finiteNumber(r.lat);
    const lng = finiteNumber(r.lng);
    const hasPosition = validCoordinates(lat, lng);
    const recordedAt = typeof r.recorded_at === "string" && !Number.isNaN(Date.parse(r.recorded_at)) ? r.recorded_at : null;
    out.push({
      vehicleId: r.vehicle_id,
      registration: r.registration_number,
      routeName: typeof r.route_name === "string" && r.route_name !== "" ? r.route_name : null,
      lat: hasPosition ? lat : null,
      lng: hasPosition ? finiteNumber(r.lng) : null,
      speedKph: hasPosition ? finiteNumber(r.speed_kph) : null,
      heading: hasPosition ? finiteNumber(r.heading) : null,
      accuracyM: hasPosition ? finiteNumber(r.accuracy_m) : null,
      recordedAt: hasPosition ? recordedAt : null,
    });
  }
  return out;
}

export function ageSeconds(recordedAt: string | null, now: Date): number | null {
  if (!recordedAt) return null;
  const t = Date.parse(recordedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 1000));
}

export function vehicleLiveness(recordedAt: string | null, now: Date): Liveness {
  const age = ageSeconds(recordedAt, now);
  if (age === null) return "never";
  return age <= LIVE_FRESH_SECONDS ? "live" : "stale";
}

const LIVENESS_ORDER: Record<Liveness, number> = { live: 0, stale: 1, never: 2 };

/** Live vehicles first, then stale, then never-seen; registration order inside each group. */
export function sortFleet(vehicles: FleetVehicle[], now: Date): FleetVehicle[] {
  return [...vehicles].sort((a, b) => {
    const la = LIVENESS_ORDER[vehicleLiveness(a.recordedAt, now)];
    const lb = LIVENESS_ORDER[vehicleLiveness(b.recordedAt, now)];
    if (la !== lb) return la - lb;
    return a.registration.localeCompare(b.registration);
  });
}

// --------------------------------------------------------------------------------------------- shared text

/** "just now", "45 s ago", "3 min ago", "2 h ago", "3 days ago". */
export function describeAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Heading in degrees to an eight-point compass label; null when there is no valid heading. */
export function compassPoint(heading: number | null): string | null {
  if (heading === null || !Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  return COMPASS[Math.round(heading / 45) % 8];
}

/**
 * Link that opens the position in OpenStreetMap. Deliberately a plain link the person chooses to open: no map is
 * embedded, so a vehicle's coordinates are not sent to a third party just by viewing the page.
 */
export function mapLink(lat: number | null, lng: number | null): string | null {
  if (!validCoordinates(lat, lng) || lng === null) return null;
  const la = lat.toFixed(5);
  const ln = lng.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=16/${la}/${ln}`;
}

// ----------------------------------------------------------------------------------------- parent status

export type GuardianBusStatus =
  | { status: "live"; routeName: string | null; stop: string | null; lat: number; lng: number; heading: number | null; speedKph: number | null; accuracyM: number | null; ageSeconds: number }
  | { status: "not_live"; routeName: string | null; stop: string | null }
  | { status: "no_vehicle"; routeName: string | null }
  | { status: "no_assignment" }
  | { status: "disabled" }
  | { status: "forbidden" }
  | { status: "unavailable" };

function routeNameOf(raw: Record<string, unknown>): string | null {
  const route = raw.route;
  if (route !== null && typeof route === "object") {
    const name = (route as Record<string, unknown>).name;
    if (typeof name === "string" && name !== "") return name;
  }
  return null;
}

/**
 * Parse the jsonb returned by guardian_bus_status(). Anything unexpected becomes "unavailable" (no position shown).
 * A "live" answer is only accepted when it carries valid coordinates AND is no older than the freshness window, so a
 * misbehaving caller or a stale cache can never make an old position look live.
 */
export function parseGuardianBusStatus(raw: unknown): GuardianBusStatus {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { status: "unavailable" };
  const r = raw as Record<string, unknown>;
  switch (r.status) {
    case "live": {
      const lat = finiteNumber(r.lat);
      const lng = finiteNumber(r.lng);
      const age = finiteNumber(r.age_seconds);
      if (!validCoordinates(lat, lng) || lng === null || age === null || age < 0 || age > LIVE_FRESH_SECONDS) {
        return { status: "unavailable" };
      }
      return {
        status: "live",
        routeName: routeNameOf(r),
        stop: typeof r.stop === "string" && r.stop !== "" ? r.stop : null,
        lat,
        lng,
        heading: finiteNumber(r.heading),
        speedKph: finiteNumber(r.speed_kph),
        accuracyM: finiteNumber(r.accuracy_m),
        ageSeconds: Math.floor(age),
      };
    }
    case "not_live":
      return { status: "not_live", routeName: routeNameOf(r), stop: typeof r.stop === "string" && r.stop !== "" ? r.stop : null };
    case "no_vehicle":
      return { status: "no_vehicle", routeName: routeNameOf(r) };
    case "no_assignment":
    case "disabled":
    case "forbidden":
      return { status: r.status };
    default:
      return { status: "unavailable" };
  }
}

/** The one sentence a parent sees for each non-live answer. Never mentions another learner or a vehicle id. */
export function busStatusMessage(status: GuardianBusStatus): string {
  switch (status.status) {
    case "live":
      return "The bus is on the move.";
    case "not_live":
      return "The bus is not sharing its location right now. It appears here while the bus is on its route.";
    case "no_vehicle":
      return "The school has not linked your child to a specific bus yet. Please ask the school office.";
    case "no_assignment":
      return "Your child is not using school transport at the moment.";
    case "disabled":
      return "Bus tracking is not switched on for your school.";
    case "forbidden":
      return "You cannot view the bus for this learner.";
    default:
      return "The bus position could not be loaded. Please try again in a moment.";
  }
}
