import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  const client = { rpc };
  return { rpc, client, logAdminAction: vi.fn(), revalidatePath: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const {
  recordWhatsAppAgreement,
  withdrawWhatsAppAgreement,
  proposeSalesWhatsApp,
  editSalesWhatsApp,
  reviewSalesWhatsApp,
  withdrawSalesWhatsApp,
  markSalesWhatsAppSent,
  setSalesWhatsAppPromotional,
} = await import("./actions");

const REP = "22222222-2222-4222-8222-222222222222";
const CONSENT = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";
const SCHOOL = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("recordWhatsAppAgreement", () => {
  const good = { phone: "0712 345 678", name: "Jane", schoolName: "Sunrise", how: "call", scope: "service", note: "yes", recordedBy: REP };
  it("rejects bad input before touching the database", async () => {
    expect(await recordWhatsAppAgreement({ ...good, recordedBy: "nope" })).toEqual({ error: "Say who is recording this agreement." });
    expect(await recordWhatsAppAgreement({ ...good, schoolId: "nope" })).toEqual({ error: "Invalid school id." });
    expect(await recordWhatsAppAgreement({ ...good, phone: "abc" })).toEqual({ error: "That is not a usable phone number." });
    expect(await recordWhatsAppAgreement({ ...good, scope: "everything" })).toEqual({ error: "Choose what they agreed to." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("sends the normalised number and audits coded values only (never the number, name or note)", async () => {
    h.rpc.mockResolvedValue({ data: "id", error: null });
    expect(await recordWhatsAppAgreement({ ...good, schoolId: SCHOOL })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_record_whatsapp_consent", {
      p_phone: "254712345678",
      p_name: "Jane",
      p_school_name: "Sunrise",
      p_how: "call",
      p_scope: "service",
      p_note: "yes",
      p_school_id: SCHOOL,
      p_recorded_by: REP,
    });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "record_whatsapp_agreement", { how: "call", scope: "service", school_id: SCHOOL });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toMatch(/254712|Jane|yes/);
  });
  it("returns the database message when a rule refuses", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "This number has opted out of WhatsApp messages and cannot be added again." } });
    expect(await recordWhatsAppAgreement(good)).toEqual({ error: "This number has opted out of WhatsApp messages and cannot be added again." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("proposeSalesWhatsApp / editSalesWhatsApp", () => {
  it("validates the text before calling the database", async () => {
    const base = { consentId: CONSENT, kind: "service", body: "Hello", proposedBy: REP };
    expect(await proposeSalesWhatsApp({ ...base, consentId: "nope" })).toEqual({ error: "Invalid agreement id." });
    expect(await proposeSalesWhatsApp({ ...base, proposedBy: "nope" })).toEqual({ error: "Say who is proposing this message." });
    expect(await proposeSalesWhatsApp({ ...base, body: "Hi {{name}}" })).toMatchObject({ error: expect.stringContaining("placeholders") });
    expect(await proposeSalesWhatsApp({ ...base, body: "no obligation" })).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("sends trimmed text and audits ids and kind only", async () => {
    h.rpc.mockResolvedValue({ data: "id", error: null });
    expect(await proposeSalesWhatsApp({ consentId: CONSENT, kind: "service", body: "  Secret text  ", proposedBy: REP })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_propose_sales_whatsapp", { p_consent_id: CONSENT, p_kind: "service", p_body: "Secret text", p_proposed_by: REP });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "propose_sales_whatsapp", { consent_id: CONSENT, kind: "service" });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("Secret");
  });
  it("edits with validation", async () => {
    expect(await editSalesWhatsApp("nope", "service", "a")).toEqual({ error: "Invalid message id." });
    expect(await editSalesWhatsApp(MSG, "service", "{{x}}")).toMatchObject({ error: expect.any(String) });
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await editSalesWhatsApp(MSG, "service", " new ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_edit_sales_whatsapp", { p_id: MSG, p_body: "new" });
  });
});

describe("reviewSalesWhatsApp", () => {
  it("requires a reviewer, a valid decision and (to approve) the hash that was shown", async () => {
    expect(await reviewSalesWhatsApp("nope", "approve", HASH, REP)).toEqual({ error: "Invalid message id." });
    expect(await reviewSalesWhatsApp(MSG, "maybe", HASH, REP)).toEqual({ error: "Decision must be approve or reject." });
    expect(await reviewSalesWhatsApp(MSG, "approve", HASH, "nope")).toEqual({ error: "Say who is reviewing this message." });
    expect(await reviewSalesWhatsApp(MSG, "approve", "short", REP)).toEqual({ error: "Reload the page and review the message again." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("passes the hash on approve and null on reject; reports an expired proposal as an error", async () => {
    h.rpc.mockResolvedValue({ data: "approved", error: null });
    expect(await reviewSalesWhatsApp(MSG, "approve", HASH, REP, " ok ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_review_sales_whatsapp", { p_id: MSG, p_decision: "approve", p_expected_hash: HASH, p_reviewed_by: REP, p_note: "ok" });
    h.rpc.mockResolvedValue({ data: "rejected", error: null });
    expect(await reviewSalesWhatsApp(MSG, "reject", "", REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_review_sales_whatsapp", { p_id: MSG, p_decision: "reject", p_expected_hash: null, p_reviewed_by: REP, p_note: null });
    h.rpc.mockResolvedValue({ data: "expired", error: null });
    expect(await reviewSalesWhatsApp(MSG, "approve", HASH, REP)).toEqual({ error: "This proposal is more than 7 days old and has expired. Propose it again." });
  });
});

describe("markSalesWhatsAppSent", () => {
  it("requires a named sender", async () => {
    expect(await markSalesWhatsAppSent("nope", REP)).toEqual({ error: "Invalid message id." });
    expect(await markSalesWhatsAppSent(MSG, "nope")).toEqual({ error: "Say who sent this message." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("records the mark, and treats a refusal from the database as an error that is not audited as sent", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await markSalesWhatsAppSent(MSG, REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_mark_sales_whatsapp_sent", { p_id: MSG, p_sent_by: REP });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "mark_sales_whatsapp_sent", { message_id: MSG });

    h.logAdminAction.mockReset();
    h.rpc.mockResolvedValueOnce({ data: { ok: false, message: "The approval expired after 24 hours. Propose the message again." }, error: null });
    expect(await markSalesWhatsAppSent(MSG, REP)).toEqual({ error: "The approval expired after 24 hours. Propose the message again." });
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await markSalesWhatsAppSent(MSG, REP)).toEqual({ error: "The message could not be marked as sent." });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await markSalesWhatsAppSent(MSG, REP)).toEqual({ error: "boom" });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("withdraw and switch", () => {
  it("withdraws a message and an agreement by id, the latter with a named person", async () => {
    expect(await withdrawSalesWhatsApp("nope")).toEqual({ error: "Invalid message id." });
    expect(await withdrawWhatsAppAgreement("nope", REP)).toEqual({ error: "Invalid agreement id." });
    expect(await withdrawWhatsAppAgreement(CONSENT, "nope")).toEqual({ error: "Say who is withdrawing this agreement." });
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await withdrawSalesWhatsApp(MSG)).toEqual({ success: true });
    expect(await withdrawWhatsAppAgreement(CONSENT, REP, " asked to stop ")).toEqual({ success: true });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_withdraw_whatsapp_consent", { p_consent_id: CONSENT, p_withdrawn_by: REP, p_note: "asked to stop" });
  });
  it("changes the promotional switch only with a named person, and audits the value", async () => {
    expect(await setSalesWhatsAppPromotional(true, "nope")).toEqual({ error: "Say who you are before changing this switch." });
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await setSalesWhatsAppPromotional(true, REP)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_set_sales_whatsapp_settings", { p_promotional: true, p_updated_by: REP });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "set_sales_whatsapp_promotional", { enabled: true });
  });
});
