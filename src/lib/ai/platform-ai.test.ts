import { describe, expect, it, vi } from "vitest";
import {
  addUsage,
  aiDisabledReason,
  clampMaxOutputTokens,
  extractUsage,
  generatePlatformText,
  parseBudgetMs,
} from "./platform-ai";

const okBody = (text: string, usage = { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage }), { status: 200 });

describe("kill switch", () => {
  it("is off by default", () => {
    expect(aiDisabledReason("outreach_scoring", {})).toBeNull();
  });
  it("turns everything off with PLATFORM_AI_DISABLED", () => {
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED: "true" })).toMatch(/switched off/);
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED: "1" })).toMatch(/switched off/);
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED: "false" })).toBeNull();
  });
  it("turns one task off by name", () => {
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED_TASKS: "x, outreach_scoring" })).toMatch(/outreach_scoring/);
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED_TASKS: "other_task" })).toBeNull();
  });
});

describe("clampMaxOutputTokens", () => {
  it("never exceeds the default ceiling", () => {
    expect(clampMaxOutputTokens(100_000, {})).toBe(2048);
  });
  it("lets env lower the ceiling but ignores nonsense", () => {
    expect(clampMaxOutputTokens(1024, { PLATFORM_AI_MAX_OUTPUT_TOKENS: "512" })).toBe(512);
    expect(clampMaxOutputTokens(1024, { PLATFORM_AI_MAX_OUTPUT_TOKENS: "abc" })).toBe(1024);
    expect(clampMaxOutputTokens(1024, { PLATFORM_AI_MAX_OUTPUT_TOKENS: "5" })).toBe(1024);
  });
  it("has a sane floor", () => {
    expect(clampMaxOutputTokens(1, {})).toBe(64);
    expect(clampMaxOutputTokens(Number.NaN, {})).toBe(2048);
  });
});

describe("parseBudgetMs", () => {
  it("falls back, then clamps", () => {
    expect(parseBudgetMs(undefined, 8000, 2000, 50000)).toBe(8000);
    expect(parseBudgetMs("abc", 8000, 2000, 50000)).toBe(8000);
    expect(parseBudgetMs("100", 8000, 2000, 50000)).toBe(2000);
    expect(parseBudgetMs("999999", 8000, 2000, 50000)).toBe(50000);
    expect(parseBudgetMs("15000", 8000, 2000, 50000)).toBe(15000);
  });
});

describe("usage helpers", () => {
  it("extracts usage and tolerates its absence", () => {
    expect(extractUsage({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } })).toEqual({
      promptTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    });
    expect(extractUsage({})).toBeNull();
  });
  it("adds usage, treating null as zero", () => {
    const z = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    expect(addUsage(z, null)).toEqual(z);
    expect(addUsage({ promptTokens: 1, outputTokens: 2, totalTokens: 3 }, { promptTokens: 1, outputTokens: 1, totalTokens: 2 })).toEqual({
      promptTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    });
  });
});

describe("generatePlatformText", () => {
  const env = { GEMINI_API_KEY: "test-key" };

  it("refuses without calling the network when switched off", async () => {
    const fetchImpl = vi.fn();
    const r = await generatePlatformText({ task: "outreach_scoring", prompt: "p", env: { ...env, PLATFORM_AI_DISABLED: "true" }, fetchImpl });
    expect(r).toMatchObject({ ok: false, reason: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses without calling the network when the key is missing", async () => {
    const fetchImpl = vi.fn();
    const r = await generatePlatformText({ task: "outreach_scoring", prompt: "p", env: {}, fetchImpl });
    expect(r).toMatchObject({ ok: false, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a capped token budget and JSON mode, and returns text and usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okBody('{"a":1}'));
    const r = await generatePlatformText({
      task: "outreach_scoring",
      prompt: "hello",
      json: true,
      maxOutputTokens: 999_999,
      env,
      fetchImpl,
    });
    expect(r).toEqual({ ok: true, text: '{"a":1}', usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15 }, model: expect.any(String) });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(init.body as string);
    expect(sent.generationConfig.maxOutputTokens).toBe(2048);
    expect(sent.generationConfig.responseMimeType).toBe("application/json");
    expect(sent.contents[0].parts[0].text).toBe("hello");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not send responseMimeType unless JSON is requested", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okBody("hi"));
    await generatePlatformText({ task: "outreach_scoring", prompt: "p", env, fetchImpl });
    const sent = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.generationConfig.responseMimeType).toBeUndefined();
  });

  it("adds the Google Search tool (and no JSON mode) only when webSearch is requested, and joins split parts", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] } }] }),
        { status: 200 },
      ),
    );
    const r = await generatePlatformText({
      task: "outreach_contact_lookup",
      prompt: "p",
      json: true,
      webSearch: true,
      env: { GEMINI_API_KEY: "k" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.ok && r.text).toBe('{"a":1}');
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.tools).toEqual([{ google_search: {} }]);
    expect(sent.generationConfig.responseMimeType).toBeUndefined();
  });
  it("can switch contact lookup off on its own", () => {
    expect(aiDisabledReason("outreach_contact_lookup", { PLATFORM_AI_DISABLED_TASKS: "outreach_contact_lookup" })).toMatch(/switched off/);
    expect(aiDisabledReason("outreach_scoring", { PLATFORM_AI_DISABLED_TASKS: "outreach_contact_lookup" })).toBeNull();
  });
  it("reports an HTTP failure without leaking the key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }));
    const r = await generatePlatformText({ task: "outreach_scoring", prompt: "p", env, fetchImpl });
    expect(r).toMatchObject({ ok: false, reason: "http", error: "The AI provider responded 429." });
    expect(JSON.stringify(r)).not.toContain("test-key");
  });

  it("maps a timeout and a network error to distinct reasons without echoing them", async () => {
    const timeout = Object.assign(new Error("x https://host/?key=test-key"), { name: "TimeoutError" });
    const t = await generatePlatformText({ task: "outreach_scoring", prompt: "p", env, fetchImpl: vi.fn().mockRejectedValue(timeout) });
    expect(t).toMatchObject({ ok: false, reason: "timeout" });
    const n = await generatePlatformText({
      task: "outreach_scoring",
      prompt: "p",
      env,
      fetchImpl: vi.fn().mockRejectedValue(new Error("boom key=test-key")),
    });
    expect(n).toMatchObject({ ok: false, reason: "network" });
    expect(JSON.stringify([t, n])).not.toContain("test-key");
  });

  it("treats an empty or unreadable body as a failure", async () => {
    const empty = await generatePlatformText({ task: "outreach_scoring", prompt: "p", env, fetchImpl: vi.fn().mockResolvedValue(okBody("  ")) });
    expect(empty).toMatchObject({ ok: false, reason: "empty" });
    const bad = await generatePlatformText({
      task: "outreach_scoring",
      prompt: "p",
      env,
      fetchImpl: vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    });
    expect(bad).toMatchObject({ ok: false, reason: "empty" });
  });
});
