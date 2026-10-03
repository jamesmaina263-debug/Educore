import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Deno-targeted module (uses the Deno global and ".ts" import suffixes), so it is loaded via a
// non-literal specifier: vitest resolves it fine, while the app's tsc pass never type-checks it.
type Check = { allowed: boolean; sourceIp: string | null; enforced: boolean };
const MODULE_PATH = "../../supabase/functions/_shared/mpesa/verifyCallbackSource";
let verifyCallbackSource: (req: Request) => Check;

// verifyCallbackSource runs in Deno in production; stub the only Deno API it touches.
const env: Record<string, string | undefined> = {};
beforeEach(async () => {
  for (const k of Object.keys(env)) delete env[k];
  (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };
  verifyCallbackSource = (await import(/* @vite-ignore */ MODULE_PATH)).verifyCallbackSource;
});
afterEach(() => {
  delete (globalThis as unknown as { Deno?: unknown }).Deno;
});

const req = (headers: Record<string, string>) => new Request("https://example.test/cb", { headers });

describe("verifyCallbackSource", () => {
  it("accepts the real Daraja callback shape (extra hop appended to X-Forwarded-For)", () => {
    const r = verifyCallbackSource(
      req({
        "x-forwarded-for": "196.201.214.200,196.201.214.200, 13.248.120.200",
        "cf-connecting-ip": "196.201.214.200",
      }),
    );
    expect(r.allowed).toBe(true);
    expect(r.sourceIp).toBe("196.201.214.200");
  });

  it("accepts Daraja callbacks from the 196.201.212.x egress range seen in production", () => {
    const r = verifyCallbackSource(
      req({ "x-forwarded-for": "196.201.212.69,196.201.212.69, 13.248.120.179", "cf-connecting-ip": "196.201.212.69" }),
    );
    expect(r.allowed).toBe(true);
    expect(verifyCallbackSource(req({ "cf-connecting-ip": "196.201.211.69" })).allowed).toBe(false);
  });

  it("rejects a non-Safaricom cf-connecting-ip even if X-Forwarded-For is spoofed to a Safaricom IP", () => {
    const r = verifyCallbackSource(
      req({ "x-forwarded-for": "196.201.214.10, 203.0.113.9", "cf-connecting-ip": "203.0.113.9" }),
    );
    expect(r.allowed).toBe(false);
  });

  it("ignores a malformed cf-connecting-ip and falls back to the last X-Forwarded-For entry", () => {
    const ok = verifyCallbackSource(req({ "x-forwarded-for": "1.2.3.4, 196.201.214.5", "cf-connecting-ip": "garbage" }));
    expect(ok.allowed).toBe(true);
    const bad = verifyCallbackSource(req({ "x-forwarded-for": "196.201.214.5, 1.2.3.4", "cf-connecting-ip": "garbage" }));
    expect(bad.allowed).toBe(false);
  });

  it("without cf-connecting-ip behaves exactly as before (last X-Forwarded-For entry)", () => {
    expect(verifyCallbackSource(req({ "x-forwarded-for": "1.2.3.4, 196.201.213.7" })).allowed).toBe(true);
    expect(verifyCallbackSource(req({ "x-forwarded-for": "196.201.213.7, 1.2.3.4" })).allowed).toBe(false);
  });

  it("fails closed when no source IP can be determined", () => {
    expect(verifyCallbackSource(req({})).allowed).toBe(false);
  });
});
