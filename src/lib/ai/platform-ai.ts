// One small gateway for PLATFORM-level (EduCore staff) AI calls: outreach drafting today, the sales
// assistant later. It deliberately reuses the existing Gemini URL/header helpers instead of adding a
// second provider client, and it adds only what those call sites lacked:
//   - a kill switch (global, or per task) that needs no deploy to change a code path, only an env var;
//   - a hard cap on output tokens, so a prompt change cannot silently make calls expensive;
//   - a request timeout;
//   - token usage returned to the caller so it can be audit-logged.
//
// Not covered here, on purpose: school-facing AI (report-card comments, schemes of work, parent bot).
// Those keep their own paths and are not touched by this module.
//
// Env vars (all optional):
//   GEMINI_API_KEY                  required for any call (existing variable)
//   PLATFORM_AI_DISABLED            "true" or "1" turns every call off
//   PLATFORM_AI_DISABLED_TASKS      comma-separated task names to turn off, e.g. "outreach_scoring"
//   PLATFORM_AI_MAX_OUTPUT_TOKENS   upper bound on any call's output tokens (default 2048)
//
// A DB-backed switch editable from the admin UI is a later step; it needs a migration.

import { GEMINI_REPORT_CARD_MODEL, geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";

export type PlatformAiTask = "outreach_scoring" | "outreach_contact_lookup";

export type AiUsage = { promptTokens: number; outputTokens: number; totalTokens: number };

export type PlatformAiFailureReason = "disabled" | "not_configured" | "timeout" | "http" | "network" | "empty";

export type PlatformAiResult =
  | { ok: true; text: string; usage: AiUsage | null; model: string }
  | { ok: false; reason: PlatformAiFailureReason; error: string };

type Env = Record<string, string | undefined>;

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const MIN_OUTPUT_TOKENS = 64;
const DEFAULT_TIMEOUT_MS = 20_000;

function isTruthyFlag(v: string | undefined): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "true" || s === "1";
}

/** Is this task switched off by env? Returns the reason text when it is. */
export function aiDisabledReason(task: PlatformAiTask, env: Env = process.env): string | null {
  if (isTruthyFlag(env.PLATFORM_AI_DISABLED)) return "AI is switched off (PLATFORM_AI_DISABLED).";
  const off = (env.PLATFORM_AI_DISABLED_TASKS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (off.includes(task)) return `AI for "${task}" is switched off (PLATFORM_AI_DISABLED_TASKS).`;
  return null;
}

/** Clamp a requested output budget into [64, cap]. The cap comes from env and can only lower the ceiling. */
export function clampMaxOutputTokens(requested: number, env: Env = process.env): number {
  const capRaw = Number(env.PLATFORM_AI_MAX_OUTPUT_TOKENS);
  const cap = Number.isFinite(capRaw) && capRaw >= MIN_OUTPUT_TOKENS ? Math.floor(capRaw) : DEFAULT_MAX_OUTPUT_TOKENS;
  const req = Number.isFinite(requested) ? Math.floor(requested) : cap;
  return Math.min(Math.max(req, MIN_OUTPUT_TOKENS), cap);
}

/** Parse a millisecond budget from env text, falling back to a default and clamping into [min, max]. */
export function parseBudgetMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  return Math.min(Math.max(v, min), max);
}

type GeminiBody = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

export function extractUsage(body: GeminiBody): AiUsage | null {
  const u = body.usageMetadata;
  if (!u) return null;
  const promptTokens = u.promptTokenCount ?? 0;
  const outputTokens = u.candidatesTokenCount ?? 0;
  return { promptTokens, outputTokens, totalTokens: u.totalTokenCount ?? promptTokens + outputTokens };
}

export type GeneratePlatformTextInput = {
  task: PlatformAiTask;
  prompt: string;
  /** Ask the model for a JSON object (responseMimeType). Ignored when webSearch is on: Gemini does not
   *  allow structured-output mode together with the search tool, so callers must parse JSON from text. */
  json?: boolean;
  /** Let the model use Google Search grounding (used to LOCATE public pages; callers must verify claims). */
  webSearch?: boolean;
  temperature?: number;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Test seams. Production callers leave these unset. */
  env?: Env;
  fetchImpl?: typeof fetch;
};

export async function generatePlatformText(input: GeneratePlatformTextInput): Promise<PlatformAiResult> {
  const env = input.env ?? process.env;

  const off = aiDisabledReason(input.task, env);
  if (off) return { ok: false, reason: "disabled", error: off };

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "not_configured", error: "AI isn't configured: GEMINI_API_KEY is missing from the server environment." };
  }

  const model = input.model ?? GEMINI_REPORT_CARD_MODEL;
  const doFetch = input.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(geminiGenerateContentUrl(apiKey, model), {
      method: "POST",
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: input.temperature ?? 0.4,
          maxOutputTokens: clampMaxOutputTokens(input.maxOutputTokens ?? 1024, env),
          ...(input.json && !input.webSearch ? { responseMimeType: "application/json" } : {}),
        },
        ...(input.webSearch ? { tools: [{ google_search: {} }] } : {}),
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    // Never echo the raw error: it can contain the request URL. Status/reason only.
    return timedOut
      ? { ok: false, reason: "timeout", error: "The AI request timed out." }
      : { ok: false, reason: "network", error: "The AI request failed to reach the provider." };
  }

  if (!res.ok) return { ok: false, reason: "http", error: `The AI provider responded ${res.status}.` };

  let body: GeminiBody;
  try {
    body = (await res.json()) as GeminiBody;
  } catch {
    return { ok: false, reason: "empty", error: "The AI provider returned an unreadable response." };
  }

  // Grounded (web search) answers can arrive split across several parts; join them all.
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) return { ok: false, reason: "empty", error: "The AI provider returned no text." };

  return { ok: true, text, usage: extractUsage(body), model };
}

/** Add two usage records, treating a missing one as zero. */
export function addUsage(a: AiUsage, b: AiUsage | null): AiUsage {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
