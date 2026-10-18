// Automatic school discovery from OpenStreetMap (Overpass API). Free, no API key, and the data is
// licensed ODbL: reuse is allowed WITH attribution, which is why every discovered row carries
// "OpenStreetMap contributors (ODbL)" in its source_note. Pure helpers only (query builder and
// response parser); the network call lives in the server action.
//
// Coverage caveat: OSM in Kenya has good school names and locations but sparse phone/email/website.
// Discovery fills the top of the funnel; contact details usually still need a human or a follow-up
// enrichment step.

import { ownershipSignal, passesOwnershipFilter, type OwnershipFilter } from "./ownership";
import {
  MAX_IMPORT_ROWS,
  normalizePhone,
  normalizeSchoolLevel,
  normalizeWebsite,
  type OutboundSchoolLevel,
  type OutboundSchoolType,
  type ProspectRow,
} from "./prospects";

export const KENYA_COUNTIES = [
  "Baringo", "Bomet", "Bungoma", "Busia", "Elgeyo-Marakwet", "Embu", "Garissa", "Homa Bay",
  "Isiolo", "Kajiado", "Kakamega", "Kericho", "Kiambu", "Kilifi", "Kirinyaga", "Kisii", "Kisumu",
  "Kitui", "Kwale", "Laikipia", "Lamu", "Machakos", "Makueni", "Mandera", "Marsabit", "Meru",
  "Migori", "Mombasa", "Murang'a", "Nairobi", "Nakuru", "Nandi", "Narok", "Nyamira", "Nyandarua",
  "Nyeri", "Samburu", "Siaya", "Taita-Taveta", "Tana River", "Tharaka-Nithi", "Trans Nzoia",
  "Turkana", "Uasin Gishu", "Vihiga", "Wajir", "West Pokot",
] as const;
export type KenyaCounty = (typeof KENYA_COUNTIES)[number];

export type DiscoveryKinds = "all" | "kindergartens" | "schools";

export function isKenyaCounty(v: string): v is KenyaCounty {
  return (KENYA_COUNTIES as readonly string[]).includes(v);
}

/** Overpass regex for a county's OSM name: tolerant of "X County"/"X City" suffixes and -/space/' variants. */
function countyNameRegex(county: KenyaCounty): string {
  const loose = county.replace(/[^A-Za-z0-9]/g, ".");
  return `^${loose}( City)?( County)?$`;
}

/**
 * Two ways to say "inside this county", because not every public Overpass server maintains the
 * precomputed area index the first form needs (the backups answered HTTP 500 to it in production):
 *  - "area":    uses precomputed areas (fast; works on overpass-api.de, the primary).
 *  - "derived": finds the county boundary relation inside a Kenya bounding box and converts it to an
 *               area on the fly (`map_to_area`), which works without the index.
 */
export type OverpassQueryVariant = "area" | "derived";

const KENYA_BBOX = "-5.0,33.8,5.3,42.1"; // south,west,north,east: generous box around Kenya

export function buildOverpassQuery(
  county: KenyaCounty,
  kinds: DiscoveryKinds,
  variant: OverpassQueryVariant = "area",
): string {
  const amenity = kinds === "kindergartens" ? "kindergarten" : kinds === "schools" ? "school" : "school|kindergarten";
  // Safe to interpolate: county is validated against the fixed KENYA_COUNTIES list (isKenyaCounty).
  const nameRe = countyNameRegex(county);
  const select =
    variant === "derived"
      ? `rel["boundary"="administrative"]["admin_level"="4"]["name"~"${nameRe}",i](${KENYA_BBOX});
map_to_area->.county;`
      : `area["ISO3166-1"="KE"]["admin_level"="2"]->.ke;
area["boundary"="administrative"]["admin_level"="4"]["name"~"${nameRe}",i](area.ke)->.county;`;
  return `[out:json][timeout:25];
${select}
(
  nwr["amenity"~"^(${amenity})$"]["name"](area.county);
);
out center tags 1500;`;
}

/** Which query variant each server gets: the primary keeps the proven form, mirrors get the index-free one. */
export function overpassQueryFor(county: KenyaCounty, kinds: DiscoveryKinds): (endpoint: string) => string {
  const area = buildOverpassQuery(county, kinds, "area");
  const derived = buildOverpassQuery(county, kinds, "derived");
  return (endpoint) => (endpoint.includes("overpass-api.de") ? area : derived);
}

type OsmElement = { type?: string; id?: number; tags?: Record<string, string> };

const KINDERGARTEN_NAME = /(kinder|nursery|pre-?primary|pre-?school|playgroup|day ?care|ecde|little|tiny|junior academy)/i;

export function classifyLevel(tags: Record<string, string>, name: string): OutboundSchoolLevel {
  if (tags.amenity === "kindergarten") return "kindergarten";
  const isced = (tags["isced:level"] ?? "").split(";")[0].trim();
  if (isced === "0") return "kindergarten";
  if (isced === "1") return "primary";
  if (isced === "2" || isced === "3") return "secondary";
  if (/(kinder|nursery|pre-?primary|pre-?school|playgroup|day ?care|ecde)/i.test(name)) return "kindergarten";
  const fromName = normalizeSchoolLevel(name);
  if (fromName && fromName !== "other") return fromName;
  return KINDERGARTEN_NAME.test(name) ? "kindergarten" : "other";
}

function classifyType(tags: Record<string, string>): OutboundSchoolType | null {
  const t = (tags["operator:type"] ?? "").toLowerCase();
  if (t === "public" || t === "government") return "public";
  if (t === "private") return "private";
  if (t) return "other";
  const op = (tags.operator ?? "").toLowerCase();
  if (/(ministry|government|county|gok)/.test(op)) return "public";
  return null;
}

const first = (v: string | undefined) => (v ?? "").split(";")[0].trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type DiscoveryParse = {
  rows: ProspectRow[];
  /** Rows beyond MAX_IMPORT_ROWS that were left out (lowest-priority first: those with no contact route). */
  truncated: number;
  /** Schools left out by the ownership filter (e.g. likely-public schools). */
  hidden: number;
  /** Schools already staged (matched by the same name|town key the database dedupes on), dropped BEFORE the cap. */
  known: number;
};

export function parseOverpassResponse(
  data: unknown,
  county: string,
  ownership: OwnershipFilter = "all",
  knownKeys?: ReadonlySet<string>,
): DiscoveryParse {
  const elements = (data as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return { rows: [], truncated: 0, hidden: 0, known: 0 };

  const seen = new Set<string>();
  const rows: ProspectRow[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = (tags.name ?? "").trim();
    if (!name || name.length > 200) continue;

    const place = first(tags["addr:suburb"]) || first(tags["addr:city"]) || first(tags["addr:town"]);
    const town_county = (place && place.toLowerCase() !== county.toLowerCase() ? `${place}, ${county}` : county).slice(0, 200);

    const key = `${name.toLowerCase()}|${town_county.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const emailRaw = first(tags.email ?? tags["contact:email"]).toLowerCase();
    rows.push({
      school_name: name,
      town_county,
      school_type: classifyType(tags),
      school_level: classifyLevel(tags, name),
      website: normalizeWebsite(first(tags.website ?? tags["contact:website"])),
      phone: normalizePhone(first(tags.phone ?? tags["contact:phone"] ?? tags["contact:mobile"])),
      email: emailRaw && emailRaw.length <= 254 && EMAIL_RE.test(emailRaw) ? emailRaw : null,
      contact_name: null,
      contact_role: null,
      student_count: null,
    });
  }

  // Drop schools that are already staged BEFORE the cap, so each run takes the NEXT batch instead of
  // re-selecting the same top 500. Key = the database's dedupe_key: lower(name)|lower(town_county).
  const fresh = knownKeys ? rows.filter((r) => !knownKeys.has(`${r.school_name.toLowerCase()}|${(r.town_county ?? "").toLowerCase()}`)) : rows;
  const known = rows.length - fresh.length;

  // Ownership filter next, so the 500 cap is spent on schools worth pursuing.
  const kept = fresh.filter((r) => passesOwnershipFilter(ownershipSignal(r), ownership));
  const hidden = fresh.length - kept.length;
  rows.length = 0;
  rows.push(...kept);

  // Keep the most reachable schools if we have to cut: email > phone > website > nothing.
  const reach = (r: ProspectRow) => (r.email ? 3 : 0) + (r.phone ? 2 : 0) + (r.website ? 1 : 0);
  rows.sort((a, b) => reach(b) - reach(a));
  const truncated = Math.max(0, rows.length - MAX_IMPORT_ROWS);
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), truncated, hidden, known };
}

export function discoverySourceNote(county: string, date: Date): string {
  return `OpenStreetMap contributors (ODbL), ${county} County, discovered ${date.toISOString().slice(0, 10)}`;
}

/** Source note for rows staged from our saved OpenStreetMap snapshot (same ODbL attribution, plus its date). */
export function datasetSourceNote(county: string, date: Date, snapshotDate: string | null): string {
  const snap = snapshotDate && /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) ? `, map data snapshot ${snapshotDate}` : "";
  return `OpenStreetMap contributors (ODbL), ${county} County, discovered ${date.toISOString().slice(0, 10)}${snap}`;
}
