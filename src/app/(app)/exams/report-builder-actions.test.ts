import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
const mockHasFlag = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ hasFeatureFlag: mockHasFlag }));

const { runCustomReport } = await import("./report-builder-actions");

const UUID = "11111111-1111-4111-8111-111111111111";

// Chainable query double: every builder method returns itself, awaiting it resolves to { data, error }.
function query(data: unknown[], error: { message: string } | null = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "range"]) q[m] = vi.fn(() => q);
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(res);
  return q;
}
function client(opts: { user?: unknown; allowed?: boolean; rows?: unknown[]; error?: { message: string } | null } = {}) {
  const from = vi.fn(() => query(opts.rows ?? [], opts.error ?? null));
  const rpc = vi.fn().mockResolvedValue({ data: opts.allowed ?? true });
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user } }) }, rpc, from }, from, rpc };
}
const learner = { admission_number: "1", first_name: "Amy", other_names: null, last_name: "Abel", gender: "F", status: "active", admission_date: null, streams: { name: "A", classes: { name: "Grade 6" } } };
beforeEach(() => {
  vi.clearAllMocks();
  mockHasFlag.mockResolvedValue(true);
});

describe("runCustomReport", () => {
  it("rejects bad input before touching Supabase", async () => {
    expect(await runCustomReport({ dataset: "payments", columns: ["x"] })).toEqual({ error: "Choose a report type." });
    expect(await runCustomReport({ dataset: "learners", columns: [] })).toEqual({ error: "Choose at least one column." });
    expect(await runCustomReport({ dataset: "learners", columns: ["date_of_birth"] })).toMatchObject({ error: expect.stringMatching(/not available/) });
    expect(await runCustomReport({ dataset: "learners", columns: ["last_name"], streamId: "x; drop table" })).toEqual({ error: "Invalid class." });
    expect(await runCustomReport({ dataset: "marks", columns: ["score"] })).toEqual({ error: "Choose an exam." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("requires sign-in, the flag and the matching permission, and reads no data otherwise", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).c);
    expect(await runCustomReport({ dataset: "learners", columns: ["last_name"] })).toEqual({ error: "You must be signed in." });

    mockHasFlag.mockResolvedValue(false);
    const off = client();
    mockCreateClient.mockResolvedValue(off.c);
    expect(await runCustomReport({ dataset: "learners", columns: ["last_name"] })).toMatchObject({ error: expect.stringMatching(/not enabled/) });
    expect(off.from).not.toHaveBeenCalled();

    mockHasFlag.mockResolvedValue(true);
    const denied = client({ allowed: false });
    mockCreateClient.mockResolvedValue(denied.c);
    expect(await runCustomReport({ dataset: "learners", columns: ["last_name"] })).toMatchObject({ error: expect.stringMatching(/permission/) });
    expect(denied.from).not.toHaveBeenCalled();
  });
  it("checks students.read for learners and exams.read for marks", async () => {
    const a = client({ rows: [learner] });
    mockCreateClient.mockResolvedValue(a.c);
    await runCustomReport({ dataset: "learners", columns: ["last_name"] });
    expect(a.rpc).toHaveBeenCalledWith("auth_has_permission", { p_permission_key: "students.read" });
    const b = client({ rows: [] });
    mockCreateClient.mockResolvedValue(b.c);
    await runCustomReport({ dataset: "marks", columns: ["score"], examId: UUID });
    expect(b.rpc).toHaveBeenCalledWith("auth_has_permission", { p_permission_key: "exams.read" });
  });
  it("returns a CSV with only the chosen columns", async () => {
    mockCreateClient.mockResolvedValue(client({ rows: [learner] }).c);
    const r = await runCustomReport({ dataset: "learners", columns: ["last_name", "class"] });
    expect("csv" in r).toBe(true);
    if ("csv" in r) {
      expect(r.rows).toBe(1);
      expect(r.truncated).toBe(false);
      expect(r.csv).toContain("Last name");
      expect(r.csv).toContain("Abel");
      expect(r.csv).toContain("Grade 6 A");
      expect(r.csv).not.toContain("Amy");
    }
  });
  it("reports an empty result and a failed query without leaking details", async () => {
    mockCreateClient.mockResolvedValue(client({ rows: [] }).c);
    expect(await runCustomReport({ dataset: "learners", columns: ["last_name"] })).toEqual({ error: "No rows match these choices." });
    mockCreateClient.mockResolvedValue(client({ error: { message: "secret db detail" } }).c);
    const r = await runCustomReport({ dataset: "learners", columns: ["last_name"] });
    expect(r).toEqual({ error: "Could not build the report. Please try again." });
  });
});
