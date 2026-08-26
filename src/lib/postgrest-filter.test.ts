import { describe, expect, it } from "vitest";
import { escapePostgrestOrValue } from "./postgrest-filter";

describe("escapePostgrestOrValue", () => {
  it("wraps a plain value in quotes", () => {
    expect(escapePostgrestOrValue("%john%")).toBe('"%john%"');
  });

  it("neutralizes a comma that would otherwise split into a second filter clause", () => {
    const malicious = "%x,id.eq.deadbeef-0000-0000-0000-000000000000%";
    const escaped = escapePostgrestOrValue(malicious);
    // The whole thing stays inside one pair of quotes -- no bare top-level comma.
    expect(escaped).toBe('"%x,id.eq.deadbeef-0000-0000-0000-000000000000%"');
    expect(escaped.slice(1, -1).includes('","')).toBe(false);
  });

  it("escapes embedded double quotes", () => {
    expect(escapePostgrestOrValue('%"injected%')).toBe('"%\\"injected%"');
  });

  it("escapes embedded backslashes", () => {
    expect(escapePostgrestOrValue("%back\\slash%")).toBe('"%back\\\\slash%"');
  });

  it("preserves ordinary characters found in real names", () => {
    expect(escapePostgrestOrValue("%O'Brien%")).toBe('"%O\'Brien%"');
    expect(escapePostgrestOrValue("%St. Mary's%")).toBe('"%St. Mary\'s%"');
  });
});
