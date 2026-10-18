import { describe, expect, it } from "vitest";
import {
  cleanPath,
  cleanReferrerHost,
  clickPlatformFromSearch,
  countryFromHeader,
  deviceFromUserAgent,
  isBotUserAgent,
  parsePageViewPayload,
} from "./page-view";

describe("cleanPath", () => {
  it("strips query, fragment and trailing slash and lowercases", () => {
    expect(cleanPath("/Pricing/?gclid=abc#top")).toBe("/pricing");
    expect(cleanPath("/")).toBe("/");
  });
  it("rejects non-paths, protocol-relative, internal and oversized", () => {
    expect(cleanPath("pricing")).toBeNull();
    expect(cleanPath("//evil.com")).toBeNull();
    expect(cleanPath("/api/x")).toBeNull();
    expect(cleanPath("/admin/analytics")).toBeNull();
    expect(cleanPath("/a b")).toBeNull();
    expect(cleanPath("/" + "a".repeat(250))).toBeNull();
    expect(cleanPath(5)).toBeNull();
  });
});

describe("cleanReferrerHost", () => {
  it("returns the host without www and drops own site", () => {
    expect(cleanReferrerHost("https://www.google.com/search?q=x", "educoreafrica.com")).toBe("google.com");
    expect(cleanReferrerHost("https://educoreafrica.com/pricing", "www.educoreafrica.com")).toBeNull();
    expect(cleanReferrerHost("", null)).toBeNull();
    expect(cleanReferrerHost("not a url", null)).toBeNull();
  });
});

describe("parsePageViewPayload", () => {
  it("keeps campaign data only on entry views and never trusts a click id", () => {
    const entry = parsePageViewPayload(
      { path: "/", isEntry: true, referrer: "https://l.facebook.com/", utmSource: "Google", click: "google", gclid: "SECRET" },
      "educoreafrica.com",
    );
    expect(entry).toMatchObject({ referrerHost: "l.facebook.com", utmSource: "google", clickPlatform: "google" });
    expect(JSON.stringify(entry)).not.toContain("SECRET");
    const later = parsePageViewPayload({ path: "/contact", isEntry: false, utmSource: "x", click: "meta" }, null);
    expect(later).toMatchObject({ utmSource: null, clickPlatform: null, referrerHost: null });
  });
  it("rejects bad bodies", () => {
    expect(parsePageViewPayload(null, null)).toBeNull();
    expect(parsePageViewPayload({ path: "/api/x" }, null)).toBeNull();
  });
});

describe("helpers", () => {
  it("detects click platforms", () => {
    expect(clickPlatformFromSearch(new URLSearchParams("gclid=1"))).toBe("google");
    expect(clickPlatformFromSearch(new URLSearchParams("fbclid=1"))).toBe("meta");
    expect(clickPlatformFromSearch(new URLSearchParams("a=1"))).toBeNull();
  });
  it("classifies devices", () => {
    expect(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile")).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X700)")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(deviceFromUserAgent(null)).toBe("unknown");
  });
  it("detects bots but not Cubot phones", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Linux; Android 11; CUBOT P40) Chrome/120 Mobile")).toBe(false);
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe(false);
  });
  it("reads the country header", () => {
    expect(countryFromHeader("ke")).toBe("KE");
    expect(countryFromHeader("XX")).toBeNull();
    expect(countryFromHeader(null)).toBeNull();
  });
});
