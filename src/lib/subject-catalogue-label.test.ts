import { describe, it, expect } from "vitest";
import { catalogueOptionLabel, compareCatalogueOptions, gradeBandLabel } from "./subject-catalogue-label";

describe("subject catalogue labels", () => {
  it("makes same-named subjects in different bands distinguishable", () => {
    const a = catalogueOptionLabel("Mathematics", "lower_primary");
    const b = catalogueOptionLabel("Mathematics", "upper_primary");
    expect(a).not.toBe(b);
    expect(b).toBe("Mathematics — Upper primary (G4–6)");
  });

  it("falls back gracefully for a missing or unknown band", () => {
    expect(catalogueOptionLabel("Mathematics", null)).toBe("Mathematics");
    expect(gradeBandLabel("some_new_band")).toBe("some_new_band");
  });

  it("sorts by name, then by band in curriculum order", () => {
    const rows = [
      { name: "Mathematics", grade_band: "senior_school" },
      { name: "English", grade_band: "junior_school" },
      { name: "Mathematics", grade_band: "lower_primary" },
      { name: "Mathematics", grade_band: "upper_primary" },
    ];
    expect(rows.sort(compareCatalogueOptions).map((r) => `${r.name}/${r.grade_band}`)).toEqual([
      "English/junior_school",
      "Mathematics/lower_primary",
      "Mathematics/upper_primary",
      "Mathematics/senior_school",
    ]);
  });
});
