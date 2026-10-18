import { describe, expect, it } from "vitest";
import { isOwnershipFilter, ownershipSignal, passesOwnershipFilter } from "./ownership";

const sig = (school_name: string, school_type?: string | null, school_level?: string | null) =>
  ownershipSignal({ school_name, school_type, school_level });

describe("ownershipSignal", () => {
  it("trusts the map tag over the name", () => {
    expect(sig("Sunrise Academy", "public")).toBe("public_tagged");
    expect(sig("Boys High School", "private")).toBe("private_tagged");
  });
  it("reads private-sounding names", () => {
    expect(sig("Murera View Academy")).toBe("likely_private");
    expect(sig("St. Mary's Preparatory School")).toBe("likely_private");
    expect(sig("Kings International School")).toBe("likely_private");
    expect(sig("Little Stars Montessori")).toBe("likely_private");
  });
  it("treats kindergartens as likely private", () => {
    expect(sig("Tiny Tots", null, "kindergarten")).toBe("likely_private");
    expect(sig("Sunshine Nursery School")).toBe("likely_private");
  });
  it("reads government-sounding names", () => {
    expect(sig("Giakanja Boys High School")).toBe("likely_public");
    expect(sig("Mathaithi Girls' School")).toBe("likely_public");
    expect(sig("Sacred Heart Girls Secondary School")).toBe("likely_public");
    expect(sig("GITITU PRIMARY SCHOOL")).toBe("likely_public");
  });
  it("catches abbreviated and bare public-school names found in real OpenStreetMap data", () => {
    expect(sig("Amboni Secondary")).toBe("likely_public");
    expect(sig("Kenyatta High Mahiga")).toBe("likely_public");
    expect(sig("gititu mixed sec")).toBe("likely_public");
    expect(sig("thageini pri")).toBe("likely_public");
    expect(sig("Chinga Girls")).toBe("likely_public");
  });
  it("lets a private word beat a public word", () => {
    expect(sig("Oakwood Academy Primary School")).toBe("likely_private");
    expect(sig("Riverside International Girls School")).toBe("likely_private");
  });
  it("says unknown when the name gives no clue (including CBC 'Junior' schools)", () => {
    expect(sig("Gatimu Ngandu")).toBe("unknown");
    expect(sig("Nyeri junior & Senior School")).toBe("unknown");
    expect(sig("Hillcrest Learning Hub")).toBe("unknown");
  });
});

describe("passesOwnershipFilter", () => {
  it("hide_public keeps private and unknown, drops public", () => {
    expect(passesOwnershipFilter("likely_public", "hide_public")).toBe(false);
    expect(passesOwnershipFilter("public_tagged", "hide_public")).toBe(false);
    expect(passesOwnershipFilter("unknown", "hide_public")).toBe(true);
    expect(passesOwnershipFilter("likely_private", "hide_public")).toBe(true);
  });
  it("private_only keeps only private-leaning", () => {
    expect(passesOwnershipFilter("private_tagged", "private_only")).toBe(true);
    expect(passesOwnershipFilter("likely_private", "private_only")).toBe(true);
    expect(passesOwnershipFilter("unknown", "private_only")).toBe(false);
    expect(passesOwnershipFilter("likely_public", "private_only")).toBe(false);
  });
  it("all keeps everything; validator rejects junk", () => {
    expect(passesOwnershipFilter("public_tagged", "all")).toBe(true);
    expect(isOwnershipFilter("hide_public")).toBe(true);
    expect(isOwnershipFilter("nope")).toBe(false);
  });
});
