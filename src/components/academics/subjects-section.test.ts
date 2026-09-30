import { describe, it, expect } from "vitest";
import { groupByPathway, groupByGradeBand, type CatalogueSubjectRow } from "./subjects-section";

function row(over: Partial<CatalogueSubjectRow>): CatalogueSubjectRow {
  return {
    id: over.id ?? Math.random().toString(),
    grade_band: "senior_school",
    pathway: null,
    category: null,
    name: "Subject",
    code: null,
    is_core: false,
    display_order: 0,
    ...over,
  };
}

describe("groupByPathway", () => {
  it("groups Senior School rows by pathway then category, in PATHWAY_ORDER", () => {
    const catalogue = [
      row({ pathway: "STEM", category: "Pure Sciences", name: "Physics", display_order: 1 }),
      row({ pathway: "Core", category: "Core Subjects", name: "English", display_order: 0 }),
      row({ pathway: "STEM", category: "Pure Sciences", name: "Chemistry", display_order: 0 }),
    ];
    const result = groupByPathway(catalogue);
    expect(result.map((g) => g.pathway)).toEqual(["Core", "STEM"]); // Core before STEM per PATHWAY_ORDER, regardless of insertion order
    expect(result[1].categories[0].items.map((i) => i.name)).toEqual(["Chemistry", "Physics"]); // sorted by display_order
  });

  it("excludes every grade-band row, even one that somehow carries a pathway value", () => {
    const catalogue = [
      row({ grade_band: "upper_primary", pathway: null, category: null, name: "Mathematics" }),
      row({ grade_band: "junior_school", pathway: "Core", category: "Core Subjects", name: "Suspicious" }), // must still be excluded: not senior_school
      row({ grade_band: "senior_school", pathway: "Core", category: "Core Subjects", name: "English" }),
    ];
    const names = groupByPathway(catalogue).flatMap((g) => g.categories.flatMap((c) => c.items.map((i) => i.name)));
    expect(names).toEqual(["English"]);
  });

  it("drops a pathway not in PATHWAY_ORDER entirely (the allow-list behaviour the whole design relies on)", () => {
    const catalogue = [row({ grade_band: "senior_school", pathway: "Invented Pathway", category: "X", name: "Ghost" })];
    expect(groupByPathway(catalogue)).toEqual([]);
  });
});

describe("groupByGradeBand", () => {
  it("groups non-senior-school rows by grade_band, in GRADE_BAND_ORDER, sorted by display_order", () => {
    const catalogue = [
      row({ grade_band: "junior_school", name: "Agriculture", display_order: 1 }),
      row({ grade_band: "pre_primary", name: "Mathematical Activities", display_order: 0 }),
      row({ grade_band: "junior_school", name: "English", display_order: 0 }),
    ];
    const result = groupByGradeBand(catalogue);
    expect(result.map((g) => g.band)).toEqual(["pre_primary", "junior_school"]);
    expect(result[1].items.map((i) => i.name)).toEqual(["English", "Agriculture"]);
    expect(result[1].label).toBe("Junior School (Grade 7-9)");
  });

  it("excludes every senior_school row", () => {
    const catalogue = [row({ grade_band: "senior_school", pathway: "Core", category: "Core Subjects", name: "English" })];
    expect(groupByGradeBand(catalogue)).toEqual([]);
  });

  it("a catalogue row can never appear in both groupings", () => {
    const catalogue = [
      row({ grade_band: "senior_school", pathway: "Core", category: "Core Subjects", name: "Senior English" }),
      row({ grade_band: "upper_primary", name: "Upper Primary English" }),
    ];
    const pathwayNames = groupByPathway(catalogue).flatMap((g) => g.categories.flatMap((c) => c.items.map((i) => i.name)));
    const bandNames = groupByGradeBand(catalogue).flatMap((g) => g.items.map((i) => i.name));
    expect(pathwayNames).toEqual(["Senior English"]);
    expect(bandNames).toEqual(["Upper Primary English"]);
  });
});
