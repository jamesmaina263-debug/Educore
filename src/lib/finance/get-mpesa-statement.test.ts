import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  // Input validation must reject before any database client is created.
  createClient: vi.fn(() => {
    throw new Error("createClient should not be reached for invalid input");
  }),
}));

import { getMpesaStatement } from "./get-mpesa-statement";

describe("getMpesaStatement input validation", () => {
  it("rejects malformed dates", async () => {
    expect(await getMpesaStatement("", "2026-10-03")).toEqual({ error: "Choose a valid start and end date." });
    expect(await getMpesaStatement("2026-10-03", "03/10/2026")).toEqual({ error: "Choose a valid start and end date." });
    expect(await getMpesaStatement("2026-13-45", "2026-10-03")).toEqual({ error: "Choose a valid start and end date." });
  });

  it("rejects an end date before the start date", async () => {
    expect(await getMpesaStatement("2026-10-03", "2026-10-02")).toEqual({
      error: "The end date must be on or after the start date.",
    });
  });

  it("rejects ranges longer than 400 days", async () => {
    expect(await getMpesaStatement("2025-01-01", "2026-10-03")).toEqual({
      error: "Choose a range of 400 days or less.",
    });
  });
});
