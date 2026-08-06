import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Riverside Academy")).toBe("riverside-academy");
  });

  it("strips special characters", () => {
    expect(slugify("St. Mary's School!")).toBe("st-mary-s-school");
  });

  it("collapses repeated separators", () => {
    expect(slugify("A   B---C")).toBe("a-b-c");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--Leading and trailing--")).toBe("leading-and-trailing");
  });

  it("falls back to 'school' for input with no valid characters", () => {
    expect(slugify("!!!")).toBe("school");
  });

  it("falls back to 'school' for an empty string", () => {
    expect(slugify("")).toBe("school");
  });
});
