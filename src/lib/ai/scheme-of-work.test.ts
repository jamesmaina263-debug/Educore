import { describe, expect, it } from "vitest";
import {
  buildSchemeOfWorkPrompt,
  checkSchemeOfWorkQuality,
  parseSchemeOfWorkResponse,
  weeksGenerated,
  type SchemeOfWorkDraft,
} from "./scheme-of-work";

describe("buildSchemeOfWorkPrompt", () => {
  const base = {
    subjectName: "Biology",
    className: "Form 2",
    streamName: "Form 2 East",
    termName: "Term 1",
    academicYearName: "2026",
    totalWeeks: 13,
    lessonsPerWeek: 4,
    curriculumFramework: "CBC" as string | null,
  };

  it("includes the subject, class, stream, term and week/lesson counts", () => {
    const prompt = buildSchemeOfWorkPrompt(base);
    expect(prompt).toContain("Biology");
    expect(prompt).toContain("Form 2 (Form 2 East)");
    expect(prompt).toContain("Term 1");
    expect(prompt).toContain("exactly 13 weeks");
    expect(prompt).toContain("exactly 4 lesson entries");
  });

  it("omits the stream parenthetical when there is no stream", () => {
    const prompt = buildSchemeOfWorkPrompt({ ...base, streamName: null });
    expect(prompt).toContain("Class: Form 2\n");
    expect(prompt).not.toContain("(Form 2 East)");
  });

  it("tells the model not to invent official curriculum codes", () => {
    const prompt = buildSchemeOfWorkPrompt(base);
    expect(prompt).toContain("Do not invent specific official curriculum codes");
  });

  it("says no framework was supplied when curriculumFramework is null", () => {
    const prompt = buildSchemeOfWorkPrompt({ ...base, curriculumFramework: null });
    expect(prompt).toContain("No specific curriculum framework was supplied");
  });
});

const wellFormedResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: JSON.stringify({
              weeks: [
                {
                  week: 1,
                  entries: [
                    {
                      lesson: 1,
                      topic: "Introduction to Cells",
                      subtopic: "Cell theory",
                      learning_outcomes: "Explain the cell theory",
                      content: "Cell theory basics",
                      activities: "Group discussion",
                      methods: "Lecture",
                      resources: "Textbook",
                      assessment: "Oral questions",
                    },
                  ],
                },
              ],
            }),
          },
        ],
      },
    },
  ],
};

describe("parseSchemeOfWorkResponse", () => {
  it("parses a well-formed response into a draft", () => {
    const result = parseSchemeOfWorkResponse(wellFormedResponse);
    expect("draft" in result).toBe(true);
    if ("draft" in result) {
      expect(result.draft.weeks).toHaveLength(1);
      expect(result.draft.weeks[0].entries[0].topic).toBe("Introduction to Cells");
    }
  });

  it("errors when there is no text at all", () => {
    expect(parseSchemeOfWorkResponse({})).toEqual({ error: "The AI returned no content." });
    expect(parseSchemeOfWorkResponse(null)).toEqual({ error: "The AI returned no content." });
  });

  it("errors when the text is not valid JSON", () => {
    const bad = { candidates: [{ content: { parts: [{ text: "not json" }] } }] };
    expect(parseSchemeOfWorkResponse(bad)).toEqual({ error: "The AI response wasn't valid JSON." });
  });

  it("errors when 'weeks' is missing", () => {
    const bad = { candidates: [{ content: { parts: [{ text: JSON.stringify({ notWeeks: [] }) }] } }] };
    const result = parseSchemeOfWorkResponse(bad);
    expect("error" in result).toBe(true);
  });

  it("errors when weeks is an empty array", () => {
    const bad = { candidates: [{ content: { parts: [{ text: JSON.stringify({ weeks: [] }) }] } }] };
    expect(parseSchemeOfWorkResponse(bad)).toEqual({ error: "The AI returned no weeks." });
  });

  it("errors when a week has no entries", () => {
    const bad = {
      candidates: [{ content: { parts: [{ text: JSON.stringify({ weeks: [{ week: 1, entries: [] }] }) }] } }],
    };
    const result = parseSchemeOfWorkResponse(bad);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("Week 1");
  });

  it("errors when an entry is missing a topic", () => {
    const bad = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ weeks: [{ week: 1, entries: [{ lesson: 1, topic: "" }] }] }) }],
          },
        },
      ],
    };
    const result = parseSchemeOfWorkResponse(bad);
    expect("error" in result).toBe(true);
  });

  it("defaults missing optional string fields to empty strings rather than failing", () => {
    const minimal = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ weeks: [{ week: 1, entries: [{ lesson: 1, topic: "Cells" }] }] }) }],
          },
        },
      ],
    };
    const result = parseSchemeOfWorkResponse(minimal);
    expect("draft" in result).toBe(true);
    if ("draft" in result) {
      expect(result.draft.weeks[0].entries[0].subtopic).toBe("");
      expect(result.draft.weeks[0].entries[0].assessment).toBe("");
    }
  });
});

describe("weeksGenerated", () => {
  it("counts distinct week numbers", () => {
    const draft: SchemeOfWorkDraft = {
      weeks: [
        { week: 1, entries: [] },
        { week: 2, entries: [] },
        { week: 2, entries: [] },
      ],
    };
    expect(weeksGenerated(draft)).toBe(2);
  });
});

describe("checkSchemeOfWorkQuality", () => {
  const entry = (overrides: Partial<SchemeOfWorkDraft["weeks"][number]["entries"][number]> = {}) => ({
    lesson: 1,
    topic: "Topic",
    subtopic: "",
    learning_outcomes: "Outcome",
    content: "",
    activities: "Activity",
    methods: "",
    resources: "",
    assessment: "Assessment",
    ...overrides,
  });

  it("returns no warnings for a clean, complete draft", () => {
    const draft: SchemeOfWorkDraft = {
      weeks: [
        { week: 1, entries: [entry({ topic: "A", learning_outcomes: "outcome A" })] },
        { week: 2, entries: [entry({ topic: "B", learning_outcomes: "outcome B" })] },
      ],
    };
    expect(checkSchemeOfWorkQuality(draft, 2, 1)).toEqual([]);
  });

  it("flags a missing week", () => {
    const draft: SchemeOfWorkDraft = { weeks: [{ week: 1, entries: [entry()] }] };
    const warnings = checkSchemeOfWorkQuality(draft, 2, 1);
    expect(warnings.some((w) => w.includes("Missing week(s): 2"))).toBe(true);
  });

  it("flags a week with the wrong number of lessons", () => {
    const draft: SchemeOfWorkDraft = { weeks: [{ week: 1, entries: [entry()] }] };
    const warnings = checkSchemeOfWorkQuality(draft, 1, 3);
    expect(warnings.some((w) => w.includes("expected 3"))).toBe(true);
  });

  it("flags duplicate topics across weeks", () => {
    const draft: SchemeOfWorkDraft = {
      weeks: [
        { week: 1, entries: [entry({ topic: "Photosynthesis" })] },
        { week: 2, entries: [entry({ topic: "Photosynthesis" })] },
      ],
    };
    const warnings = checkSchemeOfWorkQuality(draft, 2, 1);
    expect(warnings.some((w) => w.includes("same topic"))).toBe(true);
  });

  it("flags entries missing outcomes, activities or assessment", () => {
    const draft: SchemeOfWorkDraft = {
      weeks: [{ week: 1, entries: [entry({ learning_outcomes: "", activities: "", assessment: "" })] }],
    };
    const warnings = checkSchemeOfWorkQuality(draft, 1, 1);
    expect(warnings.some((w) => w.includes("no learning outcomes"))).toBe(true);
    expect(warnings.some((w) => w.includes("no learning activities"))).toBe(true);
    expect(warnings.some((w) => w.includes("no assessment method"))).toBe(true);
  });
});
