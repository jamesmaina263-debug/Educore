import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveHeadTeacherComment } = await import("./head-comment-actions");

function client(opts: { user?: unknown; rpcError?: { message: string } | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const from = vi.fn();
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user } }) }, rpc, from }, rpc, from };
}
beforeEach(() => vi.clearAllMocks());

describe("saveHeadTeacherComment", () => {
  it("rejects bad input before touching Supabase", async () => {
    expect(await saveHeadTeacherComment("", "x")).toEqual({ error: "Missing report card." });
    expect(await saveHeadTeacherComment("rc1", "x".repeat(1001))).toEqual({ error: "The head teacher comment is limited to 1000 characters." });
    expect(await saveHeadTeacherComment("rc1", 5 as never)).toEqual({ error: "Invalid comment." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).c);
    expect(await saveHeadTeacherComment("rc1", "ok")).toEqual({ error: "You must be signed in." });
  });
  it("saves only through set_report_card_head_comment and never writes the table directly", async () => {
    const { c, rpc, from } = client();
    mockCreateClient.mockResolvedValue(c);
    expect(await saveHeadTeacherComment("rc1", "A pleasure to teach.")).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("set_report_card_head_comment", { p_report_card_id: "rc1", p_comment: "A pleasure to teach." });
    expect(from).not.toHaveBeenCalled();
  });
  it("blank text is passed through so the function can clear the comment", async () => {
    const { c, rpc } = client();
    mockCreateClient.mockResolvedValue(c);
    expect(await saveHeadTeacherComment("rc1", "   ")).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("set_report_card_head_comment", { p_report_card_id: "rc1", p_comment: "   " });
  });
  it("maps database refusals to friendly messages and hides internal details", async () => {
    mockCreateClient.mockResolvedValue(client({ rpcError: { message: "Not authorized to write the head teacher comment." } }).c);
    expect(await saveHeadTeacherComment("rc1", "x")).toEqual({ error: "You don't have permission to write the head teacher comment." });
    mockCreateClient.mockResolvedValue(client({ rpcError: { message: "Report card not found." } }).c);
    expect(await saveHeadTeacherComment("rc1", "x")).toEqual({ error: "Report card not found." });
    mockCreateClient.mockResolvedValue(client({ rpcError: { message: "boom: internal detail" } }).c);
    expect(await saveHeadTeacherComment("rc1", "x")).toEqual({ error: "Could not save the head teacher comment. Please try again." });
  });
});
