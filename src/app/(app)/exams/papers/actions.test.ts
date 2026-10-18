import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same module-mocking technique as scheme-of-work/actions-crud-and-ai.test.ts:
// mock everything that pulls in next/headers so the "use server" file can be
// imported under plain vitest.
const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { generateExamPaper, getExamPaperSourceOptions, updateExamPaperQuestion } = await import("./actions");

type Call = { table: string; method: string; args: unknown[] };

// Recording fake: resolves each table to a configured result and records every
// method call (with args), so tests can assert exactly what was written where.
function fakeClient(opts: { results: Record<string, unknown>; permission?: boolean; user?: { id: string } | null }) {
  const calls: Call[] = [];
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: "auth-1" } : opts.user } }) },
    rpc: vi.fn(() => Promise.resolve({ data: opts.permission ?? true })),
    from(table: string) {
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: opts.results[table] ?? null, error: null });
            return (...args: unknown[]) => {
              calls.push({ table, method: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
  };
  return { client, calls };
}

const S = "school-1";
const baseResults = {
  school_users: { id: "su-1", school_id: S },
  classes: { name: "Grade 4", kicd_grade: "G4", school_id: S },
  subjects: { name: "Science", catalogue_id: "cat-1", school_id: S },
  curriculum_strands: [],
  kicd_learning_areas: [{ id: "area-1" }],
  exam_paper_ai_requests: { id: "req-1" },
  exam_papers: { id: "paper-1" },
  kicd_strands: [
    {
      name: "Living Things",
      kicd_content_sources: { id: "src-1", name: "KICD G4 Science", licence_reference: "LIC-1", attribution: "© KICD", is_enabled: true, school_id: null },
      kicd_sub_strands: [
        { id: "ks-ok", name: "Plants", level_order: 1, learning_outcomes: "Identify parts of a plant", key_inquiry_questions: null, rubric_text: null },
        { id: "ks-empty", name: "Animals", level_order: 2, learning_outcomes: null, key_inquiry_questions: "Why?", rubric_text: null },
      ],
    },
  ],
};

const input = {
  class_id: "c1",
  subject_id: "s1",
  source_kind: "platform_kicd" as const,
  source_id: "src-1",
  sub_strand_refs: ["ks-ok"],
  title: "Mid-term Science",
  total_marks: 10,
  question_count: 1,
  question_types: ["short_answer" as const],
  teacher_notes: null,
  exam_id: null,
  idempotency_key: "11111111-1111-1111-1111-111111111111",
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
  mockCreateAdminClient.mockImplementation(() => ({ rpc: vi.fn().mockResolvedValue({ data: true }) }));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.GEMINI_API_KEY = originalKey;
});

const geminiOk = (questions: unknown[]) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions }) }] } }] }) });

const writesTo = (calls: Call[], pattern: RegExp) => calls.filter((c) => pattern.test(c.table) && /^(insert|update|upsert|delete)$/.test(c.method));

describe("generateExamPaper validation and permission (no DB, no AI)", () => {
  it("refuses when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await generateExamPaper(input)).toHaveProperty("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it.each([
    ["no sub-strands", { sub_strand_refs: [] }],
    ["blank title", { title: "  " }],
    ["no source kind", { source_kind: "mixed" as never }],
    ["bad marks", { total_marks: 0 }],
    ["no question types", { question_types: [] }],
  ])("rejects %s before touching Supabase", async (_n, over) => {
    expect(await generateExamPaper({ ...input, ...over })).toHaveProperty("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("refuses a caller without the generate permission", async () => {
    const { client, calls } = fakeClient({ results: baseResults, permission: false });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([]);
    expect(await generateExamPaper(input)).toEqual({ error: "You don't have permission to generate exam papers." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.method === "insert")).toEqual([]);
  });
  it("refuses when signed out", async () => {
    const { client } = fakeClient({ results: baseResults, user: null });
    mockCreateClient.mockResolvedValue(client);
    expect(await generateExamPaper(input)).toEqual({ error: "You must be signed in." });
  });
});

describe("generateExamPaper source and curriculum guards", () => {
  it("asks for teacher input and never calls the AI when a selected sub-strand lacks learning outcomes", async () => {
    const { client } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([]);
    const r = await generateExamPaper({ ...input, sub_strand_refs: ["ks-ok", "ks-empty"] });
    expect(r).toHaveProperty("error", expect.stringMatching(/Teacher input needed.*Animals.*no learning outcomes/));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("refuses a draft school sub-strand", async () => {
    const { client } = fakeClient({
      results: {
        ...baseResults,
        kicd_strands: [],
        curriculum_strands: [{ name: "S", curriculum_sub_strands: [{ id: "own-d", name: "Draft one", level_order: 1, learning_outcomes: "x", key_inquiry_questions: null, rubric_text: null, content_source: "draft", content_updated_at: null }] }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([]);
    const r = await generateExamPaper({ ...input, source_kind: "school_authored", source_id: null, sub_strand_refs: ["own-d"] });
    expect(r).toHaveProperty("error", expect.stringMatching(/unreviewed draft/));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("refuses a sub-strand that belongs to a different source than the one chosen (no silent mixing)", async () => {
    const { client } = fakeClient({
      results: {
        ...baseResults,
        curriculum_strands: [{ name: "S", curriculum_sub_strands: [{ id: "own-1", name: "Own", level_order: 1, learning_outcomes: "x", key_inquiry_questions: null, rubric_text: null, content_source: "school_authored", content_updated_at: null }] }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([]);
    const r = await generateExamPaper({ ...input, sub_strand_refs: ["ks-ok", "own-1"] }); // platform source chosen, school ref added
    expect(r).toHaveProperty("error", expect.stringMatching(/don't belong to the chosen curriculum source/));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("refuses when the chosen source is not available (e.g. disabled or another school's)", async () => {
    const { client } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([]);
    const r = await generateExamPaper({ ...input, source_id: "some-other-source" });
    expect(r).toHaveProperty("error", expect.stringMatching(/isn't available/));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("generateExamPaper happy path and isolation", () => {
  const good = [{ question_type: "short_answer", question_text: "Name two parts of a plant.", marks: 10, marking_scheme: "1 mark each", sub_strand_ref: "ks-ok" }];

  it("saves a DRAFT with full source attribution and labels each question", async () => {
    const { client, calls } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk(good);
    const r = await generateExamPaper(input);
    expect(r).toEqual({ success: true, paperId: "paper-1", warnings: [] });

    const paperInsert = calls.find((c) => c.table === "exam_papers" && c.method === "insert")!;
    expect(paperInsert.args[0]).toMatchObject({
      status: "draft",
      source_kind: "platform_kicd",
      source_id: "src-1",
      source_name: "KICD G4 Science",
      source_licence_reference: "LIC-1",
      source_attribution: "© KICD",
      total_marks: 10,
      created_by: "su-1",
      school_id: S,
    });
    expect((paperInsert.args[0] as { source_snapshot: unknown[] }).source_snapshot).toEqual([
      { ref: "ks-ok", strand: "Living Things", sub_strand: "Plants", content_source: "kicd_licensed", content_updated_at: null },
    ]);
    const qInsert = calls.find((c) => c.table === "exam_paper_questions" && c.method === "insert")!;
    expect((qInsert.args[0] as { sub_strand_label: string }[])[0]).toMatchObject({ sub_strand_ref: "ks-ok", sub_strand_label: "Living Things › Plants", position: 1 });
  });

  it("only sends the selected, usable sub-strand to the AI", async () => {
    const { client } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    const fetchMock = geminiOk(good);
    globalThis.fetch = fetchMock;
    await generateExamPaper(input);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const prompt: string = body.contents[0].parts[0].text;
    expect(prompt).toContain("[ref: ks-ok]");
    expect(prompt).not.toContain("ks-empty");
    expect(prompt).not.toContain("Animals");
  });

  it("NEVER writes to any curriculum or KICD table", async () => {
    const { client, calls } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk(good);
    await generateExamPaper(input);
    expect(writesTo(calls, /^(curriculum_|kicd_)/)).toEqual([]);
  });

  it("saves nothing when the AI cites a sub-strand outside the selection", async () => {
    const { client, calls } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = geminiOk([{ ...good[0], sub_strand_ref: "ks-empty" }]);
    const r = await generateExamPaper(input);
    expect(r).toHaveProperty("error", expect.stringMatching(/Nothing was saved/));
    expect(calls.filter((c) => c.table === "exam_papers" && c.method === "insert")).toEqual([]);
  });

  it("saves nothing when the AI call fails", async () => {
    const { client, calls } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await generateExamPaper(input);
    expect(r).toHaveProperty("error");
    expect(calls.filter((c) => c.table === "exam_papers" && c.method === "insert")).toEqual([]);
  });
});

describe("getExamPaperSourceOptions and edits", () => {
  it("returns separate, labelled sources with usability flags", async () => {
    const { client } = fakeClient({ results: baseResults });
    mockCreateClient.mockResolvedValue(client);
    const r = await getExamPaperSourceOptions("c1", "s1");
    if ("error" in r) throw new Error(r.error);
    const platform = r.options.find((o) => o.kind === "platform_kicd")!;
    expect(platform.subStrands.map((s) => [s.ref, s.usable])).toEqual([
      ["ks-ok", true],
      ["ks-empty", false],
    ]);
  });
  it("blocks editing an approved paper", async () => {
    const { client, calls } = fakeClient({ results: { exam_paper_questions: { id: "q1", paper_id: "p1", exam_papers: { status: "approved" } } } });
    mockCreateClient.mockResolvedValue(client);
    const r = await updateExamPaperQuestion("q1", { question_text: "x", marks: 2, marking_scheme: "y" });
    expect(r).toHaveProperty("error", expect.stringMatching(/approved/));
    expect(calls.filter((c) => c.method === "update")).toEqual([]);
  });
  it("rejects invalid edit input without touching Supabase", async () => {
    expect(await updateExamPaperQuestion("q1", { question_text: "", marks: 2, marking_scheme: "y" })).toHaveProperty("error");
    expect(await updateExamPaperQuestion("q1", { question_text: "x", marks: 0, marking_scheme: "y" })).toHaveProperty("error");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
