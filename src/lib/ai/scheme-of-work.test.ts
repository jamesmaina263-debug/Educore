import { describe, expect, it } from "vitest";
import {
  buildSchemeOfWorkPrompt,
  buildCurriculumContext,
  checkSchemeOfWorkQuality,
  parseSchemeOfWorkResponse,
  weeksGenerated,
  buildEntryAssistPrompt,
  entryAssistResponseSchema,
  parseEntryAssistResponse,
  type SchemeOfWorkDraft,
  type EntryAssistCurrentFields,
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
  const current: EntryAssistCurrentFields = {
    topic: "Cell structure",
    subtopic: "Organelles",
    learning_outcomes: "Learners can name key organelles.",
    content: "",
    activities: "Group diagram labelling.",
    teaching_methods: "",
    resources: "",
    assessment_methods: "",
  };

  it("includes subject/class/stream/term and says this is a single lesson, not a full scheme", () => {
    const prompt = buildEntryAssistPrompt({
      mode: "improve",
      subjectName: "Biology",
      className: "Form 2",
      streamName: "Form 2 East",
      termName: "Term 1",
      current,
    });
    expect(prompt).toContain("Biology, Form 2 (Form 2 East), Term 1");
    expect(prompt).toContain("only working on this one lesson");
  });

  it("omits the stream parenthetical when there is no stream", () => {
    const prompt = buildEntryAssistPrompt({ mode: "improve", subjectName: "Biology", className: "Form 2", streamName: null, termName: "Term 1", current });
    expect(prompt).not.toContain("(Form 2 East)");
  });

  it("interpolates the current field values as data to work on", () => {
    const prompt = buildEntryAssistPrompt({ mode: "improve", subjectName: "Biology", className: "Form 2", streamName: null, termName: "Term 1", current });
    expect(prompt).toContain("Topic: Cell structure");
    expect(prompt).toContain("Sub-topic: Organelles");
    expect(prompt).toContain("Learners can name key organelles.");
    expect(prompt).toContain("Group diagram labelling.");
  });

  it("marks unset fields explicitly rather than leaving them blank", () => {
    const prompt = buildEntryAssistPrompt({ mode: "improve", subjectName: "Biology", className: "Form 2", streamName: null, termName: "Term 1", current });
    expect(prompt).toContain("Content: (not set)");
    expect(prompt).toContain("Teaching methods: (not set)");
  });

  it("uses a distinct instruction per mode", () => {
    const improve = buildEntryAssistPrompt({ mode: "improve", subjectName: "Biology", className: "Form 2", streamName: null, termName: "Term 1", current });
    const expand = buildEntryAssistPrompt({ mode: "expand", subjectName: "Biology", className: "Form 2", streamName: null, termName: "Term 1", current });
    const generate = buildEntryAssistPrompt({
      mode: "generate_activities",
      subjectName: "Biology",
      className: "Form 2",
      streamName: null,
      termName: "Term 1",
      current,
    });
    expect(improve).toContain("Do not change the lesson's topic, sub-topic, or its fundamental scope.");
    expect(expand).toContain("Expand this single lesson with more depth and detail");
    expect(generate).toContain("Generate a fresh, varied set of learning activities");
    expect(improve).not.toContain("Expand this single lesson");
  });
});

describe("entryAssistResponseSchema", () => {
  it("restricts 'generate_activities' to just the activities field", () => {
    const schema = entryAssistResponseSchema("generate_activities");
    expect(Object.keys(schema.properties)).toEqual(["activities"]);
    expect(schema.required).toEqual(["activities"]);
  });

  it("restricts 'expand' to learning_outcomes, content and activities", () => {
    const schema = entryAssistResponseSchema("expand");
    expect(Object.keys(schema.properties).sort()).toEqual(["activities", "content", "learning_outcomes"]);
  });

  it("allows 'improve' to touch all six substantive fields", () => {
    const schema = entryAssistResponseSchema("improve");
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["activities", "assessment_methods", "content", "learning_outcomes", "resources", "teaching_methods"].sort(),
    );
  });
});

describe("parseEntryAssistResponse", () => {
  function geminiResponse(obj: unknown) {
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] };
  }

  it("extracts only the fields the mode allows, even if the model returns extras", () => {
    const result = parseEntryAssistResponse("generate_activities", geminiResponse({ activities: "Role-play in pairs.", topic: "Should be ignored" }));
    expect(result).toEqual({ fields: { activities: "Role-play in pairs." } });
  });

  it("extracts all fields for 'improve' when present", () => {
    const result = parseEntryAssistResponse(
      "improve",
      geminiResponse({
        learning_outcomes: "a",
        content: "b",
        activities: "c",
        teaching_methods: "d",
        resources: "e",
        assessment_methods: "f",
      }),
    );
    expect(result).toEqual({ fields: { learning_outcomes: "a", content: "b", activities: "c", teaching_methods: "d", resources: "e", assessment_methods: "f" } });
  });

  it("errors when a required field for the mode is missing", () => {
    const result = parseEntryAssistResponse("expand", geminiResponse({ learning_outcomes: "a", content: "b" }));
    expect(result).toEqual({ error: "The AI response was missing expected content." });
  });

  it("errors when a required field is present but empty", () => {
    const result = parseEntryAssistResponse("generate_activities", geminiResponse({ activities: "   " }));
    expect(result).toEqual({ error: "The AI response was missing expected content." });
  });

  it("errors on invalid JSON", () => {
    const malformed = { candidates: [{ content: { parts: [{ text: "not json" }] } }] };
    expect(parseEntryAssistResponse("generate_activities", malformed)).toEqual({ error: "The AI response wasn't valid JSON." });
  });

  it("errors when there is no text at all", () => {
    expect(parseEntryAssistResponse("generate_activities", { candidates: [] })).toEqual({ error: "The AI returned no content." });
  });
});
