import { geminiGenerateContentUrl, geminiHeaders } from "@/lib/ai/report-card-comment";

// Pure helpers for the curriculum-PDF extraction pipeline (Phase 2A of the
// curriculum-grounding investigation). Split out of the server action the
// same way scheme-of-work.ts is split out of academics/scheme-of-work/
// actions.ts -- prompt-building and response parsing are unit tested here
// without a live Supabase connection, network call, or PDF file.
//
// What this file deliberately does NOT do: write anything to
// curriculum_strands/curriculum_sub_strands, decide content_source, or call
// Gemini. Those all happen in the server action, which uses these pure
// functions as building blocks. Every extracted item here starts life as a
// candidate for a content_source='draft' row -- this module has no
// awareness of 'school_authored'/'kicd_licensed' at all, so it cannot be the
// place a licensing mistake gets made.

export const CURRICULUM_EXTRACTION_PROMPT_VERSION = "curriculum_extraction_prompt_v1";

// Same model family as report-card comments and scheme-of-work generation
// (see report-card-comment.ts / scheme-of-work.ts) -- reusing rather than
// introducing a third AI integration.
export const GEMINI_CURRICULUM_EXTRACTION_MODEL = "gemini-3.5-flash-lite";

// A generous but bounded cap on how much extracted PDF text goes into a
// single prompt. Keeps token usage/cost predictable and avoids ever sending
// an enormous document in one call; a document this long is also well past
// what one subject's curriculum content should be. Chunking a very large
// document across multiple calls (the way generateSchemeWithAI chunks large
// schemes) is left as future work if this limit turns out to bite in
// practice -- flagged in the PR description, not silently worked around.
export const MAX_DOCUMENT_CHARS = 60000;

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/** Caps document text at MAX_DOCUMENT_CHARS, reporting whether it cut anything
 *  off so the caller can warn the uploader rather than silently dropping the
 *  tail of their document. */
export function truncateDocumentText(text: string): TruncateResult {
  if (text.length <= MAX_DOCUMENT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DOCUMENT_CHARS), truncated: true };
}

export type ExtractionConfidence = "high" | "low";

export interface ExtractedSubStrand {
  name: string;
  learning_outcomes: string;
  key_inquiry_questions: string;
  rubric_text: string;
  /** "low" flags anything the model wasn't confident it read correctly from
   *  the document -- surfaced to the reviewer as a visual warning, never
   *  used to auto-reject or auto-approve anything. */
  confidence: ExtractionConfidence;
}

export interface ExtractedStrand {
  name: string;
  sub_strands: ExtractedSubStrand[];
}

export interface CurriculumExtractionResult {
  strands: ExtractedStrand[];
}

/**
 * Builds the prompt sent to Gemini to extract structured curriculum content
 * from a school's own uploaded document. Deliberately conservative, mirroring
 * the anti-fabrication language already used in buildEntryAssistPrompt/
 * buildSchemeOfWorkPrompt: extract only what the text actually contains,
 * never invent strands/outcomes/questions that aren't there, and flag
 * anything uncertain rather than guessing silently.
 */
export function buildCurriculumExtractionPrompt(
  subjectName: string,
  documentText: string,
  /** "school" (default, unchanged wording) = a school's own uploaded document;
   *  "platform" = an official curriculum document imported by a platform admin. */
  origin: "school" | "platform" = "school",
): string {
  const documentDescription =
    origin === "platform" ? "an official curriculum design document" : "a Kenyan school's own uploaded curriculum document";
  return `You are helping extract structured curriculum content from ${documentDescription} for the subject "${subjectName}".

The document's text (extracted from a PDF; formatting/page breaks may be imperfect) is below, delimited by triple quotes. Read it and identify the curriculum Strands and, within each, the Sub-Strands, exactly as the document itself lays them out.

For each sub-strand, extract (as they appear in the document, not invented):
- Its name.
- Learning outcomes, if stated.
- Key inquiry questions, if stated.
- Any assessment/rubric guidance for it, if stated.

Rules:
- Extract ONLY content that is actually present in the document below. Do not invent strands, sub-strands, outcomes, or questions that aren't there, and do not fill gaps with your own general knowledge of the subject.
- If a sub-strand has a name but no stated learning outcomes/key inquiry questions/rubric guidance, leave those fields as empty strings rather than making something up.
- Set "confidence" to "low" for any sub-strand where the document's wording was unclear, ambiguous, or where you had to infer structure (e.g. an unlabeled list you interpreted as sub-strands) rather than reading it directly off a clear heading. Otherwise use "high".
- If the document contains no identifiable strand/sub-strand structure at all, return an empty strands array -- do not force unrelated text into a fake structure.

Document text:
"""
${documentText}
"""`;
}

export const curriculumExtractionResponseSchema = {
  type: "OBJECT",
  properties: {
    strands: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          sub_strands: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                learning_outcomes: { type: "STRING" },
                key_inquiry_questions: { type: "STRING" },
                rubric_text: { type: "STRING" },
                confidence: { type: "STRING", enum: ["high", "low"] },
              },
              required: ["name", "confidence"],
            },
          },
        },
        required: ["name", "sub_strands"],
      },
    },
  },
  required: ["strands"],
} as const;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type CurriculumExtractionParseResult = { result: CurriculumExtractionResult } | { error: string };

/** Mirrors parseSchemeOfWorkResponse's/parseEntryAssistResponse's rules:
 *  never throws, and a malformed shape is a normal failure to report, never
 *  silently coerced into something that looks valid. A strand with no name,
 *  or a sub-strand with no name, is dropped rather than saved as an empty
 *  row -- there's nothing for a reviewer to review there. */
export function parseCurriculumExtractionResponse(data: unknown): CurriculumExtractionParseResult {
  const text = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })?.candidates?.[0]
    ?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) {
    return { error: "The AI returned no content." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The AI response wasn't valid JSON." };
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>).strands)) {
    return { error: "The AI response had an unexpected structure." };
  }

  const rawStrands = (parsed as { strands: unknown[] }).strands;
  const strands: ExtractedStrand[] = [];

  for (const rawStrand of rawStrands) {
    if (typeof rawStrand !== "object" || rawStrand === null) continue;
    const strandName = asString((rawStrand as Record<string, unknown>).name);
    if (!strandName) continue;

    const rawSubStrands = (rawStrand as Record<string, unknown>).sub_strands;
    const subStrands: ExtractedSubStrand[] = [];
    if (Array.isArray(rawSubStrands)) {
      for (const rawSub of rawSubStrands) {
        if (typeof rawSub !== "object" || rawSub === null) continue;
        const subName = asString((rawSub as Record<string, unknown>).name);
        if (!subName) continue;
        const confidenceRaw = (rawSub as Record<string, unknown>).confidence;
        subStrands.push({
          name: subName,
          learning_outcomes: asString((rawSub as Record<string, unknown>).learning_outcomes),
          key_inquiry_questions: asString((rawSub as Record<string, unknown>).key_inquiry_questions),
          rubric_text: asString((rawSub as Record<string, unknown>).rubric_text),
          confidence: confidenceRaw === "low" ? "low" : "high",
        });
      }
    }

    if (subStrands.length > 0) {
      strands.push({ name: strandName, sub_strands: subStrands });
    }
  }

  if (strands.length === 0) {
    return { error: "No usable curriculum structure was found in this document." };
  }

  return { result: { strands } };
}

/**
 * Case/whitespace-insensitive match of an extracted strand name against this
 * subject's already-recorded strands, so re-uploading/re-extracting a
 * document (or a second document covering overlapping ground) doesn't create
 * duplicate strand rows. Returns the existing strand's id to reuse, or null
 * when this is genuinely a new strand.
 */
export function findMatchingStrandId(existingStrands: { id: string; name: string }[], extractedName: string): string | null {
  const normalized = extractedName.trim().toLowerCase();
  const match = existingStrands.find((s) => s.name.trim().toLowerCase() === normalized);
  return match?.id ?? null;
}

export type CurriculumExtractionRunResult =
  | { result: CurriculumExtractionResult; truncated: boolean }
  | { error: string; failureCategory: string };

/**
 * Sends already-extracted document text to Gemini and returns the parsed
 * structure. Same request shape, timeout and failure categories as the
 * school upload flow (academics/curriculum/actions.ts), packaged for callers
 * that don't need that action's storage/permission handling (the platform
 * KICD import). Never throws; failures come back as { error, failureCategory }
 * with a message that is safe to show to the operator.
 */
export async function runCurriculumExtraction(opts: {
  apiKey: string;
  label: string;
  documentText: string;
  origin: "school" | "platform";
}): Promise<CurriculumExtractionRunResult> {
  const { text, truncated } = truncateDocumentText(opts.documentText);
  let res: Response;
  try {
    res = await fetch(geminiGenerateContentUrl(opts.apiKey, GEMINI_CURRICULUM_EXTRACTION_MODEL), {
      method: "POST",
      headers: geminiHeaders(opts.apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildCurriculumExtractionPrompt(opts.label, text, opts.origin) }] }],
        generationConfig: {
          maxOutputTokens: 8000,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: curriculumExtractionResponseSchema,
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return isTimeout
      ? { error: "Extraction timed out. Please try again.", failureCategory: "timeout" }
      : { error: "Connection interrupted. Please try again.", failureCategory: "network" };
  }
  if (!res.ok) {
    console.error(`runCurriculumExtraction: Gemini returned ${res.status}`);
    if (res.status === 401 || res.status === 403) return { error: "AI extraction is currently unavailable (check the API key).", failureCategory: "auth_config" };
    if (res.status === 429) return { error: "AI extraction is temporarily busy. Please try again shortly.", failureCategory: "rate_limit" };
    return { error: "Something went wrong while extracting. Please try again.", failureCategory: res.status >= 500 ? "ai_unavailable" : "server_error" };
  }
  const parsed = parseCurriculumExtractionResponse(await res.json());
  if ("error" in parsed) {
    const noStructure = parsed.error === "No usable curriculum structure was found in this document.";
    return {
      error: noStructure ? parsed.error : "We couldn't extract curriculum content correctly. Please try again.",
      failureCategory: noStructure ? "no_structure_found" : parsed.error.includes("no content") ? "empty_response" : "malformed_response",
    };
  }
  return { result: parsed.result, truncated };
}
