import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveReportFormLayout } = await import("./report-form-actions");

const empty = { title: null, subtitle: null, footerNote: null, classTeacherLabel: null, headTeacherLabel: null, parentLabel: null };
function client(opts: { user?: unknown; rpcError?: { code?: string; message: string } | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user } }) }, rpc }, rpc };
}
beforeEach(() => vi.clearAllMocks());

describe("saveReportFormLayout", () => {
  it("rejects malformed or invalid input before touching Supabase", async () => {
    expect(await saveReportFormLayout(null as never)).toEqual({ error: "Invalid report form." });
    expect(await saveReportFormLayout({ ...empty, title: 5 } as never)).toEqual({ error: "Invalid report form." });
    expect(await saveReportFormLayout({ ...empty, title: "x".repeat(61) })).toMatchObject({ error: expect.stringMatching(/60/) });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).c);
    expect(await saveReportFormLayout(empty)).toEqual({ error: "You must be signed in." });
  });
  it("saves only through save_report_form_layout, sending blanks for unset fields", async () => {
    const { c, rpc } = client();
    mockCreateClient.mockResolvedValue(c);
    expect(await saveReportFormLayout({ ...empty, title: "Progress Report", parentLabel: "Guardian" })).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_report_form_layout", {
      p_title: "Progress Report", p_subtitle: "", p_footer_note: "", p_class_teacher_label: "", p_head_teacher_label: "", p_parent_label: "Guardian",
    });
  });
  it("maps database refusals to friendly messages", async () => {
    mockCreateClient.mockResolvedValue(client({ rpcError: { code: "42501", message: "x" } }).c);
    expect(await saveReportFormLayout(empty)).toMatchObject({ error: expect.stringMatching(/permission/i) });
    mockCreateClient.mockResolvedValue(client({ rpcError: { code: "55000", message: "x" } }).c);
    expect(await saveReportFormLayout(empty)).toMatchObject({ error: expect.stringMatching(/not enabled/i) });
    mockCreateClient.mockResolvedValue(client({ rpcError: { code: "XX", message: "boom secret" } }).c);
    const r = await saveReportFormLayout(empty);
    expect(r).toMatchObject({ error: expect.stringMatching(/try again/i) });
    expect(JSON.stringify(r)).not.toContain("boom secret");
  });
});
