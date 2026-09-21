import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_STORAGE_KEY } from "@/lib/marketing/consent";
import { captureAttribution, clearStoredClickIds, getStoredAttribution } from "./attribution";

function stubBrowser(search: string, consent?: "accepted" | "declined", existing?: string) {
  const session = new Map<string, string>();
  if (existing) session.set("educore_attribution", existing);
  const local = new Map<string, string>();
  if (consent) local.set(CONSENT_STORAGE_KEY, consent);
  vi.stubGlobal("window", {
    location: { search },
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: () => {} },
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("captureAttribution", () => {
  it("captures UTM tags and the Google click ID from the landing URL", () => {
    stubBrowser("?utm_source=google&utm_medium=cpc&utm_campaign=kenya&utm_term=cbc&gclid=abc_123-x");
    captureAttribution();
    expect(getStoredAttribution()).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "kenya",
      utm_term: "cbc",
      gclid: "abc_123-x",
    });
  });

  it("captures nothing when the URL has no attribution parameters", () => {
    stubBrowser("?ref=homepage");
    captureAttribution();
    expect(getStoredAttribution()).toEqual({});
  });

  it("is first-touch: a later page with different parameters does not overwrite", () => {
    stubBrowser("?utm_source=facebook", undefined, JSON.stringify({ utm_source: "google", gclid: "first" }));
    captureAttribution();
    expect(getStoredAttribution()).toEqual({ utm_source: "google", gclid: "first" });
  });

  it("drops a malformed click ID but keeps the UTM tags", () => {
    stubBrowser("?utm_source=google&gclid=%3Cscript%3E");
    captureAttribution();
    expect(getStoredAttribution()).toEqual({ utm_source: "google" });
  });

  it("does not store ad click IDs when the visitor declined cookies (UTM tags still kept)", () => {
    stubBrowser("?utm_source=google&utm_medium=cpc&gclid=abc&gbraid=def&wbraid=ghi", "declined");
    captureAttribution();
    expect(getStoredAttribution()).toEqual({ utm_source: "google", utm_medium: "cpc" });
  });

  it("does store click IDs when the visitor accepted", () => {
    stubBrowser("?gclid=abc", "accepted");
    captureAttribution();
    expect(getStoredAttribution()).toEqual({ gclid: "abc" });
  });
});

describe("clearStoredClickIds", () => {
  it("removes click IDs but keeps UTM tags", () => {
    stubBrowser("", undefined, JSON.stringify({ utm_source: "google", gclid: "abc", wbraid: "w" }));
    clearStoredClickIds();
    expect(getStoredAttribution()).toEqual({ utm_source: "google" });
  });

  it("removes the record entirely when only click IDs were stored", () => {
    stubBrowser("", undefined, JSON.stringify({ gclid: "abc" }));
    clearStoredClickIds();
    expect(getStoredAttribution()).toEqual({});
  });
});
