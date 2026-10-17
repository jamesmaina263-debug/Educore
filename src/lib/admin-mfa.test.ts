import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminMfaState, isSuperAdminAnyAal, isTotpCode } from "./admin-mfa";

type RpcResult = { data: unknown; error: { message: string } | null };

function client(rpc: Record<string, RpcResult>, level: "aal1" | "aal2" | "throw" = "aal1") {
  return {
    rpc: vi.fn(async (name: string) => rpc[name] ?? { data: null, error: { message: "missing" } }),
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => {
          if (level === "throw") throw new Error("boom");
          return { data: { currentLevel: level } };
        }),
      },
    },
  } as unknown as SupabaseClient;
}

describe("isSuperAdminAnyAal", () => {
  it("uses the new RPC when it exists", async () => {
    const c = client({ auth_is_super_admin_any_aal: { data: true, error: null } });
    expect(await isSuperAdminAnyAal(c)).toBe(true);
  });

  it("falls back to auth_is_super_admin when the new RPC is not deployed yet", async () => {
    const c = client({
      auth_is_super_admin_any_aal: { data: null, error: { message: "function does not exist" } },
      auth_is_super_admin: { data: true, error: null },
    });
    expect(await isSuperAdminAnyAal(c)).toBe(true);
  });

  it("is false for a non-admin", async () => {
    const c = client({ auth_is_super_admin_any_aal: { data: false, error: null } });
    expect(await isSuperAdminAnyAal(c)).toBe(false);
  });
});

describe("getAdminMfaState", () => {
  it("treats a missing admin_mfa_required RPC as not enforced", async () => {
    const c = client({ admin_mfa_required: { data: null, error: { message: "missing" } } });
    expect(await getAdminMfaState(c)).toEqual({ required: false, currentLevel: "aal1" });
  });

  it("reports enforcement and aal2", async () => {
    const c = client({ admin_mfa_required: { data: true, error: null } }, "aal2");
    expect(await getAdminMfaState(c)).toEqual({ required: true, currentLevel: "aal2" });
  });

  it("returns a null level if the assurance lookup throws", async () => {
    const c = client({ admin_mfa_required: { data: true, error: null } }, "throw");
    expect((await getAdminMfaState(c)).currentLevel).toBeNull();
  });
});

describe("isTotpCode", () => {
  it("accepts exactly six digits", () => {
    expect(isTotpCode("123456")).toBe(true);
    expect(isTotpCode("12345")).toBe(false);
    expect(isTotpCode("1234567")).toBe(false);
    expect(isTotpCode("12a456")).toBe(false);
    expect(isTotpCode(123456)).toBe(false);
  });
});
