import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pdf/extract-text", () => ({
  extractPdfText: vi.fn(async () => "Strand: Numbers\nSub-strand: Whole Numbers\nCount to 100."),
}));

const { uploadCurriculumDocument, deleteCurriculumSubStrand } = await import("./actions");

// A minimal, table-scoped fake Supabase client. Each table gets its own
// queue of results, consumed in call order -- appropriate here because,
// within a single call to uploadCurriculumDocument, every table is touched
// in a fixed, known sequence for a given test scenario (no concurrent
// Promise.all across tables). Any chained method (select/insert/update/
// delete/eq/in/order) just returns the same object; only an explicit
// .single()/.maybeSingle(), or awaiting the chain directly (which invokes
// .then()), pops the next queued result.
function makeTableChain(queue: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "insert", "update", "delete", "eq", "in", "order"]) {
    chain[op] = () => chain;
  }
  chain.single = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  chain.maybeSingle = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject);
  return chain;
}

function fakeClient(opts: {
  user?: { id: string } | null;
  permissions?: { write?: boolean; upload?: boolean };
  tables?: Record<string, unknown[]>;
  uploadResult?: { error: { message: string } | null };
}) {
  return {
    auth: { getUser: async () => ({ data: { user: opts.user ?? { id: "u1" } } }) },
    rpc: (name: string, args: { p_permission_key?: string }) => {
      if (name === "auth_has_permission") {
        if (args.p_permission_key === "academics.write") return Promise.resolve({ data: opts.permissions?.write ?? false, error: null });
        if (args.p_permission_key === "academics.curriculum_upload") return Promise.resolve({ data: opts.permissions?.upload ?? false, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => makeTableChain(opts.tables?.[table] ?? []),
    storage: {
      from: () => ({
        upload: vi.fn(async () => opts.uploadResult ?? { error: null }),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  };
}

function pdfFile(name = "curriculum.pdf") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

function geminiResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }),
  };
}

describe("uploadCurriculumDocument", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("rejects when neither academics.write nor academics.curriculum_upload is held", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ permissions: { write: false, upload: false } }));
    const formData = new FormData();
    formData.set("file", pdfFile());
    const result = await uploadCurriculumDocument("subj1", formData);
    expect(result).toEqual({ error: "You don't have permission to upload curriculum documents." });
  });

  it("rejects a non-PDF file", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ permissions: { upload: true } }));
    const formData = new FormData();
    formData.set("file", new File(["x"], "notes.txt", { type: "text/plain" }));
    const result = await uploadCurriculumDocument("subj1", formData);
    expect(result).toEqual({ error: "Please upload a PDF file." });
  });

  it("rejects when no file is provided", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ permissions: { upload: true } }));
    const result = await uploadCurriculumDocument("subj1", new FormData());
    expect(result).toEqual({ error: "No file provided." });
  });

  it("extracts and saves draft strands/sub-strands on a full success path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        geminiResponse({
          strands: [
            {
              name: "Numbers",
              sub_strands: [{ name: "Whole Numbers", learning_outcomes: "Count to 100", key_inquiry_questions: "", rubric_text: "", confidence: "high" }],
            },
          ],
        }),
      ),
    );
    mockCreateClient.mockResolvedValue(
      fakeClient({
        permissions: { upload: true },
        tables: {
          school_users: [{ data: { id: "su1", school_id: "sch1" }, error: null }],
          subjects: [{ data: { id: "subj1", name: "Mathematics" }, error: null }],
          curriculum_extraction_batches: [{ error: null }, { error: null }],
          curriculum_strands: [{ data: [], error: null }, { data: { id: "strand-1" }, error: null }],
          curriculum_sub_strands: [{ error: null }],
        },
      }),
    );
    const formData = new FormData();
    formData.set("file", pdfFile());
    const result = await uploadCurriculumDocument("subj1", formData);
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        strandsExtracted: 1,
        subStrandsExtracted: 1,
        lowConfidenceCount: 0,
        documentTruncated: false,
      }),
    );
  });

  it("refuses a PDF with no extractable text layer, without calling the AI", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const extractMock = (await import("@/lib/pdf/extract-text")).extractPdfText as unknown as ReturnType<typeof vi.fn>;
    extractMock.mockResolvedValueOnce("");

    mockCreateClient.mockResolvedValue(
      fakeClient({
        permissions: { upload: true },
        tables: {
          school_users: [{ data: { id: "su1", school_id: "sch1" }, error: null }],
          subjects: [{ data: { id: "subj1", name: "Mathematics" }, error: null }],
          curriculum_extraction_batches: [{ error: null }, { error: null }],
        },
      }),
    );
    const formData = new FormData();
    formData.set("file", pdfFile());
    const result = await uploadCurriculumDocument("subj1", formData);
    expect(result).toEqual({
      error:
        "No readable text was found in that PDF. If it's a scanned document (photos of pages rather than typed text), this feature can't read it yet — please record the curriculum content manually instead.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("deleteCurriculumSubStrand", () => {
  beforeEach(() => {
    mockCreateClient.mockClear();
  });

  it("deletes when RLS allows it", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { curriculum_sub_strands: [{ data: [{ id: "ss1" }], error: null }] } }));
    const result = await deleteCurriculumSubStrand("ss1");
    expect(result).toEqual({ success: true });
  });

  it("reports a permission error when RLS silently deletes nothing", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ tables: { curriculum_sub_strands: [{ data: [], error: null }] } }));
    const result = await deleteCurriculumSubStrand("ss1");
    expect(result).toEqual({ error: "You don't have permission to delete this sub-strand, or it no longer exists." });
  });

  it("rejects a missing id without calling Supabase", async () => {
    const result = await deleteCurriculumSubStrand("");
    expect(result).toEqual({ error: "Missing sub-strand." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
