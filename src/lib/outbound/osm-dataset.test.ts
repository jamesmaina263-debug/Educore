import { describe, expect, it } from "vitest";
import { parseOverpassResponse, datasetSourceNote } from "./discovery";
import { selectDatasetElements, type OsmDataset } from "./osm-dataset";

const ds: OsmDataset = {
  generated: "2026-10-18",
  counties: {
    Nyeri: [
      { id: "node/1", tags: { name: "Little Stars Kindergarten", amenity: "kindergarten", phone: "0712345678" } },
      { id: "way/2", tags: { name: "St Mary's Academy", amenity: "school", "operator:type": "private" } },
      { id: "way/3", tags: { name: "Karatina Primary School", amenity: "school", "operator:type": "public" } },
    ],
  },
};

describe("selectDatasetElements", () => {
  it("returns everything for 'all'", () => {
    expect(selectDatasetElements(ds, "Nyeri", "all")?.elements).toHaveLength(3);
  });
  it("filters kindergartens and schools", () => {
    expect(selectDatasetElements(ds, "Nyeri", "kindergartens")?.elements.map((e) => e.id)).toEqual(["node/1"]);
    expect(selectDatasetElements(ds, "Nyeri", "schools")?.elements.map((e) => e.id)).toEqual(["way/2", "way/3"]);
  });
  it("returns null (so the caller falls back to live data) for a county with no data or no dataset", () => {
    expect(selectDatasetElements(ds, "Turkana", "all")).toBeNull();
    expect(selectDatasetElements({ counties: {} }, "Nyeri", "all")).toBeNull();
    expect(selectDatasetElements(null, "Nyeri", "all")).toBeNull();
  });
  it("feeds the existing parser and ownership filter unchanged", () => {
    const sel = selectDatasetElements(ds, "Nyeri", "all")!;
    const { rows, hidden } = parseOverpassResponse({ elements: sel.elements }, "Nyeri", "hide_public");
    expect(rows.map((r) => r.school_name)).not.toContain("Karatina Primary School");
    expect(rows.map((r) => r.school_name)).toContain("St Mary's Academy");
    expect(hidden).toBeGreaterThanOrEqual(1);
  });
});

describe("datasetSourceNote", () => {
  it("keeps the ODbL attribution and adds the snapshot date", () => {
    const n = datasetSourceNote("Nyeri", new Date("2026-10-18T10:00:00Z"), "2026-10-17");
    expect(n).toContain("OpenStreetMap contributors (ODbL)");
    expect(n).toContain("snapshot 2026-10-17");
  });
  it("omits a malformed snapshot date", () => {
    expect(datasetSourceNote("Nyeri", new Date("2026-10-18T10:00:00Z"), "junk")).not.toContain("snapshot");
  });
});

describe("parseOverpassResponse with already-staged schools", () => {
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ tags: { name: `School ${i}`, amenity: "school", "operator:type": "private", phone: `07000000${String(i).padStart(2, "0")}` } }));

  it("drops already-staged schools before the cap so the next run reaches the next batch", () => {
    const elements = mk(600);
    const first = parseOverpassResponse({ elements }, "Nairobi", "all");
    expect(first.rows).toHaveLength(500);
    expect(first.truncated).toBe(100);
    const staged = new Set(first.rows.map((r) => `${r.school_name.toLowerCase()}|${(r.town_county ?? "").toLowerCase()}`));
    const second = parseOverpassResponse({ elements }, "Nairobi", "all", staged);
    expect(second.rows).toHaveLength(100);
    expect(second.known).toBe(500);
    expect(second.truncated).toBe(0);
    expect(second.rows.some((r) => staged.has(`${r.school_name.toLowerCase()}|${(r.town_county ?? "").toLowerCase()}`))).toBe(false);
  });
});
