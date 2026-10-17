import { describe, expect, it } from "vitest";
import {
  contactBlockReason,
  describeContactEvent,
  isContactChannel,
  isOptOutReason,
  summariseContactLog,
  validateContactInput,
} from "./contact";

describe("contactBlockReason", () => {
  const ok = { status: "approved", contactValue: "a@b.co", blocked: false };
  it("allows an approved prospect with a contact that has not opted out", () => {
    expect(contactBlockReason(ok, "email")).toBeNull();
    expect(contactBlockReason({ ...ok, status: "promoted" }, "email")).toBeNull();
  });
  it.each(["new", "scored", "rejected"])("refuses a %s prospect", (status) => {
    expect(contactBlockReason({ ...ok, status }, "email")).toMatch(/Approve this prospect/);
  });
  it("explains a missing contact per channel", () => {
    expect(contactBlockReason({ ...ok, contactValue: null }, "email")).toMatch(/email/i);
    expect(contactBlockReason({ ...ok, contactValue: "  " }, "whatsapp")).toMatch(/phone/i);
  });
  it("refuses an opted-out contact and holds while the check is loading", () => {
    expect(contactBlockReason({ ...ok, blocked: true }, "whatsapp")).toMatch(/Opted out/);
    expect(contactBlockReason({ ...ok, blocked: null }, "whatsapp")).toMatch(/Checking/);
  });
  it.each(["scraped", "ai_found"])("refuses %s (unconfirmed) contact details until a person confirms them", (contactStatus) => {
    expect(contactBlockReason({ ...ok, contactStatus }, "email")).toMatch(/Confirm the found contact details/);
  });
  it("allows verified, imported (null) and unspecified contact status", () => {
    expect(contactBlockReason({ ...ok, contactStatus: "verified" }, "email")).toBeNull();
    expect(contactBlockReason({ ...ok, contactStatus: null }, "email")).toBeNull();
  });
  it("checks approval before anything else", () => {
    expect(contactBlockReason({ status: "scored", contactValue: null, blocked: true }, "email")).toMatch(/Approve/);
  });
});

describe("summariseContactLog", () => {
  it("groups by prospect, keeps the newest event, counts contacts and collects opt-outs", () => {
    const m = summariseContactLog([
      { prospect_id: "p1", channel: "whatsapp", event: "replied", created_at: "2026-10-17T10:00:00Z" },
      { prospect_id: "p1", channel: "email", event: "sent", created_at: "2026-10-16T10:00:00Z" },
      { prospect_id: "p1", channel: "email", event: "draft_copied", created_at: "2026-10-16T09:00:00Z" },
      { prospect_id: "p2", channel: "whatsapp", event: "opted_out", created_at: "2026-10-15T10:00:00Z" },
      { prospect_id: "p2", channel: "whatsapp", event: "opted_out", created_at: "2026-10-14T10:00:00Z" },
      { channel: "email", event: "sent", created_at: "2026-10-13T10:00:00Z" },
    ]);
    expect(m.get("p1")).toEqual({
      last: { channel: "whatsapp", event: "replied", created_at: "2026-10-17T10:00:00Z" },
      optedOut: [],
      contacts: 2,
    });
    expect(m.get("p2")).toEqual({ last: null, optedOut: ["whatsapp"], contacts: 0 });
    expect(m.size).toBe(2);
  });
});

describe("validateContactInput", () => {
  it("accepts the manual events and trims the note", () => {
    expect(validateContactInput("email", "sent", "  hi ")).toEqual({ ok: true, channel: "email", event: "sent", note: "hi" });
    expect(validateContactInput("whatsapp", "replied", "")).toEqual({ ok: true, channel: "whatsapp", event: "replied", note: null });
  });
  it("rejects opted_out (database-only), unknown values and long notes", () => {
    expect(validateContactInput("email", "opted_out", null).ok).toBe(false);
    expect(validateContactInput("telegram", "sent", null).ok).toBe(false);
    expect(validateContactInput("email", "shouted", null).ok).toBe(false);
    expect(validateContactInput("email", "sent", "x".repeat(501)).ok).toBe(false);
  });
});

describe("labels and guards", () => {
  it("describes events as self-reported actions, never as delivery", () => {
    expect(describeContactEvent("whatsapp", "draft_copied")).toBe("Copied WhatsApp draft");
    expect(describeContactEvent("email", "sent")).toBe("Marked Email as sent");
    expect(describeContactEvent("email", "opted_out")).toBe("Email opt-out recorded");
  });
  it("guards channels and reasons", () => {
    expect(isContactChannel("email")).toBe(true);
    expect(isContactChannel("sms")).toBe(false);
    expect(isOptOutReason("stop_reply")).toBe(true);
    expect(isOptOutReason("manual")).toBe(false);
  });
});
