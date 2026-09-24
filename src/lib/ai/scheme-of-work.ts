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
  const framework = input.curriculumFramework
    ? `Curriculum framework: ${input.curriculumFramework}. Align topics, learning outcomes and competencies to this framework where you can, but if you are not certain of the exact official syllabus wording, write outcomes in your own clear teaching language rather than inventing official-sounding curriculum codes or clauses.`
    : "No specific curriculum framework was supplied -- write standard, level-appropriate content and do not claim it is drawn from any official syllabus.";

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
