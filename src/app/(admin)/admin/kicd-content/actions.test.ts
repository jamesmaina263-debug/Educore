import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreateClient = vi.fn();
const mockLog = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: mockLog }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("pdf-parse", () => ({ default: vi.fn(async () => ({ text: "Strand: Numbers. Sub-strand: Whole Numbers. Count to 100." })) }));

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

  it("refuses anyone who is neither a platform admin nor school management", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false }).client);
    expect(await importKicdDocument(form())).toEqual({ error: "You don't have permission to manage KICD content." });
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

  it("refuses users without academics.write", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false }).client);
    expect(await setKicdSourceEnabled("s", true)).toEqual({ error: "You don't have permission to manage KICD content." });
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

describe("school management (academics.write, own school only)", () => {
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

  it("imports a source private to the manager's own school, unpublished, without writing the platform log", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(geminiOk(extraction)));
    const { client, calls } = fakeClient({
      superAdmin: false,
      canManage: true,
      tables: {
        school_users: [{ data: { id: "su1", school_id: "school-A" }, error: null }],
        kicd_learning_areas: [{ data: null, error: null }, { data: { id: "la1" }, error: null }],
        kicd_content_sources: [{ data: { id: "src1" }, error: null }],
        kicd_strands: [{ data: [{ id: "s1", name: "Numbers" }], error: null }],
        kicd_sub_strands: [{ error: null }],
      },
    });
    mockCreateClient.mockResolvedValue(client);
    expect(await importKicdDocument(form())).toEqual({ success: true, sourceId: "src1", strands: 1, subStrands: 1, truncated: false });
    const sourceInsert = calls.find((c) => c.table === "kicd_content_sources" && c.op === "insert")!;
    expect(sourceInsert.args[0]).toMatchObject({ is_enabled: false, school_id: "school-A", created_by: "su1" });
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("platform admin imports stay platform-wide (school_id null)", async () => {
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
    expect(sourceInsert.args[0]).toMatchObject({ school_id: null, created_by: null });
  });

  it("refuses a manager whose account has no school", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ superAdmin: false, canManage: true, tables: { school_users: [{ data: null, error: null }] } }).client);
    expect(await setKicdSourceEnabled("s", false)).toEqual({ error: "Your account isn't attached to a school." });
  });

  it("publishing another school's or a platform source reports not found (RLS returns no rows)", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient({
        superAdmin: false,
        canManage: true,
        tables: { school_users: [{ data: { id: "su1", school_id: "school-A" }, error: null }], kicd_content_sources: [{ data: [], error: null }] },
      }).client,
    );
    expect(await setKicdSourceEnabled("other", false)).toEqual({ error: "Source not found." });
  });
});
