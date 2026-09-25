// Pure helpers for AI-generated Scheme of Work drafts. Split out of the
// server action the same way report-card-comment.ts is split out of
// exams/report-cards/actions.ts -- so prompt-building, response parsing and
// the quality-check pass can be unit tested without a live Supabase
// connection or network call.

export const SCHEME_OF_WORK_PROMPT_VERSION = "scheme_of_work_prompt_v1";

// Same model family as report-card comments (see report-card-comment.ts) --
// reusing rather than introducing a second AI integration. Scheme
// generation produces much more text than a report-card comment, so it
// gets a larger maxOutputTokens budget at the call site, but the model and
// endpoint are shared.
export const GEMINI_SCHEME_MODEL = "gemini-3.5-flash-lite";

export interface SchemeOfWorkPromptInput {
  subjectName: string;
  className: string;
  streamName: string | null;
  termName: string;
  academicYearName: string;
  totalWeeks: number;
  lessonsPerWeek: number;
  /** e.g. "CBC" -- only set when the school's own data says so; never invented. */
  curriculumFramework: string | null;
  /**
   * Pre-formatted text block built by buildCurriculumContext() from this
   * school's own recorded curriculum_strands/curriculum_sub_strands rows
   * for this subject (real data the school entered, e.g. via the CBC
   * competency-marking feature) -- never fabricated, and null/omitted
   * whenever the school has nothing usable recorded for this subject, in
   * which case the prompt falls back to the plain curriculumFramework
   * behavior exactly as before this field existed.
   */
  curriculumContext?: string | null;
}

/**
 * Raw shape of one curriculum_sub_strands row as read from the DB, filtered
 * down to what the prompt is allowed to see. content_source distinguishes
 * confirmed-licensed/school-authored text (safe to feed to the AI and,
 * downstream, to a teacher-facing scheme draft) from 'draft' rows, which
 * the schema's own comment says "must not be shown to parents/exported
 * until reclassified" -- buildCurriculumContext excludes 'draft' rows
 * itself so callers can't accidentally leak one in.
 */
export interface CurriculumSubStrandRow {
  name: string;
  learning_outcomes: string | null;
  key_inquiry_questions: string | null;
  rubric_text: string | null;
  content_source: string;
}

export interface CurriculumStrandRow {
  name: string;
  sub_strands: CurriculumSubStrandRow[];
}

export interface CurriculumContextResult {
  /** Pre-formatted text block to interpolate into the prompt. */
  text: string;
  /** How many sub-strands actually contributed usable content -- surfaced
   *  to the teacher so "curriculum-aware" isn't an invisible claim. */
  itemCount: number;
}

/**
 * Turns this school's own recorded curriculum_strands/curriculum_sub_strands
 * for a subject into prompt-ready text. Returns null when there's nothing
 * usable (no strands recorded for this subject at all -- true for most
 * schools, since this data only exists where a school has opted into the
 * CBC competency-marking feature -- or every sub-strand recorded is either
 * empty or still content_source='draft').
 *
 * Deliberately excludes the separate structured-rubrics tables
 * (rubrics/rubric_criteria/rubric_level_descriptors): curriculum_sub_strands
 * .rubric_text already gives free-text assessment guidance per sub-strand,
 * and pulling the fully structured, per-band rubric criteria would add a
 * few more joins plus grading-scale-band name resolution for data that's
 * rarer still (a school has to have gone past naming strands to building
 * full structured rubrics). Left as a future enhancement if it turns out
 * to matter in practice.
 */
export function buildCurriculumContext(strands: CurriculumStrandRow[]): CurriculumContextResult | null {
  const lines: string[] = [];
  let itemCount = 0;

  for (const strand of strands) {
    const usable = strand.sub_strands.filter(
      (ss) => ss.content_source !== "draft" && (ss.learning_outcomes?.trim() || ss.key_inquiry_questions?.trim() || ss.rubric_text?.trim()),
    );
    if (usable.length === 0) continue;

    lines.push(`- ${strand.name}`);
    for (const ss of usable) {
      itemCount += 1;
      lines.push(`  - ${ss.name}`);
      if (ss.learning_outcomes?.trim()) lines.push(`    Learning outcomes: ${ss.learning_outcomes.trim()}`);
      if (ss.key_inquiry_questions?.trim()) lines.push(`    Key inquiry questions: ${ss.key_inquiry_questions.trim()}`);
      if (ss.rubric_text?.trim()) lines.push(`    Assessment guidance: ${ss.rubric_text.trim()}`);
    }
  }

  if (itemCount === 0) return null;
  return { text: lines.join("\n"), itemCount };
}

/**
 * Every value interpolated here comes from the school's own academics data
 * (subject/class/stream/term names, already validated to exist and belong
 * to the caller's school by the server action before this is called) or
 * from validated numeric inputs -- never raw free-text typed by the
 * teacher into this request. That's deliberate (spec item 19: the
 * application controls the prompt; nothing here can carry a teacher's
 * arbitrary text in as an instruction to the model).
 */
export function buildSchemeOfWorkPrompt(input: SchemeOfWorkPromptInput): string {
  const stream = input.streamName ? ` (${input.streamName})` : "";

  let framework: string;
  if (input.curriculumContext) {
    const frameworkNote = input.curriculumFramework ? ` (${input.curriculumFramework})` : "";
    framework = `This school has recorded its own curriculum content${frameworkNote} for ${input.subjectName} in EduCore. Ground the scheme's topics, learning outcomes and assessment guidance in this recorded content rather than inventing generic material where it applies. You may still use your general teaching knowledge to fill in anything it doesn't cover, and to reach the requested number of weeks/lessons, but do not contradict it.\n\nSchool's recorded curriculum content for ${input.subjectName}:\n${input.curriculumContext}`;
  } else if (input.curriculumFramework) {
    framework = `Curriculum framework: ${input.curriculumFramework}. Align topics, learning outcomes and competencies to this framework where you can, but if you are not certain of the exact official syllabus wording, write outcomes in your own clear teaching language rather than inventing official-sounding curriculum codes or clauses.`;
  } else {
    framework = "No specific curriculum framework was supplied -- write standard, level-appropriate content and do not claim it is drawn from any official syllabus.";
  }

  return `You are helping a Kenyan school teacher draft a Scheme of Work. Generate a complete, realistic teaching plan as structured data (the response schema is enforced separately; just follow it).

Subject: ${input.subjectName}
Class: ${input.className}${stream}
Term: ${input.termName}, Academic Year: ${input.academicYearName}
Number of teaching weeks: ${input.totalWeeks}
Lessons per week: ${input.lessonsPerWeek}
${framework}

Requirements:
- Produce exactly ${input.totalWeeks} weeks, numbered 1 to ${input.totalWeeks} in order, with no gaps or repeats.
- Each week must have exactly ${input.lessonsPerWeek} lesson entries, numbered 1 to ${input.lessonsPerWeek}.
- Distribute subject content logically across the weeks: build a real progression, do not repeat the same topic in multiple weeks, do not leave any week's topic near-identical to another week's, and cover a realistic breadth of the subject for this class level and term length -- not just one narrow theme stretched thin.
- Each lesson needs its own topic, subtopic, learning outcomes, content summary, learning activities, teaching/learning methods, resources, and an assessment method. Keep each field concrete and specific to that lesson, not generic filler repeated everywhere.
- Vary the assessment methods and activities across the scheme rather than repeating the same one every lesson.
- Do not invent specific official curriculum codes, clause numbers, or exact KICD/KNEC syllabus references. If you are not certain of the exact official wording, write in plain teaching language instead.
- This is a first draft for a teacher to review and edit -- reasonable and realistic is the goal, not a claim of official authority.`;
}

// ---------------------------------------------------------------------------
// Structured output schema (Gemini's generationConfig.responseSchema, a
// subset of OpenAPI schema). Passed at the call site so the model returns
// JSON matching this shape by construction -- this is what item 15 in the
// spec ("do not rely on parsing arbitrary prose") is asking for.
// ---------------------------------------------------------------------------
export const schemeOfWorkResponseSchema = {
  type: "OBJECT",
  properties: {
    weeks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          week: { type: "INTEGER" },
          entries: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                lesson: { type: "INTEGER" },
                topic: { type: "STRING" },
                subtopic: { type: "STRING" },
                learning_outcomes: { type: "STRING" },
                content: { type: "STRING" },
                activities: { type: "STRING" },
                methods: { type: "STRING" },
                resources: { type: "STRING" },
                assessment: { type: "STRING" },
              },
              required: ["lesson", "topic", "learning_outcomes", "activities", "assessment"],
            },
          },
        },
        required: ["week", "entries"],
      },
    },
  },
  required: ["weeks"],
} as const;

// ---------------------------------------------------------------------------
// Parsing + hard validation. A response that fails this is malformed --
// never partially trusted, never saved (spec items 8, 9, 18).
// ---------------------------------------------------------------------------
export interface SchemeOfWorkDraftEntry {
  lesson: number;
  topic: string;
  subtopic: string;
  learning_outcomes: string;
  content: string;
  activities: string;
  methods: string;
  resources: string;
  assessment: string;
}

export interface SchemeOfWorkDraftWeek {
  week: number;
  entries: SchemeOfWorkDraftEntry[];
}

export interface SchemeOfWorkDraft {
  weeks: SchemeOfWorkDraftWeek[];
}

export type SchemeOfWorkParseResult = { draft: SchemeOfWorkDraft } | { error: string };

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Extracts Gemini's response text and parses+validates it against the
 * shape above. Returns an error (never throws) for: no text at all, text
 * that isn't valid JSON, or JSON that's missing the required structure --
 * all three are the "malformed response" failure mode (spec item 9), not a
 * bug in this function.
 */
export function parseSchemeOfWorkResponse(data: unknown): SchemeOfWorkParseResult {
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

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { weeks?: unknown }).weeks)) {
    return { error: "The AI response was missing the expected 'weeks' structure." };
  }

  const rawWeeks = (parsed as { weeks: unknown[] }).weeks;
  if (rawWeeks.length === 0) {
    return { error: "The AI returned no weeks." };
  }

  const weeks: SchemeOfWorkDraftWeek[] = [];
  for (const rawWeek of rawWeeks) {
    if (typeof rawWeek !== "object" || rawWeek === null) {
      return { error: "The AI response contained a malformed week entry." };
    }
    const w = rawWeek as Record<string, unknown>;
    const weekNumber = typeof w.week === "number" ? w.week : Number(w.week);
    if (!Number.isFinite(weekNumber) || weekNumber <= 0) {
      return { error: "The AI response contained a week with an invalid week number." };
    }
    if (!Array.isArray(w.entries) || w.entries.length === 0) {
      return { error: `Week ${weekNumber} in the AI response had no lesson entries.` };
    }

    const entries: SchemeOfWorkDraftEntry[] = [];
    for (const rawEntry of w.entries) {
      if (typeof rawEntry !== "object" || rawEntry === null) {
        return { error: `Week ${weekNumber} in the AI response contained a malformed entry.` };
      }
      const e = rawEntry as Record<string, unknown>;
      const lessonNumber = typeof e.lesson === "number" ? e.lesson : Number(e.lesson);
      const topic = asString(e.topic);
      if (!Number.isFinite(lessonNumber) || lessonNumber <= 0 || !topic) {
        return { error: `Week ${weekNumber} in the AI response had an entry missing a lesson number or topic.` };
      }
      entries.push({
        lesson: lessonNumber,
        topic,
        subtopic: asString(e.subtopic),
        learning_outcomes: asString(e.learning_outcomes),
        content: asString(e.content),
        activities: asString(e.activities),
        methods: asString(e.methods),
        resources: asString(e.resources),
        assessment: asString(e.assessment),
      });
    }
    weeks.push({ week: weekNumber, entries });
  }

  return { draft: { weeks } };
}

// ---------------------------------------------------------------------------
// Completeness check (spec item 10: partial response handling). Pure
// arithmetic over an already-validated draft -- no network/DB involved.
// ---------------------------------------------------------------------------
export function weeksGenerated(draft: SchemeOfWorkDraft): number {
  return new Set(draft.weeks.map((w) => w.week)).size;
}

// ---------------------------------------------------------------------------
// Quality checks (spec items 10/12/14): non-blocking warnings surfaced to
// the teacher alongside the draft. These never reject a response on their
// own -- a hard-invalid response was already rejected by the parser above.
// ---------------------------------------------------------------------------
export function checkSchemeOfWorkQuality(draft: SchemeOfWorkDraft, totalWeeks: number, lessonsPerWeek: number): string[] {
  const warnings: string[] = [];

  const seenWeeks = new Set<number>();
  const topicByWeek = new Map<number, string>();
  const outcomeCounts = new Map<string, number>();

  for (const week of draft.weeks) {
    if (seenWeeks.has(week.week)) {
      warnings.push(`Week ${week.week} appears more than once.`);
    }
    seenWeeks.add(week.week);

    if (week.week > totalWeeks) {
      warnings.push(`Week ${week.week} is beyond the requested ${totalWeeks} teaching weeks.`);
    }

    if (week.entries.length !== lessonsPerWeek) {
      warnings.push(`Week ${week.week} has ${week.entries.length} lesson(s), expected ${lessonsPerWeek}.`);
    }

    const seenLessons = new Set<number>();
    for (const entry of week.entries) {
      if (seenLessons.has(entry.lesson)) {
        warnings.push(`Week ${week.week} has a duplicate lesson number (${entry.lesson}).`);
      }
      seenLessons.add(entry.lesson);

      if (!entry.learning_outcomes) warnings.push(`Week ${week.week}, lesson ${entry.lesson} has no learning outcomes.`);
      if (!entry.activities) warnings.push(`Week ${week.week}, lesson ${entry.lesson} has no learning activities.`);
      if (!entry.assessment) warnings.push(`Week ${week.week}, lesson ${entry.lesson} has no assessment method.`);

      if (entry.learning_outcomes) {
        const key = entry.learning_outcomes.toLowerCase();
        outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
      }
    }

    const firstTopic = week.entries[0]?.topic?.toLowerCase();
    if (firstTopic) {
      for (const [otherWeek, otherTopic] of topicByWeek) {
        if (otherTopic === firstTopic) {
          warnings.push(`Week ${week.week} and Week ${otherWeek} have the same topic ("${week.entries[0].topic}").`);
        }
      }
      topicByWeek.set(week.week, firstTopic);
    }
  }

  for (const [outcome, count] of outcomeCounts) {
    if (count > 2) {
      warnings.push(`The learning outcome "${outcome}" is repeated ${count} times across the scheme.`);
    }
  }

  const missingWeeks: number[] = [];
  for (let i = 1; i <= totalWeeks; i++) {
    if (!seenWeeks.has(i)) missingWeeks.push(i);
  }
  if (missingWeeks.length > 0) {
    warnings.push(`Missing week(s): ${missingWeeks.join(", ")}.`);
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Per-entry "AI Assist" (spec item 6 / gap #5) -- a small, scoped sibling of
// buildSchemeOfWorkPrompt above, working on one already-saved lesson at a
// time instead of a whole scheme. Same model, same structured-output/
// parse/validate discipline, same "never auto-saves" contract (the server
// action returns a suggestion; only the teacher's own Save click in
// scheme-editor.tsx persists anything).
//
// Note on what's "instruction" vs "data" here, since it looks different
// from buildSchemeOfWorkPrompt's doc comment above: this prompt
// deliberately DOES embed the teacher's own free-typed current field
// values -- that's the whole point of an editing assistant (it has to see
// the draft to improve it). What stays entirely app-controlled is the
// output contract: which fields can come back is fixed per mode by
// entryAssistResponseSchema()/ENTRY_ASSIST_FIELDS below, not by anything
// in the teacher's text, and nothing the model returns is written
// anywhere until the teacher explicitly applies a suggested field in the
// UI and then explicitly saves the entry through the existing
// addSchemeEntry/updateSchemeEntry path.
// ---------------------------------------------------------------------------

export type EntryAssistMode = "improve" | "expand" | "generate_activities";

/** Which of a lesson's editable fields each mode is allowed to suggest new
 *  text for. Also doubles as the Gemini structured-output contract (see
 *  entryAssistResponseSchema) and the parse allow-list (see
 *  parseEntryAssistResponse) -- one list, three uses, so a mode can't
 *  accidentally return (or accept) a field it wasn't asked about. */
export const ENTRY_ASSIST_FIELDS: Record<EntryAssistMode, readonly (keyof EntryAssistCurrentFields)[]> = {
  improve: ["learning_outcomes", "content", "activities", "teaching_methods", "resources", "assessment_methods"],
  expand: ["learning_outcomes", "content", "activities"],
  generate_activities: ["activities"],
};

const ENTRY_ASSIST_INSTRUCTIONS: Record<EntryAssistMode, string> = {
  improve:
    "Improve the quality and clarity of this single lesson's learning outcomes, content, learning activities, teaching methods, resources and assessment method. Make each one more specific and better written, and better aligned with the topic. Do not change the lesson's topic, sub-topic, or its fundamental scope.",
  expand:
    "Expand this single lesson with more depth and detail, appropriate for the class level. Build on what is already there -- add more substance to the learning outcomes, content and learning activities -- rather than changing the lesson's direction.",
  generate_activities:
    "Generate a fresh, varied set of learning activities for this single lesson, appropriate for its topic, subject and class level. Avoid generic filler -- make the activities concrete and specific to this lesson's topic and content.",
};

export interface EntryAssistCurrentFields {
  topic: string;
  subtopic: string;
  learning_outcomes: string;
  content: string;
  activities: string;
  teaching_methods: string;
  resources: string;
  assessment_methods: string;
}

export interface EntryAssistPromptInput {
  mode: EntryAssistMode;
  subjectName: string;
  className: string;
  streamName: string | null;
  termName: string;
  current: EntryAssistCurrentFields;
}

export function buildEntryAssistPrompt(input: EntryAssistPromptInput): string {
  const stream = input.streamName ? ` (${input.streamName})` : "";
  const c = input.current;

  return `You are helping a Kenyan school teacher improve a single lesson within an existing Scheme of Work for ${input.subjectName}, ${input.className}${stream}, ${input.termName}. You are only working on this one lesson -- not generating a full scheme.

Current lesson draft:
Topic: ${c.topic || "(not set)"}
Sub-topic: ${c.subtopic || "(not set)"}
Learning outcomes: ${c.learning_outcomes || "(not set)"}
Content: ${c.content || "(not set)"}
Learning activities: ${c.activities || "(not set)"}
Teaching methods: ${c.teaching_methods || "(not set)"}
Resources: ${c.resources || "(not set)"}
Assessment method: ${c.assessment_methods || "(not set)"}

Task: ${ENTRY_ASSIST_INSTRUCTIONS[input.mode]}

Return only the field(s) the response schema asks for. This is a draft suggestion the teacher will review before accepting -- be concrete and realistic, not vague or generic.`;
}

export function entryAssistResponseSchema(mode: EntryAssistMode) {
  const properties: Record<string, { type: "STRING" }> = {};
  for (const field of ENTRY_ASSIST_FIELDS[mode]) properties[field] = { type: "STRING" };
  return {
    type: "OBJECT",
    properties,
    required: [...ENTRY_ASSIST_FIELDS[mode]],
  } as const;
}

export type EntryAssistParseResult = { fields: Partial<EntryAssistCurrentFields> } | { error: string };

export function parseEntryAssistResponse(mode: EntryAssistMode, data: unknown): EntryAssistParseResult {
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

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "The AI response was not a valid object." };
  }

  const obj = parsed as Record<string, unknown>;
  const fields: Partial<EntryAssistCurrentFields> = {};
  for (const field of ENTRY_ASSIST_FIELDS[mode]) {
    const value = asString(obj[field]);
    if (!value) {
      return { error: "The AI response was missing expected content." };
    }
    fields[field] = value;
  }

  return { fields };
}
