import { describe, expect, it } from "vitest";

import {
  WHATSAPP_CONSENT_LABEL,
  buildStoredMessage,
  cleanText,
  isAcceptablePreferredDate,
  normalizePhone,
  parseDemoRequest,
  todayInNairobi,
} from "./demo-request";

// 2026-10-11 22:30 UTC is already 2026-10-12 01:30 in Nairobi (UTC+3).
const NOW = new Date("2026-10-11T22:30:00Z");

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const valid = {
  name: "Jane Wanjiru",
  school_name: "Sunrise Academy",
  role: "Principal",
  email: "jane@sunrise.ac.ke",
  phone: "0712 345 678",
  contact_method: "whatsapp",
  request_type: "callback",
};

describe("normalizePhone", () => {
  it.each([
    ["0712 345 678", "0712345678"],
    ["+254 712-345-678", "+254712345678"],
    ["254712345678", "254712345678"],
    ["(0712) 345.678", "0712345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "123", "07123", "0712 345 678 ext 5", "1".repeat(16), "<script>"])(
    "rejects %j",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("cleanText", () => {
  it("strips control and zero-width characters and caps length", () => {
    expect(cleanText("Ja\u0000ne\u200B  \u202E", 50)).toBe("Ja ne");
    expect(cleanText("x".repeat(500), 10)).toHaveLength(10);
  });

  it("keeps newlines only when multiline", () => {
    expect(cleanText("a\nb", 10)).toBe("a b");
    expect(cleanText("a\nb\u0007", 10, { multiline: true })).toBe("a\nb");
  });
});

describe("preferred date", () => {
  it("uses the Nairobi calendar day, not UTC", () => {
    expect(todayInNairobi(NOW)).toBe("2026-10-12");
  });

  it("accepts today (Nairobi) through 60 days ahead and rejects the rest", () => {
    expect(isAcceptablePreferredDate("2026-10-12", NOW)).toBe(true);
    expect(isAcceptablePreferredDate("2026-12-11", NOW)).toBe(true);
    expect(isAcceptablePreferredDate("2026-10-11", NOW)).toBe(false);
    expect(isAcceptablePreferredDate("2026-12-12", NOW)).toBe(false);
  });

  it.each(["2026-02-30", "12/10/2026", "2026-13-01", "", "tomorrow"])("rejects %j", (d) => {
    expect(isAcceptablePreferredDate(d, NOW)).toBe(false);
  });
});

describe("parseDemoRequest", () => {
  it("accepts a callback request with only the essential fields", () => {
    const res = parseDemoRequest(form(valid), NOW);
    expect(res).toMatchObject({
      ok: true,
      value: { phone: "0712345678", contactMethod: "whatsapp", requestType: "callback", studentCount: null },
    });
  });

  it("requires a date and window for a scheduled request", () => {
    const base = { ...valid, request_type: "scheduled" };
    expect(parseDemoRequest(form(base), NOW)).toMatchObject({ ok: false, field: "preferred_date" });
    expect(
      parseDemoRequest(form({ ...base, preferred_date: "2026-10-14" }), NOW),
    ).toMatchObject({ ok: false, field: "time_window" });
    expect(
      parseDemoRequest(form({ ...base, preferred_date: "2026-10-14", time_window: "afternoon" }), NOW),
    ).toMatchObject({ ok: true, value: { preferredDate: "2026-10-14", timeWindow: "afternoon" } });
  });

  it("ignores a stray date on a callback request", () => {
    const res = parseDemoRequest(form({ ...valid, preferred_date: "2020-01-01" }), NOW);
    expect(res).toMatchObject({ ok: true, value: { preferredDate: null, timeWindow: null } });
  });

  it.each([
    ["name", { name: " " }],
    ["school_name", { school_name: "" }],
    ["role", { role: "CEO of Everything" }],
    ["phone", { phone: "nope" }],
    ["email", { email: "no-at-sign" }],
    ["contact_method", { contact_method: "carrier-pigeon" }],
    ["request_type", { request_type: "immediately" }],
    ["student_count", { student_count: "12.5" }],
    ["student_count", { student_count: "-3" }],
  ])("rejects an invalid %s", (field, override) => {
    expect(parseDemoRequest(form({ ...valid, ...override }), NOW)).toMatchObject({ ok: false, field });
  });

  it("caps a very long message", () => {
    const res = parseDemoRequest(form({ ...valid, message: "m".repeat(9000) }), NOW);
    expect(res.ok && res.value.message.length).toBe(2000);
  });
});

describe("buildStoredMessage", () => {
  it("leads with the contact method and flags an unconfirmed preferred time", () => {
    const res = parseDemoRequest(
      form({ ...valid, request_type: "scheduled", preferred_date: "2026-10-14", time_window: "morning", message: "Fees module" }),
      NOW,
    );
    expect(res.ok && buildStoredMessage(res.value)).toBe(
      "Contact via: WhatsApp\nPreferred time: Wed, 14 Oct 2026, Morning (8:00–12:00) EAT (NOT yet confirmed -- confirm with the visitor)\n\nFees module",
    );
  });

  it("describes a callback with no visitor message", () => {
    const res = parseDemoRequest(form({ ...valid, contact_method: "phone" }), NOW);
    expect(res.ok && buildStoredMessage(res.value)).toBe(
      "Contact via: Phone call\nPreferred time: callback requested as soon as possible",
    );
  });
});

describe("school type", () => {
  it("is optional: absent, blank and unknown values never fail the request", () => {
    for (const value of [undefined, "", "   ", "university", "PRIMARY-SCHOOLS", "primary-schools; drop table"]) {
      const res = parseDemoRequest(form(value === undefined ? valid : { ...valid, school_category: value }), NOW);
      expect(res.ok, String(value)).toBe(true);
      expect(res.ok && res.value.schoolCategory, String(value)).toBeNull();
    }
  });

  it("accepts exactly the five landing-page slugs", () => {
    for (const slug of ["nursery-kindergarten", "primary-schools", "junior-schools", "secondary-schools", "integrated-schools"]) {
      const res = parseDemoRequest(form({ ...valid, school_category: slug }), NOW);
      expect(res.ok && res.value.schoolCategory).toBe(slug);
    }
  });

  it("adds one readable line after the preferred time, and nothing when it isn't chosen", () => {
    const withType = parseDemoRequest(form({ ...valid, school_category: "primary-schools", message: "Fees module" }), NOW);
    expect(withType.ok && buildStoredMessage(withType.value)).toBe(
      "Contact via: WhatsApp\nPreferred time: callback requested as soon as possible\nSchool type: Primary school\n\nFees module",
    );
    const without = parseDemoRequest(form(valid), NOW);
    expect(without.ok && buildStoredMessage(without.value)).not.toContain("School type");
  });
});

describe("WhatsApp agreement tick-box", () => {
  it("is false unless the box was ticked, and only the value \"yes\" counts", () => {
    for (const extra of [{}, { whatsapp_consent: "" }, { whatsapp_consent: "on" }, { whatsapp_consent: "true" }, { whatsapp_consent: "1" }, { whatsapp_consent: "YES" }] as Record<string, string>[]) {
      const res = parseDemoRequest(form({ ...valid, ...extra }), NOW);
      expect(res.ok && res.value.whatsappConsent, JSON.stringify(extra)).toBe(false);
    }
    const ticked = parseDemoRequest(form({ ...valid, whatsapp_consent: "yes" }), NOW);
    expect(ticked.ok && ticked.value.whatsappConsent).toBe(true);
  });

  it("does not depend on the preferred contact method (choosing WhatsApp alone is not agreement)", () => {
    const res = parseDemoRequest(form({ ...valid, contact_method: "whatsapp" }), NOW);
    expect(res.ok && res.value.whatsappConsent).toBe(false);
    const phone = parseDemoRequest(form({ ...valid, contact_method: "phone", whatsapp_consent: "yes" }), NOW);
    expect(phone.ok && phone.value.whatsappConsent).toBe(true);
  });

  it("does not change what is stored in the lead's message", () => {
    const a = parseDemoRequest(form({ ...valid }), NOW);
    const b = parseDemoRequest(form({ ...valid, whatsapp_consent: "yes" }), NOW);
    expect(a.ok && b.ok && buildStoredMessage(a.value)).toBe(a.ok && b.ok && buildStoredMessage(b.value));
  });

  it("has wording that names the channel, the purpose and the way out, and promises nothing promotional", () => {
    expect(WHATSAPP_CONSENT_LABEL).toMatch(/WhatsApp/);
    expect(WHATSAPP_CONSENT_LABEL).toMatch(/demo request and free trial/);
    expect(WHATSAPP_CONSENT_LABEL).toMatch(/STOP/);
    expect(WHATSAPP_CONSENT_LABEL).not.toMatch(/offer|promotion|discount|marketing/i);
    expect(WHATSAPP_CONSENT_LABEL.length).toBeLessThan(600);
  });
});
