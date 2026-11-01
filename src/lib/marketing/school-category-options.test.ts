import { describe, expect, it } from "vitest";
import { parseSchoolCategory, schoolCategoryFromPath, schoolCategoryLabel } from "./school-category-options";

describe("parseSchoolCategory", () => {
  it("returns the slug only for an exact match", () => {
    expect(parseSchoolCategory("secondary-schools")).toBe("secondary-schools");
    expect(parseSchoolCategory("  secondary-schools ")).toBe("secondary-schools");
    for (const bad of ["", null, undefined, 42, "Secondary-Schools", "secondary", "secondary-schools/extra"]) {
      expect(parseSchoolCategory(bad), String(bad)).toBeNull();
    }
  });
});

describe("schoolCategoryFromPath", () => {
  it("recognises the five landing-page paths, with or without a trailing slash", () => {
    expect(schoolCategoryFromPath("/schools/nursery-kindergarten")).toBe("nursery-kindergarten");
    expect(schoolCategoryFromPath("/schools/integrated-schools/")).toBe("integrated-schools");
  });

  it("ignores everything else (other pages, unknown categories, nested paths, query strings)", () => {
    for (const bad of ["/contact", "/schools", "/schools/", "/schools/university", "/schools/primary-schools/x", "/schools/primary-schools?a=1", "", null, undefined]) {
      expect(schoolCategoryFromPath(bad), String(bad)).toBeNull();
    }
  });
});

describe("schoolCategoryLabel", () => {
  it("gives the human label shown in the form and stored with the request", () => {
    expect(schoolCategoryLabel("primary-schools")).toBe("Primary school");
    expect(schoolCategoryLabel("integrated-schools")).toBe("Integrated school (several levels)");
  });
});
