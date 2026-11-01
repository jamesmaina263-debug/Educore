import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFeatureFlag, isValidFeatureFlagKey } from "./feature-flags";

function clientWith(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

describe("isValidFeatureFlagKey", () => {
  it("accepts dotted lowercase keys", () => {
    expect(isValidFeatureFlagKey("feature.finance.c2b_capture")).toBe(true);
    expect(isValidFeatureFlagKey("cbc_pilot")).toBe(true);
  });
  it("rejects malformed keys", () => {
    for (const bad of ["", "Feature.Finance", "feature..x", ".x", "x.", "has space", "a;drop", "1abc"]) {
      expect(isValidFeatureFlagKey(bad)).toBe(false);
    }
  });
});

describe("hasFeatureFlag", () => {
  it("returns true only when the database says true", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await hasFeatureFlag(clientWith(rpc), "feature.finance.c2b_capture")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("my_school_has_feature_flag", { p_key: "feature.finance.c2b_capture" });
  });

  it("returns false when the flag is off", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await hasFeatureFlag(clientWith(rpc), "feature.x.y")).toBe(false);
  });

  it("fails closed on null, non-boolean data and database errors", async () => {
    for (const result of [
      { data: null, error: null },
      { data: "true", error: null },
      { data: 1, error: null },
      { data: true, error: { message: "boom" } },
    ]) {
      const rpc = vi.fn().mockResolvedValue(result);
      expect(await hasFeatureFlag(clientWith(rpc), "feature.x.y")).toBe(false);
    }
  });

  it("fails closed when the call throws, and never throws itself", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network"));
    await expect(hasFeatureFlag(clientWith(rpc), "feature.x.y")).resolves.toBe(false);
  });

  it("does not call the database for an invalid key", async () => {
    const rpc = vi.fn();
    expect(await hasFeatureFlag(clientWith(rpc), "Bad Key")).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
