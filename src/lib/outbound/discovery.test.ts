import { describe, expect, it } from "vitest";
import {
  KENYA_COUNTIES,
  buildOverpassQuery,
  overpassQueryFor,
  classifyLevel,
  discoverySourceNote,
  isKenyaCounty,
  parseOverpassResponse,
} from "./discovery";

describe("buildOverpassQuery", () => {
  it("targets schools and kindergartens in the county by default", () => {
    const q = buildOverpassQuery("Nakuru", "all");
    expect(q).toContain("^(school|kindergarten)$");
    expect(q).toContain('"name"~"^Nakuru( City)?( County)?$"');
    expect(q).toContain("out center tags");
  });
  it("can target kindergartens only", () => {
    expect(buildOverpassQuery("Nairobi", "kindergartens")).toContain("^(kindergarten)$");
  });
  it("makes hyphens, spaces and apostrophes wildcard-tolerant", () => {
    expect(buildOverpassQuery("Elgeyo-Marakwet", "all")).toContain("^Elgeyo.Marakwet(");
    expect(buildOverpassQuery("Murang'a", "all")).toContain("^Murang.a(");
  });
});

describe("query variants", () => {
  it("area variant keeps the proven precomputed-area form", () => {
    const q = buildOverpassQuery("Laikipia", "all", "area");
    expect(q).toContain('area["ISO3166-1"="KE"]');
    expect(q).toContain("(area.ke)->.county");
    expect(q).not.toContain("map_to_area");
  });
  it("derived variant avoids the area index: boundary relation in a Kenya box, converted on the fly", () => {
    const q = buildOverpassQuery("Laikipia", "kindergartens", "derived");
    expect(q).toContain('rel["boundary"="administrative"]["admin_level"="4"]["name"~"^Laikipia( City)?( County)?$",i](-5.0,33.8,5.3,42.1);');
    expect(q).toContain("map_to_area->.county;");
    expect(q).not.toContain('area["ISO3166-1"');
    expect(q).toContain("^(kindergarten)$");
    expect(q).toContain("(area.county)");
  });
  it("sends the primary server the proven form and every mirror the index-free form", () => {
    const f = overpassQueryFor("Nyeri", "all");
    expect(f("https://overpass-api.de/api/interpreter")).toContain("(area.ke)->.county");
    expect(f("https://overpass.kumi.systems/api/interpreter")).toContain("map_to_area");
    expect(f("https://overpass.private.coffee/api/interpreter")).toContain("map_to_area");
  });
});

describe("county list", () => {
  it("has all 47 counties and rejects anything else", () => {
    expect(KENYA_COUNTIES).toHaveLength(47);
    expect(isKenyaCounty("Mombasa")).toBe(true);
    expect(isKenyaCounty('Nakuru"];out;')).toBe(false);
  });
});

describe("classifyLevel", () => {
  it("prefers amenity, then isced, then name", () => {
    expect(classifyLevel({ amenity: "kindergarten" }, "Sunshine")).toBe("kindergarten");
    expect(classifyLevel({ amenity: "school", "isced:level": "1" }, "Sunshine")).toBe("primary");
    expect(classifyLevel({ amenity: "school", "isced:level": "2;3" }, "Sunshine")).toBe("secondary");
    expect(classifyLevel({ amenity: "school" }, "Little Stars Nursery School")).toBe("kindergarten");
    expect(classifyLevel({ amenity: "school" }, "Moi High School")).toBe("secondary");
    expect(classifyLevel({ amenity: "school" }, "Moi Academy")).toBe("other");
  });
});

describe("parseOverpassResponse", () => {
  const data = {
    elements: [
      { type: "node", id: 1, tags: { amenity: "school", name: "Sunrise Academy", "operator:type": "private", phone: "+254 712 345 678; +254 700 000 000", website: "sunrise.ac.ke", email: "Head@Sunrise.ac.ke", "addr:suburb": "Milimani" } },
      { type: "way", id: 2, tags: { amenity: "kindergarten", name: "Tiny Tots Nursery" } },
      { type: "node", id: 3, tags: { amenity: "school", name: "Sunrise Academy", "addr:suburb": "Milimani" } },
      { type: "node", id: 4, tags: { amenity: "school" } },
      { type: "node", id: 5, tags: { amenity: "school", name: "Kenya Primary", operator: "Ministry of Education" } },
    ],
  };
  it("maps tags, dedupes, skips unnamed and sorts reachable schools first", () => {
    const r = parseOverpassResponse(data, "Nakuru");
    expect(r.rows.map((x) => x.school_name)).toEqual(["Sunrise Academy", "Tiny Tots Nursery", "Kenya Primary"]);
    expect(r.rows[0]).toMatchObject({
      town_county: "Milimani, Nakuru",
      school_type: "private",
      phone: "+254712345678",
      website: "https://sunrise.ac.ke",
      email: "head@sunrise.ac.ke",
    });
    expect(r.rows[1]).toMatchObject({ school_level: "kindergarten", town_county: "Nakuru", phone: null });
    expect(r.rows[2]).toMatchObject({ school_type: "public", school_level: "primary" });
    expect(r.truncated).toBe(0);
  });
  it("can hide likely-public schools before the cap and report how many", () => {
    const mixed = {
      elements: [
        { type: "node", id: 1, tags: { amenity: "school", name: "Murera View Academy" } },
        { type: "node", id: 2, tags: { amenity: "school", name: "Giakanja Boys High School" } },
        { type: "node", id: 3, tags: { amenity: "school", name: "Gatimu Ngandu" } },
        { type: "node", id: 4, tags: { amenity: "kindergarten", name: "Tiny Tots" } },
      ],
    };
    const hide = parseOverpassResponse(mixed, "Nyeri", "hide_public");
    expect(hide.rows.map((r) => r.school_name).sort()).toEqual(["Gatimu Ngandu", "Murera View Academy", "Tiny Tots"]);
    expect(hide.hidden).toBe(1);
    const priv = parseOverpassResponse(mixed, "Nyeri", "private_only");
    expect(priv.rows.map((r) => r.school_name).sort()).toEqual(["Murera View Academy", "Tiny Tots"]);
    expect(priv.hidden).toBe(2);
    expect(parseOverpassResponse(mixed, "Nyeri").hidden).toBe(0);
  });
  it("is safe on garbage", () => {
    expect(parseOverpassResponse(null, "Nakuru").rows).toEqual([]);
    expect(parseOverpassResponse({ elements: "x" }, "Nakuru").rows).toEqual([]);
  });
});

describe("discoverySourceNote", () => {
  it("carries the ODbL attribution and date", () => {
    expect(discoverySourceNote("Nakuru", new Date("2026-10-16T10:00:00Z"))).toBe(
      "OpenStreetMap contributors (ODbL), Nakuru County, discovered 2026-10-16",
    );
  });
});
