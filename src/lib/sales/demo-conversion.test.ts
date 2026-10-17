import { describe, expect, it } from "vitest";
import { describeDemoConversion, parseDemoConversionResult } from "./demo-conversion";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseDemoConversionResult", () => {
  it("parses a created lead", () => {
    expect(parseDemoConversionResult({ lead_id: ID, created: true, already_linked: false, lead_name: "Sunrise" })).toEqual({
      leadId: ID,
      created: true,
      alreadyLinked: false,
      leadName: "Sunrise",
    });
  });
  it("treats missing flags as false and blank names as null", () => {
    expect(parseDemoConversionResult({ lead_id: ID, lead_name: "  " })).toEqual({
      leadId: ID,
      created: false,
      alreadyLinked: false,
      leadName: null,
    });
  });
  it.each([null, undefined, "x", 5, {}, { lead_id: "nope" }, { lead_id: 7 }])("rejects %j", (v) => {
    expect(parseDemoConversionResult(v)).toBeNull();
  });
});

describe("describeDemoConversion", () => {
  const base = { leadId: ID, created: false, alreadyLinked: false, leadName: "Sunrise" };
  it("words each outcome distinctly", () => {
    expect(describeDemoConversion({ ...base, created: true })).toMatch(/Added to the sales pipeline/);
    expect(describeDemoConversion({ ...base, alreadyLinked: true })).toMatch(/already in the sales pipeline/);
    expect(describeDemoConversion(base)).toMatch(/Linked to the existing lead "Sunrise"/);
    expect(describeDemoConversion({ ...base, leadName: null })).toMatch(/Linked to an existing lead/);
  });
});
