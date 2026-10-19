import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const invoke = vi.fn();
  const getSession = vi.fn();
  const client = { rpc, functions: { invoke }, auth: { getSession } };
  return { rpc, invoke, getSession, client, logAdminAction: vi.fn(), revalidatePath: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("@/lib/edge-function-error", () => ({ extractEdgeFunctionError: async (_e: unknown, fallback: string) => fallback }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const { proposeTrialNudge, editTrialNudge, reviewTrialNudge, withdrawTrialNudge, sendTrialNudge, checkTrialNudge, setTrialNudgeSettings } =
  await import("./actions");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";
const NUDGE = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

beforeEach(() => {
  h.rpc.mockReset();
  h.invoke.mockReset();
  h.getSession.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
  h.getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
});

describe("proposeTrialNudge", () => {
  const good = { schoolId: SCHOOL, kind: "service", subject: "Hi {{school}}", body: "Hello {{name}}", proposedBy: REP };

  it("rejects bad input before touching the database", async () => {
    expect(await proposeTrialNudge({ ...good, schoolId: "nope" })).toEqual({ error: "Invalid school id." });
    expect(await proposeTrialNudge({ ...good, proposedBy: "nope" })).toEqual({ error: "Say who is proposing this message." });
    expect(await proposeTrialNudge({ ...good, kind: "banner" })).toEqual({ error: "Choose service or promotional." });
    expect(await proposeTrialNudge({ ...good, body: "We offer no obligation" })).toMatchObject({ error: expect.stringContaining("no obligation") });
    expect(await proposeTrialNudge({ ...good, body: "See https://bit.ly/x" })).toMatchObject({ error: expect.stringContaining("bit.ly") });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("sends trimmed text and audits ids and kind only (never the text)", async () => {
    h.rpc.mockResolvedValue({ data: "id", error: null });
    expect(await proposeTrialNudge({ ...good, subject: "  Secret subject  ", body: "  Secret body  " })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_propose_trial_nudge", {
      p_school_id: SCHOOL,
      p_kind: "service",
      p_subject: "Secret subject",
      p_body: "Secret body",
      p_proposed_by: REP,
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "propose_trial_nudge", { school_id: SCHOOL, kind: "service" });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("Secret");
  });

  it("returns the database message when a rule refuses", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "This school asked not to be contacted." } });
    expect(await proposeTrialNudge(good)).toEqual({ error: "This school asked not to be contacted." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("editTrialNudge / withdrawTrialNudge / setTrialNudgeSettings", () => {
  it("validates before calling and passes trimmed text", async () => {
    expect(await editTrialNudge("nope", "service", "a", "b")).toEqual({ error: "Invalid message id." });
    expect(await editTrialNudge(NUDGE, "service", "a", "no obligation")).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await editTrialNudge(NUDGE, "service", " a ", " b ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_edit_trial_nudge", { p_id: NUDGE, p_subject: "a", p_body: "b" });
  });
  it("withdraws by id", async () => {
    expect(await withdrawTrialNudge("nope")).toEqual({ error: "Invalid message id." });
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await withdrawTrialNudge(NUDGE)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_withdraw_trial_nudge", { p_id: NUDGE });
  });
  it("changes the switches only with a named person, and audits the values", async () => {
    expect(await setTrialNudgeSettings(true, false, "nope")).toEqual({ error: "Say who you are before changing these switches." });
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await setTrialNudgeSettings(true, false, REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_set_trial_nudge_settings", { p_sending: true, p_promotional: false, p_updated_by: REP });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "set_trial_nudge_settings", { sending: true, promotional: false });
  });
});

describe("reviewTrialNudge", () => {
  it("requires a reviewer, a valid decision and (to approve) the hash that was shown", async () => {
    expect(await reviewTrialNudge("nope", "approve", HASH, REP)).toEqual({ error: "Invalid message id." });
    expect(await reviewTrialNudge(NUDGE, "maybe", HASH, REP)).toEqual({ error: "Decision must be approve or reject." });
    expect(await reviewTrialNudge(NUDGE, "approve", HASH, "nope")).toEqual({ error: "Say who is reviewing this message." });
    expect(await reviewTrialNudge(NUDGE, "approve", "short", REP)).toEqual({ error: "Reload the page and review the message again." });
    expect(await reviewTrialNudge(NUDGE, "reject", "", REP, "x".repeat(501))).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("passes the hash on approve and null on reject", async () => {
    h.rpc.mockResolvedValue({ data: "approved", error: null });
    expect(await reviewTrialNudge(NUDGE, "approve", HASH, REP, "  ok  ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_review_trial_nudge", { p_id: NUDGE, p_decision: "approve", p_expected_hash: HASH, p_reviewed_by: REP, p_note: "ok" });
    h.rpc.mockResolvedValue({ data: "rejected", error: null });
    expect(await reviewTrialNudge(NUDGE, "reject", "", REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_review_trial_nudge", { p_id: NUDGE, p_decision: "reject", p_expected_hash: null, p_reviewed_by: REP, p_note: null });
  });
  it("reports an expired proposal as an error, not a success", async () => {
    h.rpc.mockResolvedValue({ data: "expired", error: null });
    expect(await reviewTrialNudge(NUDGE, "approve", HASH, REP)).toEqual({ error: "This proposal is more than 7 days old and has expired. Propose it again." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("sendTrialNudge", () => {
  it("never calls the send function when the database refuses to queue", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: false, message: "Sending trial messages is switched off." }, error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "Sending trial messages is switched off." });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it("never calls the send function when the queue call itself errors or returns nothing usable", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "boom" });
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "The message could not be queued." });
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it("queues, sends through the existing campaign function with the admin's session, then reads the result back", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: { sent: 1, failed: 0, remaining: 0 }, error: null });
    h.rpc.mockResolvedValueOnce({ data: "sent", error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ success: true, status: "sent" });
    expect(h.invoke).toHaveBeenCalledWith("send-owner-campaign", { body: { campaign_id: CAMPAIGN }, headers: { Authorization: "Bearer jwt" } });
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["admin_queue_trial_nudge", "admin_finalize_trial_nudge"]);
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "send_trial_nudge", { nudge_id: NUDGE, status: "sent" });
  });
  it("reads the outcome back even when the send function fails, and reports the failure", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: null, error: new Error("edge down") });
    h.rpc.mockResolvedValueOnce({ data: "queued", error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "Failed to send the message." });
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(["admin_queue_trial_nudge", "admin_finalize_trial_nudge"]);
  });
  it("reports a failed delivery and a still-sending message differently, and an error body from the function", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: { sent: 0, failed: 1, remaining: 0 }, error: null });
    h.rpc.mockResolvedValueOnce({ data: "failed", error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "The email could not be sent. The reason is shown on the message." });
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: null, error: null });
    h.rpc.mockResolvedValueOnce({ data: "queued", error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "Still sending. Use Check status in a moment." });
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: { error: "RESEND_API_KEY is not configured." }, error: null });
    h.rpc.mockResolvedValueOnce({ data: "queued", error: null });
    expect(await sendTrialNudge(NUDGE)).toEqual({ error: "RESEND_API_KEY is not configured." });
  });
  it("audits only ids and the coded status (never an address, subject or body)", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true, campaign_id: CAMPAIGN }, error: null });
    h.invoke.mockResolvedValue({ data: {}, error: null });
    h.rpc.mockResolvedValueOnce({ data: "sent", error: null });
    await sendTrialNudge(NUDGE);
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toMatch(/@|subject|body/);
  });
});

describe("checkTrialNudge", () => {
  it("re-reads the outcome of a queued message", async () => {
    expect(await checkTrialNudge("nope")).toEqual({ error: "Invalid message id." });
    h.rpc.mockResolvedValue({ data: "sent", error: null });
    expect(await checkTrialNudge(NUDGE)).toEqual({ success: true, status: "sent" });
    expect(h.rpc).toHaveBeenCalledWith("admin_finalize_trial_nudge", { p_id: NUDGE });
  });
});
