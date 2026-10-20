import { describe, expect, it } from "vitest";
import {
  LIMITS,
  displayNumber,
  messageProblem,
  normalizeWhatsAppNumber,
  sentInLast24h,
  validateAgreement,
  validateMessage,
  whatsappLink,
} from "./sales-whatsapp";

const NOW = new Date("2026-10-19T09:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

describe("normalizeWhatsAppNumber (mirrors the database normaliser)", () => {
  it("turns Kenyan formats into 254XXXXXXXXX", () => {
    for (const raw of ["0712 345 678", "0712345678", "+254 712 345 678", "254712345678", "712345678", "0112345678", "(0712) 345-678"]) {
      expect(normalizeWhatsAppNumber(raw), raw).toMatch(/^254[17][0-9]{8}$/);
    }
    expect(normalizeWhatsAppNumber("0712 345 678")).toBe("254712345678");
    expect(normalizeWhatsAppNumber("0112345678")).toBe("254112345678");
  });
  it("accepts other international numbers of 9 to 15 digits and rejects the rest", () => {
    expect(normalizeWhatsAppNumber("+44 7911 123456")).toBe("447911123456");
    expect(normalizeWhatsAppNumber("12345678")).toBeNull();
    expect(normalizeWhatsAppNumber("1".repeat(16))).toBeNull();
    expect(normalizeWhatsAppNumber("not a number")).toBeNull();
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
  });
  it("shows the number with a plus sign", () => {
    expect(displayNumber("254712345678")).toBe("+254712345678");
  });
});

describe("messageProblem / validateMessage", () => {
  it("accepts a plain message and trims it", () => {
    expect(messageProblem("service", "Hello Jane, thanks for asking about a demo. See https://www.educoreafrica.com/contact")).toBeNull();
    expect(validateMessage({ kind: "service", body: "  Hello Jane  " })).toEqual({ ok: true, kind: "service", body: "Hello Jane" });
  });
  it("refuses placeholders, because a person sends the text exactly as written", () => {
    expect(messageProblem("service", "Hello {{name}}")).toBe("Write the person's name directly: placeholders are not filled in for WhatsApp messages.");
    expect(messageProblem("service", "Hello }}")).toMatch(/placeholders/);
  });
  it("limits the length to 1000 characters", () => {
    expect(messageProblem("service", "x".repeat(LIMITS.bodyMax))).toBeNull();
    expect(messageProblem("service", "x".repeat(LIMITS.bodyMax + 1))).toBe("Message is too long (max 1000 characters).");
  });
  it("applies the same claim, link and offer rules as trial emails", () => {
    expect(messageProblem("service", "We offer no obligation")).toMatch(/no obligation/);
    expect(messageProblem("service", "KICD approved software")).toMatch(/kicd approved/);
    expect(messageProblem("service", "Pay at https://bit.ly/x")).toMatch(/bit\.ly/);
    expect(messageProblem("service", "Get a discount")).toBe("This reads like an offer. Send it as a promotional message instead.");
    expect(messageProblem("promotional", "Get a discount")).toBeNull();
    expect(messageProblem("banner", "Hello")).toBe("Choose service or promotional.");
    expect(messageProblem("service", "   ")).toBe("Message is required.");
  });
});

describe("validateAgreement", () => {
  const ok = { phone: "0712 345 678", name: "  Jane Owner ", schoolName: " Sunrise ", how: "call", scope: "service", note: "  said yes  " };
  it("normalises the number and trims everything", () => {
    expect(validateAgreement(ok)).toEqual({ ok: true, phone: "254712345678", name: "Jane Owner", schoolName: "Sunrise", how: "call", scope: "service", note: "said yes" });
  });
  it("makes the optional fields null when blank", () => {
    expect(validateAgreement({ ...ok, schoolName: "  ", note: "" })).toMatchObject({ ok: true, schoolName: null, note: null });
  });
  it("rejects a bad number, name, how, scope or note", () => {
    expect(validateAgreement({ ...ok, phone: "abc" })).toEqual({ ok: false, error: "That is not a usable phone number." });
    expect(validateAgreement({ ...ok, name: "  " })).toMatchObject({ ok: false });
    expect(validateAgreement({ ...ok, name: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(validateAgreement({ ...ok, how: "telepathy" })).toEqual({ ok: false, error: "Say how they agreed." });
    expect(validateAgreement({ ...ok, scope: "everything" })).toEqual({ ok: false, error: "Choose what they agreed to." });
    expect(validateAgreement({ ...ok, note: "x".repeat(501) })).toMatchObject({ ok: false });
  });
});

describe("whatsappLink / sentInLast24h", () => {
  it("opens WhatsApp to the number with the text encoded, so a person still presses send", () => {
    const link = whatsappLink("254712345678", "Hello Jane & Co.\nSee you at 3?");
    expect(link).toBe("https://wa.me/254712345678?text=Hello%20Jane%20%26%20Co.%0ASee%20you%20at%203%3F");
    expect(new URL(link).searchParams.get("text")).toBe("Hello Jane & Co.\nSee you at 3?");
  });
  it("counts only messages marked sent in the last 24 hours", () => {
    const rows = [
      { status: "sent", sent_at: ago(1) },
      { status: "sent", sent_at: ago(30) },
      { status: "approved", sent_at: null },
      { status: "cancelled", sent_at: ago(2) },
      { status: "sent", sent_at: null },
    ];
    expect(sentInLast24h(rows, NOW)).toBe(1);
  });
});
