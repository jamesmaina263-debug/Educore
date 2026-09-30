import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreateClient = vi.fn();
const mockLog = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: mockLog }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pdf/extract-text", () => ({ extractPdfText: vi.fn(async () => "Strand: Numbers. Sub-strand: Whole Numbers. Count to 100.") }));

const { importKicdDocument, setKicdSourceEnabled, updateKicdSubStrand, deleteKicdSubStrand, deleteKicdSource } = await import("./actions");

type Call = { table: string; op: string; args: unknown[] };

// Per-table result queues consumed in call order; every chained op is
// recorded in `calls` so tests can assert what was written.
function fakeClient(opts: { superAdmin?: boolean; canManage?: boolean; user?: boolean; tables?: Record<string, unknown[]> }) {
  const calls: Call[] = [];
  const queues: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(opts.tables ?? {})) queues[k] = [...v];
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user === false ? null : { id: "u1" } } }) },
    rpc: async (name: string) => ({
      data: name === "auth_is_super_admin" ? (opts.superAdmin ?? true) : name === "auth_has_permission" ? (opts.canManage ?? false) : null,
      error: null,
    }),
    from: (table: string) => {
      const next = () => Promise.resolve((queues[table] ?? []).shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "delete", "eq", "ilike", "limit", "order"]) {
        chain[op] = (...args: unknown[]) => (calls.push({ table, op, args }), chain);
      }
      chain.single = next;
      chain.maybeSingle = next;
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { client, calls };
}

function form(over: Record<string, string> = {}, file: File | null = new File([new Uint8Array([1])], "g6-maths.pdf", { type: "application/pdf" })) {
  const fd = new FormData();
  const base: Record<string, string> = {
    source_name: "Grade 6 Maths",
    licence_reference: "LIC-1",
    attribution: "Source: KICD",
    licence_scope: "",
    learning_area: "Mathematics",
    grade: "G6",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  if (file) fd.set("file", file);
  return fd;
}

const geminiOk = (body: unknown) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }) });
const extraction = { strands: [{ name: "Numbers", sub_strands: [{ name: "Whole Numbers", learning_outcomes: "Count", confidence: "high" }] }] };

describe("importKicdDocument", () => {
  const key = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "k";
    mockCreateClient.mockReset();
    mockLog.mockReset();
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = key;
    vi.unstubAllGlobals();
  });

  it("refuses without a licence reference or attribution, before touching the database", async () => {
    expect(await importKicdDocument(form({ licence_reference: " " }))).toEqual({ error: "A licence reference is required for every KICD import." });
    expect(await importKicdDocument(form({ attribution: "" }))).toEqual({ error: "An attribution line is required for every KICD import." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("refuses an invalid grade, a non-PDF and a missing file", async () => {
    expect(await importKicdDocument(form({ grade: "G13" }))).toEqual({ error: "Please choose a valid grade." });
    expect(await importKicdDocument(form({}, new File(["x"], "a.txt", { type: "text/plain" })))).toEqual({ error: "Please upload a PDF file." });
    expect(await importKicdDocument(form({}, null))).toEqual({ error: "No file provided." });
  });

  it("refuses anyone who is not a platform admin", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false }).client);
    expect(await importKicdDocument(form())).toEqual({ error: "Only platform admins can manage shared KICD content." });
  });

  it("imports as an UNPUBLISHED source, with the licence details, and logs it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiOk(extraction)));
    const { client, calls } = fakeClient({
      tables: {
        kicd_learning_areas: [{ data: null, error: null }, { data: { id: "la1" }, error: null }],
        kicd_content_sources: [{ data: { id: "src1" }, error: null }],
        kicd_strands: [{ data: [{ id: "s1", name: "Numbers" }], error: null }],
        kicd_sub_strands: [{ error: null }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    const r = await importKicdDocument(form());
    expect(r).toEqual({ success: true, sourceId: "src1", strands: 1, subStrands: 1, truncated: false });
    const sourceInsert = calls.find((c) => c.table === "kicd_content_sources" && c.op === "insert")!;
    expect(sourceInsert.args[0]).toMatchObject({ is_enabled: false, licence_reference: "LIC-1", attribution: "Source: KICD", source_document: "g6-maths.pdf" });
    expect(mockLog).toHaveBeenCalledWith(expect.anything(), "import_kicd_document", expect.objectContaining({ licence_reference: "LIC-1", grade: "G6" }));
  });

  it("merges repeated strand and sub-strand names instead of failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        geminiOk({
          strands: [
            { name: "Numbers", sub_strands: [{ name: "Whole", confidence: "high" }] },
            { name: "numbers", sub_strands: [{ name: "WHOLE", confidence: "high" }, { name: "Fractions", confidence: "high" }] },
          ],
        }),
      ),
    );
    const { client } = fakeClient({
      tables: {
        kicd_learning_areas: [{ data: { id: "la1" }, error: null }],
        kicd_content_sources: [{ data: { id: "src1" }, error: null }],
        kicd_strands: [{ data: [{ id: "s1", name: "Numbers" }], error: null }],
        kicd_sub_strands: [{ error: null }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    expect(await importKicdDocument(form())).toMatchObject({ success: true, strands: 1, subStrands: 2 });
  });

  it("rolls the source back when saving sub-strands fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiOk(extraction)));
    const { client, calls } = fakeClient({
      tables: {
        kicd_learning_areas: [{ data: { id: "la1" }, error: null }],
        kicd_content_sources: [{ data: { id: "src1" }, error: null }, { error: null }],
        kicd_strands: [{ data: [{ id: "s1", name: "Numbers" }], error: null }, { error: null }],
        kicd_sub_strands: [{ error: { message: "boom" } }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    expect(await importKicdDocument(form())).toEqual({ error: "boom" });
    expect(calls.some((c) => c.table === "kicd_content_sources" && c.op === "delete")).toBe(true);
    expect(calls.some((c) => c.table === "kicd_strands" && c.op === "delete")).toBe(true);
    expect(mockLog).not.toHaveBeenCalled();
  });
});

describe("setKicdSourceEnabled", () => {
  beforeEach(() => mockLog.mockReset());

  it("refuses a non-admin", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false }).client);
    expect(await setKicdSourceEnabled("s", true)).toEqual({ error: "Only platform admins can manage shared KICD content." });
  });
  it("refuses to publish an empty source", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_strands: [{ data: [], error: null }] } }).client);
    expect(await setKicdSourceEnabled("s", true)).toEqual({ error: "This source has no content to publish." });
  });
  it("publishes and logs; withdrawing needs no content check", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_strands: [{ data: [{ id: "x" }], error: null }], kicd_content_sources: [{ data: [{ id: "s" }], error: null }] } }).client);
    expect(await setKicdSourceEnabled("s", true)).toEqual({ success: true });
    expect(mockLog).toHaveBeenCalledWith(expect.anything(), "publish_kicd_source", { source_id: "s" });
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_content_sources: [{ data: [{ id: "s" }], error: null }] } }).client);
    expect(await setKicdSourceEnabled("s", false)).toEqual({ success: true });
    expect(mockLog).toHaveBeenLastCalledWith(expect.anything(), "withdraw_kicd_source", { source_id: "s" });
  });
  it("reports a missing source", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_content_sources: [{ data: [], error: null }] } }).client);
    expect(await setKicdSourceEnabled("s", false)).toEqual({ error: "Source not found." });
  });
});

describe("deleteKicdSource", () => {
  it("will not delete a published source", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_content_sources: [{ data: { id: "s", is_enabled: true }, error: null }] } }).client);
    expect(await deleteKicdSource("s")).toEqual({ error: "Withdraw this source before deleting it." });
  });
  it("deletes an unpublished source", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient({ tables: { kicd_content_sources: [{ data: { id: "s", is_enabled: false }, error: null }, { error: null }], kicd_strands: [{ error: null }] } }).client,
    );
    expect(await deleteKicdSource("s")).toEqual({ success: true });
  });
});

describe("sub-strand edits", () => {
  it("requires a name and maps a duplicate-name conflict", async () => {
    expect(await updateKicdSubStrand("x", { name: " ", learning_outcomes: "", key_inquiry_questions: "", rubric_text: "" })).toEqual({ error: "Name is required." });
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_sub_strands: [{ data: null, error: { code: "23505", message: "dup" } }] } }).client);
    expect(await updateKicdSubStrand("x", { name: "A", learning_outcomes: "", key_inquiry_questions: "", rubric_text: "" })).toEqual({
      error: "Another sub-strand in this strand already has that name.",
    });
  });
  it("removes a sub-strand and reports when nothing was removed", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_sub_strands: [{ data: [{ id: "x" }], error: null }] } }).client);
    expect(await deleteKicdSubStrand("x")).toEqual({ success: true });
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_sub_strands: [{ data: [], error: null }] } }).client);
    expect(await deleteKicdSubStrand("x")).toEqual({ error: "Sub-strand not found." });
  });
});

// Reverted at the application layer (see actions.ts header comment): school
// management no longer gets a self-service KICD import path -- it would
// duplicate the already-shipped Curriculum Content flow (Phase 2A). These
// tests confirm the refusal, not the capability.
describe("school management can no longer self-import KICD content (reverted -- avoids duplicating Curriculum Content)", () => {
  const key = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "k";
    mockCreateClient.mockReset();
    mockLog.mockReset();
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = key;
    vi.unstubAllGlobals();
  });

  it("refuses a school manager (academics.write, not a platform admin) on every action", async () => {
    const denied = { error: "Only platform admins can manage shared KICD content." };
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false, canManage: true }).client);
    expect(await importKicdDocument(form())).toEqual(denied);
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false, canManage: true }).client);
    expect(await setKicdSourceEnabled("s", true)).toEqual(denied);
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false, canManage: true }).client);
    expect(await deleteKicdSource("s")).toEqual(denied);
  });

  it("platform admin imports are still recorded platform-wide and logged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiOk(extraction)));
    const { client, calls } = fakeClient({
      tables: {
        kicd_learning_areas: [{ data: null, error: null }, { data: { id: "la1" }, error: null }],
        kicd_content_sources: [{ data: { id: "src1" }, error: null }],
        kicd_strands: [{ data: [{ id: "s1", name: "Numbers" }], error: null }],
        kicd_sub_strands: [{ error: null }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    await importKicdDocument(form());
    const sourceInsert = calls.find((c) => c.table === "kicd_content_sources" && c.op === "insert")!;
    expect(sourceInsert.args[0]).not.toHaveProperty("school_id");
    expect(mockLog).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("setKicdLearningAreaCatalogue", () => {
  it("refuses non-admins and bad input", async () => {
    const { setKicdLearningAreaCatalogue } = await import("./actions");
    expect(await setKicdLearningAreaCatalogue("", "c")).toEqual({ error: "Missing learning area." });
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false }).client);
    expect(await setKicdLearningAreaCatalogue("la", "c")).toEqual({ error: "Only platform admins can change learning area mappings." });
  });
  it("refuses a school manager too -- this mapping is platform-admin only, never delegated via academics.write", async () => {
    const { setKicdLearningAreaCatalogue } = await import("./actions");
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false, canManage: true }).client);
    expect(await setKicdLearningAreaCatalogue("la", "c")).toEqual({ error: "Only platform admins can change learning area mappings." });
  });
  it("links, clears, logs, and reports a missing area", async () => {
    const { setKicdLearningAreaCatalogue } = await import("./actions");
    const a = fakeClient({ tables: { kicd_learning_areas: [{ data: [{ id: "la" }], error: null }] } });
    mockCreateClient.mockResolvedValue(a.client);
    expect(await setKicdLearningAreaCatalogue("la", "cat1")).toEqual({ success: true });
    expect(a.calls.find((c) => c.op === "update")!.args[0]).toEqual({ catalogue_id: "cat1" });
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_learning_areas: [{ data: [{ id: "la" }], error: null }] } }).client);
    expect(await setKicdLearningAreaCatalogue("la", null)).toEqual({ success: true });
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { kicd_learning_areas: [{ data: [], error: null }] } }).client);
    expect(await setKicdLearningAreaCatalogue("la", "c")).toEqual({ error: "Learning area not found." });
  });
});
