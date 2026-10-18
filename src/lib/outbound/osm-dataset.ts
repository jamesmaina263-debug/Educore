// Our own saved snapshot of OpenStreetMap schools per Kenyan county (src/data/osm-schools-ke.json), built by
// scripts/build_osm_schools.py via the "Refresh OSM schools dataset" workflow. Discover reads this first so it
// never has to wait on the free public Overpass servers (often at capacity); the live lookup stays as a fallback.
//
// The snapshot keeps the Overpass element shape ({ tags }) so parseOverpassResponse is reused unchanged.
// Data: (c) OpenStreetMap contributors, ODbL: attribution is added to every staged prospect's source note.

import snapshot from "@/data/osm-schools-ke.json";
import type { DiscoveryKinds } from "./discovery";

export type DatasetElement = { id?: string; tags?: Record<string, string> };
export type OsmDataset = {
  generated?: string;
  source?: string;
  counties?: Record<string, DatasetElement[]>;
};

/** Pure selection (the snapshot is injected so it can be tested). Returns null when the county has no data. */
export function selectDatasetElements(
  dataset: OsmDataset | null | undefined,
  county: string,
  kinds: DiscoveryKinds,
): { elements: DatasetElement[]; generated: string | null } | null {
  const all = dataset?.counties?.[county];
  if (!Array.isArray(all) || all.length === 0) return null;
  const elements =
    kinds === "all"
      ? all
      : all.filter((e) => e.tags?.amenity === (kinds === "kindergartens" ? "kindergarten" : "school"));
  return { elements, generated: typeof dataset?.generated === "string" ? dataset.generated : null };
}

/** The bundled snapshot for one county, or null when it has none (then the caller falls back to live data). */
export function bundledCountySchools(county: string, kinds: DiscoveryKinds) {
  return selectDatasetElements(snapshot as unknown as OsmDataset, county, kinds);
}
