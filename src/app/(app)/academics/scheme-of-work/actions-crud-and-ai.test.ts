import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Why this file didn't already exist (Phase 4 "verification gaps" item):
// actions.ts imports createClient from @/lib/supabase/server, which imports
// next/headers -- and next/headers enforces a "this module can only be used
// from a Server Component" guard the moment it's imported outside Next's own
// React Server Component runtime, vitest included. Importing actions.ts
// directly in a plain vitest/node run throws immediately, before a single
// test even runs -- confirmed by trying it against this exact file, not
// assumed. That's the real, structural reason no "use server" action
// anywhere in this repo has a test yet, not an oversight.
//
// The fix: vi.mock() rewrites the module graph before anything is imported,
// so as long as every module that pulls in next/headers (or the
// "server-only" package) transitively -- @/lib/supabase/server,
// @/lib/supabase/admin -- is mocked, the real files are never loaded and the
// guard never fires. @/lib/observability/sentry-context and next/cache are
// mocked too, purely so tests aren't coupled to Sentry/Next-cache behavior
// that has nothing to do with what's being tested here. (moveSchemeEntry
// already has its own dedicated test file using this exact same technique,
// landed in parallel as PR #457 -- this file covers every other action in
// actions.ts and deliberately doesn't duplicate that coverage.)
//
// Scope, stated plainly: this covers input validation and permission-check
// short-circuits -- the "at minimum" bar the Phase 4 prompt asked for. It
// does NOT cover the actual Supabase read/write logic, RLS-enforced
// authorization (a teacher can't touch another teacher's scheme -- that's a
// database-level guarantee, not application code, and needs a real Postgres
// instance with real RLS policies to test, which this mock-based approach
// deliberately cannot provide), or AI-response handling (already covered by
// the pure-function tests in scheme-of-work.test.ts). The mocking pattern
// here is generic enough to reuse for other "use server" action files, but
// extending it to other modules is future work, not done in this pass.
// ---------------------------------------------------------------------------

const mockCreateClient = vi.fn();
const mockCreateAdminClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  addSchemeEntry,
  updateSchemeEntry,
  deleteSchemeEntry,
  duplicateSchemeEntry,
  toggleEntryComplete,
  submitScheme,
  startSchemeReview,
  generateSchemeWithAI,
  assistSchemeEntry,
  createManualScheme,
} = await import("./actions");

// A chainable stand-in for a PostgREST query builder: every property access
// (select/eq/order/insert/update/delete/...) returns the same proxy so any
// chain shape works, and awaiting/`.then`-ing it resolves to whatever result
// this particular test configured -- the caller only cares about the final
// { data, error }, never the exact chain used to get there.
function chain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

function fakeClient(opts: {
  user?: { id: string } | null;
  rpc?: Record<string, unknown>;
  from?: Record<string, unknown>;
}) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user ?? null } }) },
    rpc: vi.fn((name: string) => Promise.resolve({ data: opts.rpc?.[name] ?? null })),
    from: vi.fn((table: string) => opts.from?.[table] ?? chain()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const validEntry = {
  scheme_id: "11111111-1111-1111-1111-111111111111",
  week_number: 1,
  lesson_number: 1,
  entry_date: "",
  topic: "Photosynthesis",
  subtopic: "",
  learning_outcomes: "",
  content: "",
  activities: "",
  teaching_methods: "",
  resources: "",
  assessment_methods: "",
  references: "",
  remarks: "",
};

describe("addSchemeEntry / updateSchemeEntry validation", () => {
  it("rejects a missing scheme_id without touching Supabase", async () => {
    const result = await addSchemeEntry({ ...validEntry, scheme_id: "" });
    expect(result).toEqual({ error: "Missing scheme." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it.each([0, -1, 53, 1.5])("rejects an invalid week_number of %s", async (week_number) => {
    const result = await addSchemeEntry({ ...validEntry, week_number: week_number as number });
    expect(result).toEqual({ error: "Invalid week number." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it.each([0, -1, 21, 2.5])("rejects an invalid lesson_number of %s", async (lesson_number) => {
    const result = await addSchemeEntry({ ...validEntry, lesson_number: lesson_number as number });
    expect(result).toEqual({ error: "Invalid lesson number." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects a blank topic", async () => {
    const result = await addSchemeEntry({ ...validEntry, topic: "   " });
    expect(result).toEqual({ error: "A topic is required." });
  });

  it("rejects an unparseable entry_date", async () => {
    const result = await addSchemeEntry({ ...validEntry, entry_date: "not-a-date" });
    expect(result).toEqual({ error: "Invalid entry date." });
  });

  it("accepts a blank entry_date (optional field)", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ from: { scheme_of_work_entries: chain({ data: { id: "e1" }, error: null }) } }));
    const result = await addSchemeEntry({ ...validEntry, entry_date: "" });
    expect(result).toEqual({ success: true, entryId: "e1" });
  });

  it("updateSchemeEntry rejects a missing entryId before running the same validation", async () => {
    const result = await updateSchemeEntry("", validEntry);
    expect(result).toEqual({ error: "Missing entry." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("updateSchemeEntry runs the same field validation as addSchemeEntry", async () => {
    const result = await updateSchemeEntry("11111111-1111-1111-1111-111111111111", { ...validEntry, topic: "" });
    expect(result).toEqual({ error: "A topic is required." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe("entry-id-only actions reject a missing id before touching Supabase", () => {
  it("deleteSchemeEntry", async () => {
    expect(await deleteSchemeEntry("")).toEqual({ error: "Missing entry." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("duplicateSchemeEntry", async () => {
    expect(await duplicateSchemeEntry("", { week_number: 2, lesson_number: 1 })).toEqual({ error: "Missing entry." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("toggleEntryComplete", async () => {
    expect(await toggleEntryComplete("", true)).toEqual({ error: "Missing entry." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("submitScheme", async () => {
    expect(await submitScheme("")).toEqual({ error: "Missing scheme." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("startSchemeReview", async () => {
    expect(await startSchemeReview("")).toEqual({ error: "Missing scheme." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

// moveSchemeEntry itself is covered by its own dedicated, more thorough
// test file (actions.test.ts, PR #457, already on main) -- not duplicated
// here.

const validGenerateInput = {
  academic_year_id: "11111111-1111-1111-1111-111111111111",
  term_id: "22222222-2222-2222-2222-222222222222",
  class_id: "33333333-3333-3333-3333-333333333333",
  stream_id: null,
  subject_id: "44444444-4444-4444-4444-444444444444",
  total_weeks: 13,
  lessons_per_week: 3,
  curriculum_framework: null,
  idempotency_key: "55555555-5555-5555-5555-555555555555",
};

describe("generateSchemeWithAI validation (no GEMINI_API_KEY dependency on Supabase)", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("fails fast when GEMINI_API_KEY is not configured, before validating anything else", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await generateSchemeWithAI({ ...validGenerateInput, academic_year_id: "" });
    expect(result).toEqual({ error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." });
    expect(mockCreateClient).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("rejects missing academic_year_id/term_id/class_id/subject_id/idempotency_key", async () => {
    for (const field of ["academic_year_id", "term_id", "class_id", "subject_id", "idempotency_key"] as const) {
      const result = await generateSchemeWithAI({ ...validGenerateInput, [field]: "" });
      expect(result).toEqual({ error: "Please select the academic year, term, class and subject before generating the scheme." });
    }
    expect(mockCreateClient).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it.each([0, -1, 53, 2.5])("rejects an invalid total_weeks of %s", async (total_weeks) => {
    const result = await generateSchemeWithAI({ ...validGenerateInput, total_weeks: total_weeks as number });
    expect(result).toEqual({ error: "Please enter a valid number of teaching weeks (1–52)." });
    process.env.GEMINI_API_KEY = originalKey;
  });

  it.each([0, -1, 21, 1.5])("rejects an invalid lessons_per_week of %s", async (lessons_per_week) => {
    const result = await generateSchemeWithAI({ ...validGenerateInput, lessons_per_week: lessons_per_week as number });
    expect(result).toEqual({ error: "Please enter a valid number of lessons per week (1–20)." });
    process.env.GEMINI_API_KEY = originalKey;
  });
});

describe("generateSchemeWithAI permission check", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: null }));
    const result = await generateSchemeWithAI(validGenerateInput);
    expect(result).toEqual({ error: "You must be signed in." });
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("requires the scheme_of_work.generate_ai permission", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient({ user: { id: "u1" }, rpc: { auth_has_permission: false } }),
    );
    const result = await generateSchemeWithAI(validGenerateInput);
    expect(result).toEqual({ error: "You don't have permission to generate a scheme with AI." });
    process.env.GEMINI_API_KEY = originalKey;
  });
});

describe("assistSchemeEntry validation and permission check", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("fails fast when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await assistSchemeEntry({ entry_id: "", mode: "improve", idempotency_key: "" });
    expect(result).toEqual({ error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." });
    expect(mockCreateClient).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("rejects a missing entry_id or idempotency_key", async () => {
    const noEntry = await assistSchemeEntry({ entry_id: "", mode: "improve", idempotency_key: "k" });
    expect(noEntry).toEqual({ error: "Missing lesson entry." });
    const noKey = await assistSchemeEntry({ entry_id: "e1", mode: "improve", idempotency_key: "" });
    expect(noKey).toEqual({ error: "Missing lesson entry." });
    expect(mockCreateClient).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("rejects an invalid mode", async () => {
    // @ts-expect-error deliberately invalid mode to exercise the runtime guard
    const result = await assistSchemeEntry({ entry_id: "e1", mode: "delete_everything", idempotency_key: "k" });
    expect(result).toEqual({ error: "Invalid AI Assist option." });
    expect(mockCreateClient).not.toHaveBeenCalled();
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: null }));
    const result = await assistSchemeEntry({ entry_id: "e1", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "You must be signed in." });
    process.env.GEMINI_API_KEY = originalKey;
  });

  it("requires the scheme_of_work.generate_ai permission", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: { id: "u1" }, rpc: { auth_has_permission: false } }));
    const result = await assistSchemeEntry({ entry_id: "e1", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "You don't have permission to use AI Assist." });
    process.env.GEMINI_API_KEY = originalKey;
  });
});

describe("startSchemeReview permission check", () => {
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: null }));
    const result = await startSchemeReview("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ error: "You must be signed in." });
  });

  it("requires the scheme_of_work.review permission", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: { id: "u1" }, rpc: { auth_has_permission: false } }));
    const result = await startSchemeReview("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ error: "You don't have permission to review schemes." });
  });

  it("only advances a scheme that is currently 'submitted' (guarded update returns no row)", async () => {
    mockCreateClient.mockResolvedValue(
      fakeClient({
        user: { id: "u1" },
        rpc: { auth_has_permission: true },
        from: { schemes_of_work: chain({ data: null, error: null }) },
      }),
    );
    const result = await startSchemeReview("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({ error: "This scheme isn't awaiting review, or it no longer exists." });
  });
});

describe("createManualScheme validation", () => {
  const validManual = {
    academic_year_id: "11111111-1111-1111-1111-111111111111",
    term_id: "22222222-2222-2222-2222-222222222222",
    class_id: "33333333-3333-3333-3333-333333333333",
    stream_id: null,
    subject_id: "44444444-4444-4444-4444-444444444444",
    total_weeks: 13,
    lessons_per_week: 3,
  };

  it("rejects missing required ids without touching Supabase", async () => {
    const result = await createManualScheme({ ...validManual, class_id: "" });
    expect(result).toEqual({ error: "Please select the academic year, term, class and subject." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it.each([0, -1, 53])("rejects an invalid total_weeks of %s", async (total_weeks) => {
    const result = await createManualScheme({ ...validManual, total_weeks });
    expect(result).toEqual({ error: "Please enter a valid number of teaching weeks (1–52)." });
  });

  it.each([0, -1, 21])("rejects an invalid lessons_per_week of %s", async (lessons_per_week) => {
    const result = await createManualScheme({ ...validManual, lessons_per_week });
    expect(result).toEqual({ error: "Please enter a valid number of lessons per week (1–20)." });
  });

  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(fakeClient({ user: null }));
    const result = await createManualScheme(validManual);
    expect(result).toEqual({ error: "You must be signed in." });
  });
});
