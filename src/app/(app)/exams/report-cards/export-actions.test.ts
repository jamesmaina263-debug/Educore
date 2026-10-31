import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: { id: "auth-1" } as { id: string } | null, model: { kind: "numeric" } as unknown, load: vi.fn() }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/academics/load-mark-sheet", () => ({ loadMarkSheetModel: h.load }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: "Ms Teacher" } }) }) }) }),
  }),
}));

const { getMarkSheetModel } = await import("./export-actions");
const EXAM = "11111111-1111-4111-8111-111111111111";
const CLASS = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.user = { id: "auth-1" };
  h.load.mockReset();
  h.load.mockResolvedValue(h.model);
});

describe("getMarkSheetModel", () => {
  it("loads the model for the signed-in user, stamped with their name", async () => {
    expect(await getMarkSheetModel(EXAM, CLASS)).toEqual({ model: h.model });
    expect(h.load).toHaveBeenCalledWith(expect.anything(), { examId: EXAM, classId: CLASS, preparedBy: "Ms Teacher" });
  });
  it("rejects malformed ids and signed-out callers without loading anything", async () => {
    expect(await getMarkSheetModel("nope", CLASS)).toEqual({ error: "Invalid request." });
    h.user = null;
    expect(await getMarkSheetModel(EXAM, CLASS)).toEqual({ error: "Your session has expired. Please sign in again." });
    expect(h.load).not.toHaveBeenCalled();
  });
  it("reports an empty class and a thrown load as errors, not a crash", async () => {
    h.load.mockResolvedValueOnce(null);
    expect(await getMarkSheetModel(EXAM, CLASS)).toEqual({ error: "Nothing to export for this class and exam." });
    h.load.mockRejectedValueOnce(new Error("boom"));
    expect(await getMarkSheetModel(EXAM, CLASS)).toEqual({ error: "Couldn't prepare the export. Please try again." });
  });
});
