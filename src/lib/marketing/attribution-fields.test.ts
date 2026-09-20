import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_KEYS,
  isMissingColumnError,
  legacyAttributionColumns,
  parseAttributionFormData,
  sanitizeAttributionValue,
} from "./attribution-fields";

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("parseAttributionFormData", () => {
  it("returns every key, null when not provided", () => {
    const out = parseAttributionFormData(new FormData());
    expect(Object.keys(out).sort()).toEqual([...ATTRIBUTION_KEYS].sort());
    expect(Object.values(out).every((v) => v === null)).toBe(true);
  });

  it("keeps the original behaviour for the three existing UTM fields", () => {
    const out = parseAttributionFormData(
      form({ utm_source: "  google ", utm_medium: "cpc", utm_campaign: "x".repeat(150) }),
    );
    expect(out.utm_source).toBe("google");
    expect(out.utm_medium).toBe("cpc");
    expect(out.utm_campaign).toBe("x".repeat(100));
  });

  it("captures the new UTM fields and click IDs", () => {
    const out = parseAttributionFormData(
      form({
        utm_term: "school management system kenya",
        utm_content: "ad-a",
        gclid: "Cj0KCQjw_abc-123",
        gbraid: "0AAAAAp_xyz",
        wbraid: "CkI-9",
      }),
    );
    expect(out.utm_term).toBe("school management system kenya");
    expect(out.utm_content).toBe("ad-a");
    expect(out.gclid).toBe("Cj0KCQjw_abc-123");
    expect(out.gbraid).toBe("0AAAAAp_xyz");
    expect(out.wbraid).toBe("CkI-9");
  });

  it("drops click IDs that are not URL-safe tokens", () => {
    expect(sanitizeAttributionValue("gclid", "abc def")).toBeNull();
    expect(sanitizeAttributionValue("gclid", "abc'; drop table x;--")).toBeNull();
    expect(sanitizeAttributionValue("gclid", "<script>")).toBeNull();
    expect(sanitizeAttributionValue("gclid", "a".repeat(201))).toBeNull();
    expect(sanitizeAttributionValue("gclid", "a".repeat(200))).toBe("a".repeat(200));
  });

  it("treats blank and whitespace-only values as not provided", () => {
    expect(sanitizeAttributionValue("utm_source", "   ")).toBeNull();
    expect(sanitizeAttributionValue("gclid", "")).toBeNull();
  });
});

describe("legacyAttributionColumns", () => {
  it("keeps only the three columns every environment already has", () => {
    const all = parseAttributionFormData(
      form({ utm_source: "google", utm_medium: "cpc", utm_campaign: "c", utm_term: "t", gclid: "g1" }),
    );
    expect(legacyAttributionColumns(all)).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "c",
    });
  });
});

describe("isMissingColumnError", () => {
  it("recognises PostgREST and Postgres undefined-column errors", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("does not treat other errors (or no error) as a missing column", () => {
    expect(isMissingColumnError({ code: "23505" })).toBe(false);
    expect(isMissingColumnError({ code: "42501" })).toBe(false);
    expect(isMissingColumnError({})).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});
