import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, client: { rpc }, logAdminAction: vi.fn(), revalidatePath: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/observability/sentry-context", () => ({ tagSentryRequestContext: async () => {} }));
vi.mock("@/lib/log-admin-action", () => ({ logAdminAction: h.logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

const {
  addOnboardingNote,
  resolveOnboardingFollowup,
  triggerOnboardingFollowup,
  saveOnboardingSettings,
  approveOnboardingTemplates,
  saveOnboardingMilestone,
} = await import("./actions");

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const WHO = "22222222-2222-4222-8222-222222222222";
const FOLLOWUP = "33333333-3333-4333-8333-333333333333";
const HASH = "b".repeat(64);

beforeEach(() => {
  h.rpc.mockReset();
  h.logAdminAction.mockReset();
  h.revalidatePath.mockReset();
});

describe("addOnboardingNote", () => {
  const good = { schoolId: SCHOOL, kind: "call", note: "  Spoke to the bursar.  ", by: WHO };

  it("rejects bad input before touching the database", async () => {
    expect(await addOnboardingNote({ ...good, schoolId: "x" })).toEqual({ error: "Invalid school id." });
    expect(await addOnboardingNote({ ...good, by: "x" })).toEqual({ error: "Say who you are before adding a note." });
    expect(await addOnboardingNote({ ...good, kind: "gossip" })).toEqual({ error: "Choose what kind of note this is." });
    expect(await addOnboardingNote({ ...good, note: "   " })).toEqual({ error: "Write the note first." });
    expect(await addOnboardingNote({ ...good, note: "x".repeat(2001) })).toMatchObject({ error: expect.stringContaining("2000") });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("saves the trimmed note and audits the kind only, never the text", async () => {
    h.rpc.mockResolvedValue({ data: "id", error: null });
    expect(await addOnboardingNote(good)).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_add_onboarding_note", { p_school_id: SCHOOL, p_kind: "call", p_note: "Spoke to the bursar.", p_by: WHO });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "add_onboarding_note", { school_id: SCHOOL, kind: "call" });
    expect(JSON.stringify(h.logAdminAction.mock.calls)).not.toContain("bursar");
  });

  it("surfaces a database refusal", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Not authorized to manage school onboarding." } });
    expect(await addOnboardingNote(good)).toEqual({ error: "Not authorized to manage school onboarding." });
    expect(h.logAdminAction).not.toHaveBeenCalled();
  });
});

describe("resolveOnboardingFollowup", () => {
  it("validates ids, then resolves or dismisses", async () => {
    expect(await resolveOnboardingFollowup({ id: "x", dismiss: false, by: WHO })).toEqual({ error: "Invalid follow-up id." });
    expect(await resolveOnboardingFollowup({ id: FOLLOWUP, dismiss: false, by: "x" })).toMatchObject({ error: expect.any(String) });
    expect(h.rpc).not.toHaveBeenCalled();

    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await resolveOnboardingFollowup({ id: FOLLOWUP, dismiss: true, by: WHO, schoolId: SCHOOL })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_resolve_onboarding_followup", { p_id: FOLLOWUP, p_dismiss: true, p_by: WHO });
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "dismiss_onboarding_alert", { followup_id: FOLLOWUP });
  });
});

describe("triggerOnboardingFollowup", () => {
  it("only accepts the two email follow-ups", async () => {
    expect(await triggerOnboardingFollowup({ schoolId: SCHOOL, rule: "inactive_7d", by: WHO })).toEqual({ error: "Unknown follow-up." });
    expect(await triggerOnboardingFollowup({ schoolId: SCHOOL, rule: "whatsapp", by: WHO })).toEqual({ error: "Unknown follow-up." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("proposes through the database (which never sends) and refreshes the nudge queue page", async () => {
    h.rpc.mockResolvedValue({ data: "nudge", error: null });
    expect(await triggerOnboardingFollowup({ schoolId: SCHOOL, rule: "password_reminder_email", by: WHO })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_trigger_onboarding_followup", { p_school_id: SCHOOL, p_rule: "password_reminder_email", p_by: WHO });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/trials/nudges");
  });

  it("returns the database's plain-language reason when the school's state no longer matches", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "This school has already changed its password, so a password reminder does not apply." } });
    expect(await triggerOnboardingFollowup({ schoolId: SCHOOL, rule: "password_reminder_email", by: WHO })).toEqual({
      error: "This school has already changed its password, so a password reminder does not apply.",
    });
  });
});

describe("saveOnboardingSettings", () => {
  const good = {
    automationEnabled: false,
    automationStartAt: "2026-10-30T08:00:00.000Z",
    passwordReminderHours: 24,
    passwordFlagHours: 48,
    loginGuidanceHours: 24,
    noSetupFlagHours: 48,
    inactiveDays: 7,
    by: WHO,
  };

  it("rejects out-of-range thresholds and bad dates before the database", async () => {
    expect(await saveOnboardingSettings({ ...good, passwordReminderHours: 0 })).toMatchObject({ error: expect.stringContaining("1 to 720") });
    expect(await saveOnboardingSettings({ ...good, noSetupFlagHours: 721 })).toMatchObject({ error: expect.stringContaining("1 to 720") });
    expect(await saveOnboardingSettings({ ...good, loginGuidanceHours: 1.5 })).toMatchObject({ error: expect.stringContaining("whole") });
    expect(await saveOnboardingSettings({ ...good, inactiveDays: 181 })).toMatchObject({ error: expect.stringContaining("1 to 180") });
    expect(await saveOnboardingSettings({ ...good, automationStartAt: "not a date" })).toMatchObject({ error: expect.stringContaining("date") });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("saves, and audits only whether automation is on", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await saveOnboardingSettings({ ...good, automationEnabled: true })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith(
      "admin_set_onboarding_settings",
      expect.objectContaining({ p_automation_enabled: true, p_password_reminder_hours: 24, p_inactive_days: 7, p_by: WHO }),
    );
    expect(h.logAdminAction).toHaveBeenCalledWith(h.client, "set_onboarding_settings", { automation_enabled: true });
  });
});

describe("approveOnboardingTemplates", () => {
  it("requires a real hash and a named person", async () => {
    expect(await approveOnboardingTemplates({ expectedHash: "short", by: WHO })).toMatchObject({ error: expect.stringContaining("Reload") });
    expect(await approveOnboardingTemplates({ expectedHash: HASH, by: "x" })).toMatchObject({ error: expect.stringContaining("Say who") });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("passes the hash the person was shown so a changed template is refused by the database", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "The templates changed since you opened this page. Reload and review them again." } });
    expect(await approveOnboardingTemplates({ expectedHash: HASH, by: WHO })).toMatchObject({ error: expect.stringContaining("changed") });
    expect(h.rpc).toHaveBeenCalledWith("admin_approve_onboarding_templates", { p_expected_hash: HASH, p_by: WHO });
  });
});

describe("saveOnboardingMilestone", () => {
  it("only accepts the fixed milestone keys and a weight from 1 to 10", async () => {
    expect(await saveOnboardingMilestone({ key: "drop", enabled: true, required: true, weight: 2, by: WHO })).toEqual({ error: "Unknown milestone." });
    expect(await saveOnboardingMilestone({ key: "classes", enabled: true, required: true, weight: 11, by: WHO })).toMatchObject({ error: expect.stringContaining("1 to 10") });
    expect(h.rpc).not.toHaveBeenCalled();

    h.rpc.mockResolvedValue({ data: null, error: null });
    expect(await saveOnboardingMilestone({ key: "classes", enabled: true, required: true, weight: 3, by: WHO })).toEqual({ success: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_set_onboarding_milestone", { p_key: "classes", p_enabled: true, p_required: true, p_weight: 3, p_by: WHO });
  });
});
