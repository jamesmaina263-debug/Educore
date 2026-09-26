import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Closes part of the "no automated tests exist for the server actions or RLS
// policies" verification gap flagged across Phases 1-3. This file merges two
// independent passes at that gap (this branch, and PR #457's
// moveSchemeEntry-focused tests) rather than picking one over the other --
// PR #457's call-shape assertions (exact .update() payload, "from() never
// called" on validation failure) are a level of rigor worth keeping, folded
// into the broader mock/coverage here. Scope, stated plainly:
//
// - COVERS: input-validation guard clauses (the checks that run before any
//   Supabase call) across every exported action in this file; the signed-in/
//   permission-check branches for a representative subset of actions; the
//   exact database call shape for moveSchemeEntry specifically (which
//   columns actually get written, and that nothing is touched when
//   validation fails); and how addSchemeEntry/updateSchemeEntry/
//   moveSchemeEntry react to what an RLS-blocked write looks like. All via
//   a lightweight hand-rolled Supabase mock (see makeSupabaseMock below) --
//   no real database involved.
// - DOES NOT COVER: RLS policies themselves. Whether Postgres actually
//   enforces the tenant/ownership boundaries these actions rely on (e.g.
//   "a teacher can't update another teacher's scheme_of_work_entries row")
//   is NOT tested here and can't be, without a real or locally-replicated
//   Postgres instance with this schema's migrations and policies applied --
//   not available in this environment. The "RLS-shaped write rejection"
//   tests below assert that the action *reacts correctly* to the shape of
//   response RLS would produce (a blocked write returning no rows, or a
//   blocked read returning null) -- they do not prove RLS produces that
//   shape in production.
// - Only a representative subset of actions gets the signed-in/permission
//   mock treatment (generateSchemeWithAI, assistSchemeEntry,
//   startSchemeReview, reviewScheme, addSchemeEntry, updateSchemeEntry,
//   moveSchemeEntry), not all ~15 exported actions in this file -- most of
//   the remaining ones follow the identical two-line "get user -> check
//   permission" shape, so the marginal value of repeating the same mock
//   structure ~15 times over is low relative to its cost. Flagging as a
//   reasonable place to stop, not an oversight.
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client not configured in tests");
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { validateEntryInput } from "./_validation";
import {
  createManualScheme,
  saveGeneratedScheme,
  generateSchemeWithAI,
  assistSchemeEntry,
  startSchemeReview,
  reviewScheme,
  submitScheme,
  moveSchemeEntry,
  deleteSchemeEntry,
  duplicateSchemeEntry,
  addSchemeEntry,
  updateSchemeEntry,
} from "./actions";

type ChainResult = { data?: unknown; error?: unknown };
type RecordedCall = { table: string; op: string; args: unknown[] };

/**
 * A minimal stand-in for a supabase-js query builder: every chainable method
 * (select/eq/order/insert/update/delete/upsert) returns the same object,
 * records its own call (table + op + args) into the shared `calls` array so
 * tests can assert on exactly what was sent to the database, and either an
 * explicit terminal call (.single()/.maybeSingle()) or awaiting the chain
 * directly (supabase-js's query builder is itself thenable, and a few call
 * sites here await .insert(...) without a terminal call) resolves to the one
 * fixed result this chain was built with.
 */
function makeChain(table: string, calls: RecordedCall[], result: ChainResult = { data: null, error: null }) {
  const record = (op: string, args: unknown[]) => calls.push({ table, op, args });
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => (record("select", args), chain),
    eq: (...args: unknown[]) => (record("eq", args), chain),
    order: (...args: unknown[]) => (record("order", args), chain),
    insert: (...args: unknown[]) => (record("insert", args), chain),
    update: (...args: unknown[]) => (record("update", args), chain),
    delete: (...args: unknown[]) => (record("delete", args), chain),
    upsert: (...args: unknown[]) => (record("upsert", args), chain),
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: (v: ChainResult) => void) => resolve(result),
  };
  return chain;
}

/**
 * Builds a fake supabase client covering exactly the surface actions.ts
 * uses: auth.getUser(), rpc(name), and from(table) dispatched by table name
 * to a fixed per-table result. `from` is a vi.fn() spy and every chain call
 * is recorded into `calls`, so tests can assert both "which tables/columns
 * were touched" and "was the database touched at all". Good enough for the
 * branches this file tests; not a general-purpose Supabase mock.
 */
function makeSupabaseMock(config: { user?: { id: string } | null; rpc?: Record<string, unknown>; tables?: Record<string, ChainResult> }) {
  const calls: RecordedCall[] = [];
  const from = vi.fn((table: string) => makeChain(table, calls, config.tables?.[table]));
  return {
    auth: { getUser: async () => ({ data: { user: config.user ?? null } }) },
    rpc: async (name: string) => ({ data: config.rpc?.[name] }),
    from,
    calls,
  };
}

function mockSupabase(config: Parameters<typeof makeSupabaseMock>[0]) {
  const client = makeSupabaseMock(config);
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return client;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("validateEntryInput", () => {
  const base = {
    scheme_id: "11111111-1111-1111-1111-111111111111",
    week_number: 1,
    lesson_number: 1,
    entry_date: "",
    topic: "Fractions",
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

  it("accepts a valid entry", () => {
    expect(validateEntryInput(base)).toBeNull();
  });

  it("rejects a missing scheme_id", () => {
    expect(validateEntryInput({ ...base, scheme_id: "" })).toBe("Missing scheme.");
  });

  it.each([0, -1, 53, 1.5])("rejects an invalid week number: %s", (week_number) => {
    expect(validateEntryInput({ ...base, week_number })).toBe("Invalid week number.");
  });

  it.each([0, -1, 21, 2.5])("rejects an invalid lesson number: %s", (lesson_number) => {
    expect(validateEntryInput({ ...base, lesson_number })).toBe("Invalid lesson number.");
  });

  it("rejects a missing topic", () => {
    expect(validateEntryInput({ ...base, topic: "   " })).toBe("A topic is required.");
  });

  it("rejects an unparseable entry_date", () => {
    expect(validateEntryInput({ ...base, entry_date: "not-a-date" })).toBe("Invalid entry date.");
  });

  it("accepts an empty entry_date (optional field)", () => {
    expect(validateEntryInput({ ...base, entry_date: "" })).toBeNull();
  });
});

describe("createManualScheme: input validation (no Supabase call reached)", () => {
  const base = {
    academic_year_id: "11111111-1111-1111-1111-111111111111",
    term_id: "22222222-2222-2222-2222-222222222222",
    class_id: "33333333-3333-3333-3333-333333333333",
    stream_id: null,
    subject_id: "44444444-4444-4444-4444-444444444444",
    total_weeks: 12,
    lessons_per_week: 5,
  };

  it("rejects a missing required id", async () => {
    const result = await createManualScheme({ ...base, subject_id: "" });
    expect(result).toEqual({ error: "Please select the academic year, term, class and subject." });
  });

  it.each([0, -1, 53])("rejects an invalid total_weeks: %s", async (total_weeks) => {
    const result = await createManualScheme({ ...base, total_weeks });
    expect(result).toEqual({ error: "Please enter a valid number of teaching weeks (1–52)." });
  });

  it.each([0, -1, 21])("rejects an invalid lessons_per_week: %s", async (lessons_per_week) => {
    const result = await createManualScheme({ ...base, lessons_per_week });
    expect(result).toEqual({ error: "Please enter a valid number of lessons per week (1–20)." });
  });
});

describe("saveGeneratedScheme: input validation (no Supabase call reached)", () => {
  const base = {
    request_id: null,
    academic_year_id: "a",
    term_id: "b",
    class_id: "c",
    stream_id: null,
    subject_id: "d",
    total_weeks: 1,
    lessons_per_week: 1,
  };

  it("rejects an empty weeks array", async () => {
    const result = await saveGeneratedScheme({ ...base, weeks: [] });
    expect(result).toEqual({ error: "There's nothing to save — generate or add scheme content first." });
  });

  it("rejects a week with no entries", async () => {
    const result = await saveGeneratedScheme({ ...base, weeks: [{ week: 1, entries: [] }] });
    expect(result).toEqual({ error: "We couldn't prepare the scheme correctly. Please try generating it again." });
  });

  it("rejects an entry with no topic", async () => {
    const entry = { lesson: 1, topic: "   ", subtopic: "", learning_outcomes: "", content: "", activities: "", methods: "", resources: "", assessment: "" };
    const result = await saveGeneratedScheme({ ...base, weeks: [{ week: 1, entries: [entry] }] });
    expect(result).toEqual({ error: "We couldn't prepare the scheme correctly. Please try generating it again." });
  });
});

describe("generateSchemeWithAI", () => {
  const base = {
    academic_year_id: "11111111-1111-1111-1111-111111111111",
    term_id: "22222222-2222-2222-2222-222222222222",
    class_id: "33333333-3333-3333-3333-333333333333",
    stream_id: null,
    subject_id: "44444444-4444-4444-4444-444444444444",
    total_weeks: 12,
    lessons_per_week: 5,
    curriculum_framework: null,
  };

  it("refuses when GEMINI_API_KEY isn't configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await generateSchemeWithAI({ ...base, idempotency_key: "key-1" });
    expect(result).toEqual({ error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." });
  });

  it("rejects an invalid total_weeks before touching Supabase", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const result = await generateSchemeWithAI({ ...base, total_weeks: 0, idempotency_key: "key-2" });
    expect(result).toEqual({ error: "Please enter a valid number of teaching weeks (1–52)." });
  });

  it("refuses when no user is signed in", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockSupabase({ user: null });
    const result = await generateSchemeWithAI({ ...base, idempotency_key: "key-3" });
    expect(result).toEqual({ error: "You must be signed in." });
  });

  it("refuses a signed-in user without the generate_ai permission", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockSupabase({ user: { id: "user-1" }, rpc: { auth_has_permission: false } });
    const result = await generateSchemeWithAI({ ...base, idempotency_key: "key-4" });
    expect(result).toEqual({ error: "You don't have permission to generate a scheme with AI." });
  });
});

describe("assistSchemeEntry", () => {
  it("refuses when GEMINI_API_KEY isn't configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await assistSchemeEntry({ entry_id: "e", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "AI generation isn't configured yet — GEMINI_API_KEY is missing from the server environment." });
  });

  it("rejects a missing entry_id before touching Supabase", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const result = await assistSchemeEntry({ entry_id: "", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "Missing lesson entry." });
  });

  it("rejects an invalid mode before touching Supabase", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    // @ts-expect-error -- deliberately invalid mode, mirroring an untrusted client payload
    const result = await assistSchemeEntry({ entry_id: "e", mode: "rewrite_everything", idempotency_key: "k" });
    expect(result).toEqual({ error: "Invalid AI Assist option." });
  });

  it("refuses when no user is signed in", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockSupabase({ user: null });
    const result = await assistSchemeEntry({ entry_id: "e", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "You must be signed in." });
  });

  it("refuses a signed-in user without the generate_ai permission", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    mockSupabase({ user: { id: "user-1" }, rpc: { auth_has_permission: false } });
    const result = await assistSchemeEntry({ entry_id: "e", mode: "improve", idempotency_key: "k" });
    expect(result).toEqual({ error: "You don't have permission to use AI Assist." });
  });
});

describe("startSchemeReview", () => {
  it("rejects a missing schemeId before touching Supabase", async () => {
    expect(await startSchemeReview("")).toEqual({ error: "Missing scheme." });
  });

  it("refuses when no user is signed in", async () => {
    mockSupabase({ user: null });
    expect(await startSchemeReview("scheme-1")).toEqual({ error: "You must be signed in." });
  });

  it("refuses a signed-in user without the review permission", async () => {
    mockSupabase({ user: { id: "user-1" }, rpc: { auth_has_permission: false } });
    expect(await startSchemeReview("scheme-1")).toEqual({ error: "You don't have permission to review schemes." });
  });
});

describe("reviewScheme", () => {
  it("rejects a missing schemeId before touching Supabase", async () => {
    expect(await reviewScheme("", "approve", null)).toEqual({ error: "Missing scheme." });
  });

  it("requires a comment when returning a scheme, before touching Supabase", async () => {
    expect(await reviewScheme("scheme-1", "return", "   ")).toEqual({
      error: "Please add a comment explaining what needs to change before returning it.",
    });
  });

  it("allows an empty comment when approving (falls through to the signed-in check)", async () => {
    mockSupabase({ user: null });
    expect(await reviewScheme("scheme-1", "approve", null)).toEqual({ error: "You must be signed in." });
  });

  it("refuses a signed-in user without the review permission", async () => {
    mockSupabase({ user: { id: "user-1" }, rpc: { auth_has_permission: false } });
    expect(await reviewScheme("scheme-1", "approve", null)).toEqual({ error: "You don't have permission to review schemes." });
  });
});

describe("submitScheme / deleteSchemeEntry / duplicateSchemeEntry: id presence", () => {
  it("submitScheme rejects a missing schemeId", async () => {
    expect(await submitScheme("")).toEqual({ error: "Missing scheme." });
  });

  it("deleteSchemeEntry rejects a missing entryId", async () => {
    expect(await deleteSchemeEntry("")).toEqual({ error: "Missing entry." });
  });

  it("duplicateSchemeEntry rejects a missing entryId", async () => {
    expect(await duplicateSchemeEntry("", { week_number: 1, lesson_number: 1 })).toEqual({ error: "Missing entry." });
  });
});

// Folded in from PR #457 (gap #6), translated onto this file's shared mock
// harness: exact call-shape assertions (which columns actually get written;
// that the database is never touched when validation fails) on top of the
// error-message coverage this file already had for the same shapes via
// addSchemeEntry/updateSchemeEntry below.
describe("moveSchemeEntry", () => {
  it("rejects a missing entry id without touching the database", async () => {
    const client = mockSupabase({});
    const result = await moveSchemeEntry("", { week_number: 2, lesson_number: 1 });
    expect(result).toEqual({ error: "Missing entry." });
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each([
    [{ week_number: 0, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 53, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 1.5, lesson_number: 1 }, "Invalid week number."],
    [{ week_number: 2, lesson_number: 0 }, "Invalid lesson number."],
    [{ week_number: 2, lesson_number: 21 }, "Invalid lesson number."],
  ])("rejects an out-of-range target %o without touching the database", async (target, message) => {
    const client = mockSupabase({});
    const result = await moveSchemeEntry("entry-1", target);
    expect(result).toEqual({ error: message });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("updates only week_number/lesson_number on success, leaving every other column untouched", async () => {
    const client = mockSupabase({ tables: { scheme_of_work_entries: { data: { id: "entry-1" }, error: null } } });
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ success: true, entryId: "entry-1" });

    const update = client.calls.find((c) => c.op === "update");
    expect(update?.args[0]).toEqual({ week_number: 4, lesson_number: 2 });
    const eqTarget = client.calls.find((c) => c.op === "eq");
    expect(eqTarget?.args).toEqual(["id", "entry-1"]);
  });

  it("surfaces the existing-slot conflict as a friendly message", async () => {
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: { code: "23505", message: "duplicate key" } } } });
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "There's already a lesson at that week and lesson number." });
  });

  it("reports a generic failure for any other database error", async () => {
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: { code: "XX000", message: "boom" } } } });
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "Something went wrong while moving. Please try again." });
  });

  it("treats a no-op update (RLS-hidden or already-deleted row) as no permission / not found", async () => {
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: null } } });
    const result = await moveSchemeEntry("entry-1", { week_number: 4, lesson_number: 2 });
    expect(result).toEqual({ error: "You don't have permission to edit this entry, or it no longer exists." });
  });
});

describe("addSchemeEntry / updateSchemeEntry: RLS-shaped write rejection", () => {
  const validInput = {
    scheme_id: "11111111-1111-1111-1111-111111111111",
    week_number: 1,
    lesson_number: 1,
    entry_date: "",
    topic: "Fractions",
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

  it("addSchemeEntry surfaces a permission error when the insert is rejected", async () => {
    // Simulates what an RLS-blocked insert looks like at this call site:
    // Postgres returns an error (not a 23505 conflict), not silently empty data.
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: { code: "42501", message: "permission denied" } } } });
    const result = await addSchemeEntry(validInput);
    expect(result).toEqual({ error: "You don't have permission to edit this scheme, or something went wrong. Please try again." });
  });

  it("addSchemeEntry surfaces a friendly conflict error on a duplicate week/lesson", async () => {
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: { code: "23505" } } } });
    const result = await addSchemeEntry(validInput);
    expect(result).toEqual({ error: "There's already a lesson at that week and lesson number." });
  });

  it("updateSchemeEntry surfaces a not-found/no-permission error when RLS blocks the update (0 rows)", async () => {
    // An RLS-blocked update returns success with 0 rows affected, not an
    // error -- .maybeSingle() then resolves to { data: null, error: null }.
    mockSupabase({ tables: { scheme_of_work_entries: { data: null, error: null } } });
    const result = await updateSchemeEntry("entry-1", validInput);
    expect(result).toEqual({ error: "You don't have permission to edit this entry, or it no longer exists." });
  });

  it("updateSchemeEntry rejects a missing entryId before touching Supabase", async () => {
    expect(await updateSchemeEntry("", validInput)).toEqual({ error: "Missing entry." });
  });
});
