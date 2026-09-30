import { describe, expect, it } from "vitest";
import {
  buildSchemeOfWorkPrompt,
  buildCurriculumContext,
  buildEntryAssistPrompt,
  checkSchemeOfWorkQuality,
  parseSchemeOfWorkResponse,
  parseEntryAssistResponse,
  weeksGenerated,
  chunkWeekRanges,
  summarizePreviousWeeks,
  MAX_ENTRIES_PER_GENERATION_CALL,
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

  it("grounds the prompt in curriculumContext when supplied, instead of the plain framework line", () => {
    const prompt = buildSchemeOfWorkPrompt({
      ...base,
      curriculumContext: "- Numbers\n  - Place value: Learning outcomes: Learners can...",
    });
    expect(prompt).toContain("This school has recorded its own curriculum content (CBC) for Biology");
    expect(prompt).toContain("Ground the scheme's topics, learning outcomes and assessment guidance in this recorded content");
    expect(prompt).toContain("- Numbers\n  - Place value");
    expect(prompt).not.toContain("Curriculum framework: CBC. Align topics");
  });

  it("falls back to the plain framework line when curriculumContext is null/omitted", () => {
    const prompt = buildSchemeOfWorkPrompt({ ...base, curriculumContext: null });
    expect(prompt).toContain("Curriculum framework: CBC. Align topics");
    expect(prompt).not.toContain("This school has recorded its own curriculum content");
  });

  it("covers the full scheme by default (no weekRange)", () => {
    const prompt = buildSchemeOfWorkPrompt(base);
    expect(prompt).toContain("exactly 13 weeks, numbered 1 to 13");
    expect(prompt).not.toContain("You are generating ONLY weeks");
  });

  it("scopes to a week range and flags it as a chunk when weekRange is given", () => {
    const prompt = buildSchemeOfWorkPrompt({ ...base, weekRange: { startWeek: 6, endWeek: 10 } });
    expect(prompt).toContain("You are generating ONLY weeks 6 to 10");
    expect(prompt).toContain("exactly 5 weeks, numbered 6 to 10");
    expect(prompt).not.toContain("You are generating ONLY weeks 1 to 13");
  });

  it("does not add chunk framing when weekRange covers the whole scheme", () => {
    const prompt = buildSchemeOfWorkPrompt({ ...base, weekRange: { startWeek: 1, endWeek: 13 } });
    expect(prompt).not.toContain("You are generating ONLY weeks");
  });

  it("includes previousWeeksSummary as topics to avoid repeating", () => {
    const prompt = buildSchemeOfWorkPrompt({
      ...base,
      weekRange: { startWeek: 6, endWeek: 10 },
      previousWeeksSummary: "Week 1: Cell structure\nWeek 2: Cell division",
    });
    expect(prompt).toContain("do not repeat these");
    expect(prompt).toContain("Week 1: Cell structure");
  });
});

describe("chunkWeekRanges", () => {
  it("returns a single range covering the whole scheme when it fits in one call", () => {
    // 3 weeks x 4 lessons/week = 12 entries, within MAX_ENTRIES_PER_GENERATION_CALL (16)
    expect(chunkWeekRanges(3, 4)).toEqual([{ startWeek: 1, endWeek: 3 }]);
  });

  it("splits a large scheme into multiple bounded ranges", () => {
    // 20 weeks x 4 lessons/week -- weeksPerChunk = floor(16/4) = 4
    expect(chunkWeekRanges(20, 4)).toEqual([
      { startWeek: 1, endWeek: 4 },
      { startWeek: 5, endWeek: 8 },
      { startWeek: 9, endWeek: 12 },
      { startWeek: 13, endWeek: 16 },
      { startWeek: 17, endWeek: 20 },
    ]);
  });

  it("never produces a chunk smaller than 1 week even with a high lessons_per_week", () => {
    const ranges = chunkWeekRanges(3, 20);
    expect(ranges).toEqual([{ startWeek: 1, endWeek: 1 }, { startWeek: 2, endWeek: 2 }, { startWeek: 3, endWeek: 3 }]);
  });

  it("covers every week exactly once with no gaps or overlaps", () => {
    const ranges = chunkWeekRanges(37, 5);
    const covered = new Set<number>();
    for (const r of ranges) {
      for (let w = r.startWeek; w <= r.endWeek; w++) covered.add(w);
    }
    expect(covered.size).toBe(37);
    for (const r of ranges) {
      expect((r.endWeek - r.startWeek + 1) * 5).toBeLessThanOrEqual(MAX_ENTRIES_PER_GENERATION_CALL);
    }
  });
});

describe("summarizePreviousWeeks", () => {
  it("returns null for no weeks", () => {
    expect(summarizePreviousWeeks([])).toBeNull();
  });

  it("summarizes topics (with subtopic when present), ordered by week", () => {
    const summary = summarizePreviousWeeks([
      { week: 2, entries: [{ lesson: 1, topic: "Cell division", subtopic: "Mitosis", learning_outcomes: "", content: "", activities: "", methods: "", resources: "", assessment: "" }] },
      { week: 1, entries: [{ lesson: 1, topic: "Cell structure", subtopic: "", learning_outcomes: "", content: "", activities: "", methods: "", resources: "", assessment: "" }] },
    ]);
    expect(summary).toBe("Week 1: Cell structure\nWeek 2: Cell division (Mitosis)");
  });
});

describe("buildCurriculumContext", () => {
  it("returns null when there are no strands at all", () => {
    expect(buildCurriculumContext([])).toBeNull();
  });

  it("returns null when every sub-strand is empty", () => {
    const result = buildCurriculumContext([
      { name: "Numbers", sub_strands: [{ name: "Place value", learning_outcomes: null, key_inquiry_questions: null, rubric_text: null, content_source: "school_authored" }] },
    ]);
    expect(result).toBeNull();
  });

  it("excludes content_source='draft' rows even when they have text", () => {
    const result = buildCurriculumContext([
      {
        name: "Numbers",
        sub_strands: [
          { name: "Place value", learning_outcomes: "Learners can read and write numbers.", key_inquiry_questions: null, rubric_text: null, content_source: "draft" },
        ],
      },
    ]);
    expect(result).toBeNull();
  });

  it("includes school_authored and kicd_licensed rows and counts them", () => {
    const result = buildCurriculumContext([
      {
        name: "Numbers",
        sub_strands: [
          { name: "Place value", learning_outcomes: "Learners can read and write numbers up to 1000.", key_inquiry_questions: "Why do the digits in 123 mean different things?", rubric_text: null, content_source: "kicd_licensed" },
          { name: "Fractions", learning_outcomes: null, key_inquiry_questions: null, rubric_text: "EE: correctly compares and orders fractions.", content_source: "school_authored" },
        ],
      },
    ]);
    expect(result).not.toBeNull();
    expect(result?.itemCount).toBe(2);
    expect(result?.text).toContain("- Numbers");
    expect(result?.text).toContain("- Place value");
    expect(result?.text).toContain("Learning outcomes: Learners can read and write numbers up to 1000.");
    expect(result?.text).toContain("Key inquiry questions: Why do the digits in 123 mean different things?");
    expect(result?.text).toContain("- Fractions");
    expect(result?.text).toContain("Assessment guidance: EE: correctly compares and orders fractions.");
  });

  it("skips a strand entirely when none of its sub-strands are usable, but still includes other strands", () => {
    const result = buildCurriculumContext([
      { name: "Empty Strand", sub_strands: [{ name: "Nothing here", learning_outcomes: null, key_inquiry_questions: null, rubric_text: null, content_source: "school_authored" }] },
      { name: "Numbers", sub_strands: [{ name: "Place value", learning_outcomes: "Some outcome.", key_inquiry_questions: null, rubric_text: null, content_source: "school_authored" }] },
    ]);
    expect(result?.itemCount).toBe(1);
    expect(result?.text).not.toContain("Empty Strand");
    expect(result?.text).toContain("Numbers");
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

describe("buildEntryAssistPrompt", () => {
  const baseEntry = {
    topic: "Photosynthesis",
    subtopic: "Light reactions",
    learning_outcomes: "Explain the light-dependent reactions.",
    content: "Overview of chlorophyll and electron transport.",
    activities: "Diagram labelling in pairs.",
    teaching_methods: "Lecture and discussion.",
    resources: "Textbook, chart.",
    assessment_methods: "Oral questions.",
  };
  const base = {
    subjectName: "Biology",
    className: "Form 2",
    streamName: "Form 2 East",
    termName: "Term 1",
    academicYearName: "2026",
    entry: baseEntry,
  };

  it("includes the mode-specific instruction for each mode", () => {
    expect(buildEntryAssistPrompt({ ...base, mode: "improve" })).toContain("Improve and tighten this lesson entry");
    expect(buildEntryAssistPrompt({ ...base, mode: "expand" })).toContain("Expand this lesson entry");
    expect(buildEntryAssistPrompt({ ...base, mode: "generate_activities" })).toContain("Only replace the 'activities' field");
  });

  it("includes the current entry's field values", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve" });
    expect(prompt).toContain("Photosynthesis");
    expect(prompt).toContain("Light reactions");
    expect(prompt).toContain("Explain the light-dependent reactions.");
    expect(prompt).toContain("Oral questions.");
  });

  it("includes subject/class/stream/term context", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve" });
    expect(prompt).toContain("Biology");
    expect(prompt).toContain("Form 2 (Form 2 East)");
    expect(prompt).toContain("Term 1");
  });

  it("grounds in curriculumContext when supplied", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve", curriculumContext: "- Cell Biology\n  - Photosynthesis" });
    expect(prompt).toContain("recorded its own curriculum content");
    expect(prompt).toContain("- Cell Biology");
  });

  it("omits curriculum grounding when curriculumContext is null", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve", curriculumContext: null });
    expect(prompt).not.toContain("recorded its own curriculum content");
  });

  it("tells the model not to invent official curriculum codes", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve" });
    expect(prompt).toContain("Do not invent specific official curriculum codes");
  });

  it("shows '(none given)' for empty entry fields instead of a blank line", () => {
    const prompt = buildEntryAssistPrompt({ ...base, mode: "improve", entry: { ...baseEntry, subtopic: "", content: "" } });
    expect(prompt).toContain("Sub-topic: (none given)");
    expect(prompt).toContain("Content: (none given)");
  });
});

describe("parseEntryAssistResponse", () => {
  const wellFormed = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                topic: "Photosynthesis",
                subtopic: "Light reactions",
                learning_outcomes: "Explain the light-dependent reactions.",
                content: "Overview of chlorophyll and electron transport.",
                activities: "Diagram labelling in pairs; simulation.",
                teaching_methods: "Lecture and discussion.",
                resources: "Textbook, chart.",
                assessment_methods: "Oral questions.",
              }),
            },
          ],
        },
      },
    ],
  };

  it("parses a well-formed response into a suggestion", () => {
    const result = parseEntryAssistResponse(wellFormed);
    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.topic).toBe("Photosynthesis");
      expect(result.suggestion.activities).toBe("Diagram labelling in pairs; simulation.");
    }
  });

  it("errors when there is no text at all", () => {
    expect(parseEntryAssistResponse({})).toEqual({ error: "The AI returned no content." });
    expect(parseEntryAssistResponse(null)).toEqual({ error: "The AI returned no content." });
  });

  it("errors when the text is not valid JSON", () => {
    const bad = { candidates: [{ content: { parts: [{ text: "not json" }] } }] };
    expect(parseEntryAssistResponse(bad)).toEqual({ error: "The AI response wasn't valid JSON." });
  });

  it("errors when the response is not an object", () => {
    const bad = { candidates: [{ content: { parts: [{ text: JSON.stringify("just a string") }] } }] };
    expect(parseEntryAssistResponse(bad)).toEqual({ error: "The AI response had an unexpected structure." });
  });

  it("errors when topic is missing", () => {
    const bad = { candidates: [{ content: { parts: [{ text: JSON.stringify({ activities: "Something" }) }] } }] };
    expect(parseEntryAssistResponse(bad)).toEqual({ error: "The AI response was missing a topic." });
  });

  it("defaults missing optional fields to empty strings rather than throwing", () => {
    const minimal = { candidates: [{ content: { parts: [{ text: JSON.stringify({ topic: "Photosynthesis" }) }] } }] };
    const result = parseEntryAssistResponse(minimal);
    expect("suggestion" in result).toBe(true);
    if ("suggestion" in result) {
      expect(result.suggestion.subtopic).toBe("");
      expect(result.suggestion.assessment_methods).toBe("");
    }
  });
});
