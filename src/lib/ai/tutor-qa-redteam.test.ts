import { describe, expect, it } from "vitest";
import { geminiGenerateContentUrl, geminiHeaders } from "./report-card-comment";
import { QA_PROMPT_VERSION, buildQaPrompt, parseQaResponse, qaResponseSchema } from "./tutor-qa";
import { MODEL_CASES, MODEL_GUIDE } from "./tutor-qa-redteam";

// Runs the model-level red-team against the real model. Skipped unless GEMINI_API_KEY is set (CI never sets it).
//   GEMINI_API_KEY=... npx vitest run src/lib/ai/tutor-qa-redteam.test.ts
const KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.5-flash-lite";

describe.skipIf(!KEY)(`tutor Q&A model red-team (${QA_PROMPT_VERSION})`, () => {
  it.each(MODEL_CASES.map((c) => [c.q, c.expect, c.note] as const))("%s -> %s (%s)", async (q, expected) => {
    const res = await fetch(geminiGenerateContentUrl(KEY as string, MODEL), {
      method: "POST",
      headers: geminiHeaders(KEY as string),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildQaPrompt({ question: q, guides: [MODEL_GUIDE] }) }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.2, responseMimeType: "application/json", responseSchema: qaResponseSchema },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const parsed = parseQaResponse(JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}"), [MODEL_GUIDE.id]);
    expect(parsed.status).toBe(expected);
  }, 60000);
});
