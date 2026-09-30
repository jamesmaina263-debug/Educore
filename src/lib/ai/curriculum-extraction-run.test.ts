import { describe, it, expect, vi, afterEach } from "vitest";
import { runCurriculumExtraction } from "./curriculum-extraction";

const body = { strands: [{ name: "Numbers", sub_strands: [{ name: "Whole", confidence: "high" }] }] };
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(b) }] } }] }) });
const opts = { apiKey: "k", label: "Mathematics", documentText: "text", origin: "platform" as const };

afterEach(() => vi.unstubAllGlobals());

describe("runCurriculumExtraction", () => {
  it("returns the parsed structure on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
    const r = await runCurriculumExtraction(opts);
    expect("result" in r && r.result.strands[0].name).toBe("Numbers");
    expect("truncated" in r && r.truncated).toBe(false);
  });
  it("reports truncation for very long text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(body)));
    const r = await runCurriculumExtraction({ ...opts, documentText: "a".repeat(70000) });
    expect("truncated" in r && r.truncated).toBe(true);
  });
  it("categorises timeouts, rate limits and auth failures", async () => {
    const t = new Error("t"); t.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(t));
    expect(await runCurriculumExtraction(opts)).toMatchObject({ failureCategory: "timeout" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "" }));
    expect(await runCurriculumExtraction(opts)).toMatchObject({ failureCategory: "rate_limit" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" }));
    expect(await runCurriculumExtraction(opts)).toMatchObject({ failureCategory: "auth_config" });
  });
  it("reports no structure and malformed output distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ strands: [] })));
    expect(await runCurriculumExtraction(opts)).toMatchObject({ failureCategory: "no_structure_found" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "nope" }] } }] }) }));
    expect(await runCurriculumExtraction(opts)).toMatchObject({ failureCategory: "malformed_response" });
  });
});
