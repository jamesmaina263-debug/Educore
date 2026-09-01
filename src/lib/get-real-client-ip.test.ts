import { describe, expect, it } from "vitest";
import { getRealClientIp } from "./get-real-client-ip";

describe("getRealClientIp", () => {
  it("returns 'unknown' when the header is missing", () => {
    expect(getRealClientIp(null)).toBe("unknown");
  });

  it("returns 'unknown' when the header is empty or only commas", () => {
    expect(getRealClientIp("")).toBe("unknown");
    expect(getRealClientIp(" , , ")).toBe("unknown");
  });

  it("returns the single entry unchanged", () => {
    expect(getRealClientIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("returns the LAST entry, not the first, for a multi-hop chain", () => {
    // The first entry is fully caller-controlled; the last is the one
    // Vercel's/Supabase's edge itself appended.
    expect(getRealClientIp("1.2.3.4, 5.6.7.8, 196.201.214.10")).toBe("196.201.214.10");
  });

  it("trims whitespace around entries", () => {
    expect(getRealClientIp("1.2.3.4 ,  5.6.7.8  ")).toBe("5.6.7.8");
  });
});
