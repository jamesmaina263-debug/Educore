import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateReportSettings } = await import("./report-settings-actions");

const valid = { rankingEnabled: false, showCompetencyRatings: true, showSignatures: true, showClassStatistics: true, showAttendance: true, showHeadTeacherComment: true, showParentAcknowledgement: false };
function client(opts: { user?: unknown; rpcError?: { message: string } | null } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const from = vi.fn();
  return { c: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user === undefined ? { id: "u1" } : opts.user } }) }, rpc, from }, rpc, from };
}
beforeEach(() => vi.clearAllMocks());

describe("updateReportSettings", () => {
  it("rejects malformed input before touching Supabase", async () => {
    expect(await updateReportSettings({ ...valid, rankingEnabled: "no" } as never)).toEqual({ error: "Invalid report settings." });
    expect(await updateReportSettings({ rankingEnabled: true } as never)).toEqual({ error: "Invalid report settings." });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
  it("requires a signed-in user", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).c);
    expect(await updateReportSettings(valid)).toEqual({ error: "You must be signed in." });
  });
  it("saves only through the update_report_settings function, with the stored key names", async () => {
    const { c, rpc, from } = client();
    mockCreateClient.mockResolvedValue(c);
    expect(await updateReportSettings(valid)).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("update_report_settings", {
      p_settings: {
        ranking_enabled: false,
        show_competency_ratings: true,
        show_signatures: true,
        show_class_statistics: true,
        show_attendance: true,
        show_head_teacher_comment: true,
        show_parent_acknowledgement: false,
      },
    });
    expect(from).not.toHaveBeenCalled(); // never writes schools directly (that would need branding permission)
  });
  it("maps a database permission failure to a friendly message", async () => {
    mockCreateClient.mockResolvedValue(client({ rpcError: { message: "Not authorized to change report settings." } }).c);
    expect(await updateReportSettings(valid)).toEqual({ error: "You don't have permission to change report settings." });
  });
  it("hides other database errors behind a generic message", async () => {
    mockCreateClient.mockResolvedValue(client({ rpcError: { message: "boom: internal detail" } }).c);
    const r = await updateReportSettings(valid);
    expect(r).toEqual({ error: "Could not save report settings. Please try again." });
  });
});
