import { describe, expect, it } from "vitest";

import { normalizeLeadEmail, parseDemoContactStep } from "./demo-partial";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const valid = {
  name: "Jane Wanjiru",
  school_name: "Sunrise Academy",
  email: "jane@sunrise.ac.ke",
};

describe("parseDemoContactStep", () => {
  it("accepts the three required fields and treats phone as optional", () => {
    const res = parseDemoContactStep(form(valid));
    expect(res).toEqual({
      ok: true,
      value: {
        name: "Jane Wanjiru",
        schoolName: "Sunrise Academy",
        email: "jane@sunrise.ac.ke",
        phone: null,
      },
    });
  });

  it("trims values and keeps a provided phone number", () => {
    const res = parseDemoContactStep(
      form({ ...valid, name: "  Jane  ", phone: " +254 700 000 000 " }),
    );
    expect(res.ok && res.value.name).toBe("Jane");
    expect(res.ok && res.value.phone).toBe("+254 700 000 000");
  });

  it("lowercases the email so it can be matched exactly later", () => {
    const res = parseDemoContactStep(form({ ...valid, email: "  Jane@Sunrise.AC.KE " }));
    expect(res.ok && res.value.email).toBe("jane@sunrise.ac.ke");
  });

  it.each(["name", "school_name", "email"])("rejects a missing %s", (field) => {
    const res = parseDemoContactStep(form({ ...valid, [field]: "   " }));
    expect(res.ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    const res = parseDemoContactStep(form({ ...valid, email: "not-an-email" }));
    expect(res).toEqual({ ok: false, message: "Enter a valid email address." });
  });

  it("caps oversized values instead of storing them whole", () => {
    const res = parseDemoContactStep(
      form({ ...valid, name: "n".repeat(500), school_name: "s".repeat(500), phone: "1".repeat(500) }),
    );
    expect(res.ok && res.value.name.length).toBe(120);
    expect(res.ok && res.value.schoolName.length).toBe(200);
    expect(res.ok && res.value.phone?.length).toBe(40);
  });

  it("rejects an email longer than the RFC limit", () => {
    const res = parseDemoContactStep(form({ ...valid, email: `${"a".repeat(250)}@x.co` }));
    expect(res.ok).toBe(false);
  });
});

describe("normalizeLeadEmail", () => {
  it("trims and lowercases, tolerating null/undefined", () => {
    expect(normalizeLeadEmail("  A@B.co ")).toBe("a@b.co");
    expect(normalizeLeadEmail(null)).toBe("");
    expect(normalizeLeadEmail(undefined)).toBe("");
  });
});
