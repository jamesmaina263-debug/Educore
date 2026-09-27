import { describe, it, expect } from "vitest";
import {
  MAX_DOCUMENT_CHARS,
  truncateDocumentText,
  buildCurriculumExtractionPrompt,
  parseCurriculumExtractionResponse,
  findMatchingStrandId,
} from "./curriculum-extraction";

describe("truncateDocumentText", () => {
  it("returns short text unchanged and reports no truncation", () => {
    const result = truncateDocumentText("hello world");
    expect(result).toEqual({ text: "hello world", truncated: false });
  });

  it("caps text at MAX_DOCUMENT_CHARS and reports truncation", () => {
    const long = "a".repeat(MAX_DOCUMENT_CHARS + 500);
    const result = truncateDocumentText(long);
    expect(result.text.length).toBe(MAX_DOCUMENT_CHARS);
    expect(result.truncated).toBe(true);
  });
});

describe("buildCurriculumExtractionPrompt", () => {
  it("includes the subject name and the document text verbatim", () => {
    const prompt = buildCurriculumExtractionPrompt("Mathematics", "Strand: Numbers\nSub-strand: Whole Numbers");
    expect(prompt).toContain("Mathematics");
    expect(prompt).toContain("Strand: Numbers\nSub-strand: Whole Numbers");
  });

  it("instructs the model not to invent content beyond the document", () => {
    const prompt = buildCurriculumExtractionPrompt("English", "some text");
    expect(prompt).toContain("Do not invent strands, sub-strands, outcomes, or questions");
  });
});

describe("parseCurriculumExtractionResponse", () => {
  function withText(text: string) {
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }

  it("errors when there is no content at all", () => {
    expect(parseCurriculumExtractionResponse({})).toEqual({ error: "The AI returned no content." });
  });

  it("errors on invalid JSON", () => {
    expect(parseCurriculumExtractionResponse(withText("not json"))).toEqual({ error: "The AI response wasn't valid JSON." });
  });

  it("errors when the response has no strands array", () => {
    expect(parseCurriculumExtractionResponse(withText(JSON.stringify({ foo: "bar" })))).toEqual({
      error: "The AI response had an unexpected structure.",
    });
  });

  it("errors when every strand has no usable sub-strands", () => {
    const raw = { strands: [{ name: "Numbers", sub_strands: [] }] };
    expect(parseCurriculumExtractionResponse(withText(JSON.stringify(raw)))).toEqual({
      error: "No usable curriculum structure was found in this document.",
    });
  });

  it("parses a well-formed response, defaulting missing text fields to empty strings", () => {
    const raw = {
      strands: [
        {
          name: "Numbers",
          sub_strands: [
            { name: "Whole Numbers", learning_outcomes: "Count to 100", confidence: "high" },
            { name: "Fractions", confidence: "low" },
          ],
        },
      ],
    };
    const result = parseCurriculumExtractionResponse(withText(JSON.stringify(raw)));
    expect(result).toEqual({
      result: {
        strands: [
          {
            name: "Numbers",
            sub_strands: [
              { name: "Whole Numbers", learning_outcomes: "Count to 100", key_inquiry_questions: "", rubric_text: "", confidence: "high" },
              { name: "Fractions", learning_outcomes: "", key_inquiry_questions: "", rubric_text: "", confidence: "low" },
            ],
          },
        ],
      },
    });
  });

  it("drops a strand with no name, and a sub-strand with no name, rather than saving an empty row", () => {
    const raw = {
      strands: [
        { name: "", sub_strands: [{ name: "Orphan", confidence: "high" }] },
        {
          name: "Numbers",
          sub_strands: [
            { name: "", confidence: "high" },
            { name: "Whole Numbers", confidence: "high" },
          ],
        },
      ],
    };
    const result = parseCurriculumExtractionResponse(withText(JSON.stringify(raw)));
    expect(result).toEqual({
      result: {
        strands: [
          {
            name: "Numbers",
            sub_strands: [{ name: "Whole Numbers", learning_outcomes: "", key_inquiry_questions: "", rubric_text: "", confidence: "high" }],
          },
        ],
      },
    });
  });

  it("treats any confidence value other than the literal 'low' as 'high'", () => {
    const raw = { strands: [{ name: "Numbers", sub_strands: [{ name: "Whole Numbers", confidence: "maybe" }] }] };
    const result = parseCurriculumExtractionResponse(withText(JSON.stringify(raw)));
    expect(result).toEqual({
      result: { strands: [{ name: "Numbers", sub_strands: [{ name: "Whole Numbers", learning_outcomes: "", key_inquiry_questions: "", rubric_text: "", confidence: "high" }] }] },
    });
  });
});

describe("findMatchingStrandId", () => {
  const existing = [
    { id: "s1", name: "Numbers" },
    { id: "s2", name: "  Geometry  " },
  ];

  it("matches case- and whitespace-insensitively", () => {
    expect(findMatchingStrandId(existing, "numbers")).toBe("s1");
    expect(findMatchingStrandId(existing, "GEOMETRY")).toBe("s2");
  });

  it("returns null when there is no match", () => {
    expect(findMatchingStrandId(existing, "Algebra")).toBeNull();
  });
});
