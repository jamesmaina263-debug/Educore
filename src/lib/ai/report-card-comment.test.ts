import { describe, expect, it } from "vitest";
import {
  buildReportCardCommentPrompt,
  formatMarkLines,
  geminiGenerateContentUrl,
  parseGeminiCommentResponse,
} from "./report-card-comment";

describe("formatMarkLines", () => {
  it("formats a scored subject as 'Subject: score (band)'", () => {
    expect(formatMarkLines([{ subject_name: "Mathematics", raw_score: 78, band_label: "B+" }])).toBe(
      "Mathematics: 78 (B+)",
    );
  });

  it("falls back to 'Subject: band' when there is no numeric score", () => {
    expect(formatMarkLines([{ subject_name: "Music", raw_score: null, band_label: "Exempt" }])).toBe(
      "Music: Exempt",
    );
  });

  it("joins multiple subjects on separate lines, in the given order", () => {
    const lines = formatMarkLines([
      { subject_name: "English", raw_score: 60, band_label: "C+" },
      { subject_name: "Kiswahili", raw_score: 55, band_label: "C" },
    ]);
    expect(lines).toBe("English: 60 (C+)\nKiswahili: 55 (C)");
  });

  it("returns an empty string for no marks", () => {
    expect(formatMarkLines([])).toBe("");
  });
});

describe("buildReportCardCommentPrompt", () => {
  it("includes the student name and formatted mark lines", () => {
    const prompt = buildReportCardCommentPrompt("Amina Hassan", [
      { subject_name: "Mathematics", raw_score: 78, band_label: "B+" },
    ]);
    expect(prompt).toContain("Student: Amina Hassan");
    expect(prompt).toContain("Mathematics: 78 (B+)");
  });

  it("tells the model to avoid numeric scores and stick to 2-3 sentences", () => {
    const prompt = buildReportCardCommentPrompt("Amina Hassan", []);
    expect(prompt).toContain("2-3 sentence");
    expect(prompt).toContain("Do not mention numeric scores directly");
  });

  it("falls back to a 'no results' line when there are no marks", () => {
    const prompt = buildReportCardCommentPrompt("Amina Hassan", []);
    expect(prompt).toContain("No subject results recorded.");
  });
});

describe("geminiGenerateContentUrl", () => {
  it("builds the current gemini-3.5-flash-lite generateContent URL with the key as a query param", () => {
    expect(geminiGenerateContentUrl("test-key")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=test-key",
    );
  });
});

describe("parseGeminiCommentResponse", () => {
  it("extracts and trims the comment text from a well-formed response", () => {
    const result = parseGeminiCommentResponse({
      candidates: [{ content: { parts: [{ text: "  A hardworking student.  " }] } }],
    });
    expect(result).toEqual({ comment: "A hardworking student." });
  });

  it("returns an error when candidates is missing", () => {
    expect(parseGeminiCommentResponse({})).toEqual({ error: "AI drafting returned no text." });
  });

  it("returns an error when the text is empty or whitespace-only", () => {
    const result = parseGeminiCommentResponse({
      candidates: [{ content: { parts: [{ text: "   " }] } }],
    });
    expect(result).toEqual({ error: "AI drafting returned no text." });
  });

  it("returns an error for a completely malformed response", () => {
    expect(parseGeminiCommentResponse(null)).toEqual({ error: "AI drafting returned no text." });
    expect(parseGeminiCommentResponse("unexpected string")).toEqual({ error: "AI drafting returned no text." });
  });
});
